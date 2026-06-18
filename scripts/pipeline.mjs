// scripts/pipeline.mjs
// Deterministic dev pipeline for gaffer teams. The LLM makes the judgment calls
// (what to build, is a review acceptable); THIS script owns the guarantees:
// git worktrees, the test/build gate (real exit codes), money/auth path gates,
// budget enforcement, and PR creation. No external deps. Called by the
// dev-pipeline skill via OpenClaw's `exec` tool.
//
//   pipeline start      --ticket <f> [--repo <d>]   # worktree + branch off base
//   pipeline verify     --worktree <d>              # run verify steps; exit!=0 on fail
//   pipeline gate-check --worktree <d>              # flag changed gated (money/auth) paths
//   pipeline open-pr    --worktree <d> [--approved] # guarded push + gh pr create
//   pipeline status     [--repo <d>]                # worktrees + budget
//   pipeline cleanup    --worktree <d>              # remove a worktree
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseArgs, loadPolicy, findRepoRoot, git, sh, run, out, log,
  runDir, worktreeRoot, writeJson, readJson, ensureDir,
  matchAnyGlob, budgetStatus, nowIso,
} from "./lib/gaffer.mjs";

function mainRepoRoot(worktree) {
  const r = git(worktree, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (r.code === 0 && r.stdout.trim()) return path.dirname(r.stdout.trim());
  return findRepoRoot(worktree);
}

function resolveBaseRef(repoRoot, policy) {
  const base = policy.repo.baseBranch || "main";
  if (git(repoRoot, ["rev-parse", "--verify", "--quiet", base]).code === 0) return base;
  const rb = `${policy.repo.remote || "origin"}/${base}`;
  if (git(repoRoot, ["rev-parse", "--verify", "--quiet", rb]).code === 0) return rb;
  return base;
}

/** Tracked changes vs base + untracked new files (so new gated files are caught). */
function changedFiles(worktree, baseRef) {
  const tracked = git(worktree, ["diff", "--name-only", baseRef]).stdout.split("\n");
  const untracked = git(worktree, ["ls-files", "--others", "--exclude-standard"]).stdout.split("\n");
  return [...new Set([...tracked, ...untracked].map((s) => s.trim()).filter(Boolean))];
}

function runVerify(worktree, policy) {
  const steps = [];
  let okAll = true;
  for (const step of policy.verify.steps || []) {
    const t0 = Date.now();
    const r = sh(step.cmd, { cwd: worktree, timeoutMs: (policy.verify.timeoutSec || 1800) * 1000 });
    steps.push({
      name: step.name, cmd: step.cmd, code: r.code, ms: Date.now() - t0,
      optional: !!step.optional, passed: r.code === 0,
      tail: (r.stdout + "\n" + r.stderr).split("\n").filter(Boolean).slice(-12).join("\n"),
    });
    if (r.code !== 0 && !step.optional) { okAll = false; break; }
  }
  return { ok: okAll, steps };
}

function cmdStart(args) {
  if (!args.ticket) return fail("start requires --ticket <path>");
  const ticket = readJson(path.resolve(args.ticket));
  if (!ticket || !ticket.id || !ticket.team) return fail("ticket must be JSON with at least { id, team, title }");
  const repoRoot = args.repo ? path.resolve(args.repo) : findRepoRoot();
  const policy = loadPolicy(repoRoot);
  const base = resolveBaseRef(repoRoot, policy);
  const branch = `gaffer/${ticket.team}/${ticket.id}`;
  const wt = path.join(worktreeRoot(repoRoot, policy), ticket.id);

  if (fs.existsSync(wt)) {
    log("info", `worktree exists, reusing: ${wt}`);
  } else {
    ensureDir(path.dirname(wt));
    const add = git(repoRoot, ["worktree", "add", "-b", branch, wt, base]);
    if (add.code !== 0) {
      const add2 = git(repoRoot, ["worktree", "add", wt, branch]); // branch may already exist
      if (add2.code !== 0) return fail(`git worktree add failed: ${add.stderr || add2.stderr}`);
    }
  }
  const meta = { ...ticket, branch, worktree: wt, base, startedAt: nowIso(), status: "started" };
  writeJson(path.join(runDir(repoRoot, policy, ticket.id), "run.json"), meta);
  return ok({
    runId: ticket.id, branch, base, worktree: wt,
    next: `Implement the change INSIDE the worktree (${wt}), then: pipeline verify --worktree "${wt}"`,
  });
}

function cmdVerify(args) {
  const wt = requireWorktree(args); if (!wt) return 2;
  const repoRoot = mainRepoRoot(wt);
  const policy = loadPolicy(repoRoot);
  const res = runVerify(wt, policy);
  const id = path.basename(wt);
  const rd = runDir(repoRoot, policy, id);
  const meta = readJson(path.join(rd, "run.json"), {});
  meta.verify = { ok: res.ok, at: nowIso(), steps: res.steps.map(({ tail, ...s }) => s) };
  writeJson(path.join(rd, "run.json"), meta);
  out({ ok: res.ok, worktree: wt, steps: res.steps });
  return res.ok ? 0 : 1; // real exit code = the CI gate
}

function cmdGateCheck(args) {
  const wt = requireWorktree(args); if (!wt) return 2;
  const repoRoot = mainRepoRoot(wt);
  const policy = loadPolicy(repoRoot);
  const token = (policy.gates && policy.gates.escalateToken) || "ESCALATE:";
  const files = changedFiles(wt, resolveBaseRef(repoRoot, policy));
  const gatedFiles = files.filter((f) => matchAnyGlob(f, (policy.gates && policy.gates.paths) || []));
  out({
    ok: true, gated: gatedFiles.length > 0, changedFiles: files, gatedFiles, escalateToken: token,
    guidance: gatedFiles.length > 0
      ? `Changed files touch gated paths. Do NOT open a PR autonomously. Emit "${token} touches gated paths" and hand off to a human.`
      : "No gated paths touched; safe to proceed under the autonomy policy.",
  });
  return 0;
}

function cmdOpenPr(args) {
  const wt = requireWorktree(args); if (!wt) return 2;
  const repoRoot = mainRepoRoot(wt);
  const policy = loadPolicy(repoRoot);
  const base = resolveBaseRef(repoRoot, policy);
  const id = path.basename(wt);
  const rd = runDir(repoRoot, policy, id);
  const meta = readJson(path.join(rd, "run.json"), {});

  // Guard 1 — money/auth gates
  const gatedFiles = changedFiles(wt, base).filter((f) => matchAnyGlob(f, (policy.gates && policy.gates.paths) || []));
  if (gatedFiles.length > 0 && !args.approved) {
    out({ ok: false, refused: "gated", gatedFiles, hint: "Gated paths need human sign-off. Re-run with --approved only after a human approves." });
    return 4;
  }
  // Guard 2 — green CI
  if (policy.requireGreenCI) {
    const v = meta.verify && meta.verify.ok ? meta.verify : runVerify(wt, policy);
    if (!v.ok) { out({ ok: false, refused: "verify-failed", verify: v }); return 5; }
  }
  // Guard 3 — budget
  const b = budgetStatus(repoRoot, policy, { run: id });
  if (!b.ok && ((policy.budget && policy.budget.onExceed) || "block") === "block") {
    out({ ok: false, refused: "over-budget", budget: b }); return 6;
  }

  // Commit pending work
  if (git(wt, ["status", "--porcelain"]).stdout.trim()) {
    git(wt, ["add", "-A"]);
    git(wt, ["commit", "-m", meta.title || `gaffer: ${id}`]);
  }
  // Push
  const remote = policy.repo.remote || "origin";
  const branch = meta.branch || `gaffer/${meta.team || "team"}/${id}`;
  const push = git(wt, ["push", "-u", remote, branch]);
  if (push.code !== 0) { out({ ok: false, refused: "push-failed", stderr: push.stderr }); return 7; }

  // Open PR via gh (no shell → no quoting hazards)
  const target = policy.repo.mergeTarget || policy.repo.baseBranch || "main";
  const body = [meta.description || "", "", `Verify: ${meta.verify && meta.verify.ok ? "passed ✅" : "see run metadata"}`,
    "", (policy.pr && policy.pr.bodyFooter) || ""].join("\n").trim();
  const ghArgs = ["pr", "create", "--base", target, "--head", branch, "--title", meta.title || `gaffer: ${id}`, "--body", body];
  if (policy.pr && policy.pr.draft) ghArgs.push("--draft");
  for (const l of (policy.pr && policy.pr.labels) || []) ghArgs.push("--label", l);
  const pr = run("gh", ghArgs, { cwd: wt });
  if (pr.code !== 0) { out({ ok: false, refused: "gh-failed", stderr: pr.stderr || pr.error, stdout: pr.stdout }); return 8; }

  const url = (pr.stdout.match(/https?:\/\/\S+/) || [])[0] || pr.stdout.trim();
  meta.status = "pr-open"; meta.prUrl = url;
  writeJson(path.join(rd, "run.json"), meta);
  out({ ok: true, prUrl: url, branch, base: target });
  return 0;
}

function cmdStatus(args) {
  const repoRoot = args.repo ? path.resolve(args.repo) : findRepoRoot();
  const policy = loadPolicy(repoRoot);
  out({
    ok: true, repoRoot,
    worktrees: git(repoRoot, ["worktree", "list"]).stdout.split("\n").filter(Boolean),
    budget: budgetStatus(repoRoot, policy, {}),
  });
  return 0;
}

function cmdCleanup(args) {
  const wt = requireWorktree(args); if (!wt) return 2;
  const r = git(mainRepoRoot(wt), ["worktree", "remove", wt, "--force"]);
  out({ ok: r.code === 0, worktree: wt, stderr: r.stderr || undefined });
  return r.code === 0 ? 0 : 1;
}

function requireWorktree(args) {
  if (!args.worktree) { out({ ok: false, error: "this command requires --worktree <path>" }); return null; }
  return path.resolve(args.worktree);
}
function ok(obj) { out({ ok: true, ...obj }); return 0; }
function fail(msg) { out({ ok: false, error: msg }); return 2; }

export function main(argv) {
  const args = parseArgs(argv);
  switch (args._[0]) {
    case "start": return cmdStart(args);
    case "verify": return cmdVerify(args);
    case "gate-check": return cmdGateCheck(args);
    case "open-pr": return cmdOpenPr(args);
    case "status": return cmdStatus(args);
    case "cleanup": return cmdCleanup(args);
    default:
      out({ ok: false, error: `unknown command: ${args._[0] || "(none)"}`,
        usage: "pipeline <start|verify|gate-check|open-pr|status|cleanup> [--ticket f] [--worktree d] [--repo d] [--approved]" });
      return 2;
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
