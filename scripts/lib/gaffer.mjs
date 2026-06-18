// scripts/lib/gaffer.mjs
// Shared helpers for gaffer's deterministic scripts. No external dependencies.
//
// Platform note: `git`/`gh` are real executables → spawned with shell:false
// (Windows CreateProcess appends .exe). `sh()` is shell:true for verify steps
// like `npm test`/`npm run build` (npm is a .cmd shim on Windows).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to this gaffer checkout (…/gaffer). */
export function gafferHome() {
  return process.env.GAFFER_HOME
    ? path.resolve(process.env.GAFFER_HOME)
    : path.resolve(__dirname, "..", "..");
}

export function nowIso() { return new Date().toISOString(); }
export function today() { return new Date().toISOString().slice(0, 10); }

export function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
export function writeJson(file, obj) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
}

/** Machine-readable result for the calling agent → stdout. */
export function out(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + "\n"); }
/** Diagnostics → stderr, so stdout stays pure JSON. */
export function log(level, msg, extra) {
  process.stderr.write(`[gaffer:${level}] ${msg}` + (extra ? " " + JSON.stringify(extra) : "") + "\n");
}

/** Minimal arg parser → { _: positional[], <flag>: value|true }. */
export function parseArgs(argv) {
  const res = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) res[key] = true;
      else { res[key] = next; i++; }
    } else res._.push(a);
  }
  return res;
}

/** Shell command string (for npm etc.). { code, stdout, stderr } */
export function sh(cmd, opts = {}) {
  const r = spawnSync(cmd, {
    shell: true, cwd: opts.cwd || process.cwd(), encoding: "utf8",
    timeout: opts.timeoutMs, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...(opts.env || {}) },
  });
  return { code: r.status == null ? 1 : r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

/** Real executable, no shell (correct arg passing, no quoting hazards). */
export function run(file, args, opts = {}) {
  const r = spawnSync(file, args, {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024, cwd: opts.cwd,
    env: { ...process.env, ...(opts.env || {}) },
  });
  return {
    code: r.status == null ? 1 : r.status, stdout: r.stdout || "", stderr: r.stderr || "",
    error: r.error ? String(r.error) : undefined,
  };
}

/** git with explicit repo dir. */
export function git(repoRoot, args, opts = {}) {
  return run("git", ["-C", repoRoot, ...args], opts);
}

export function findRepoRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

export function defaultPolicy() {
  return {
    version: 1,
    repo: { root: ".", baseBranch: "main", mergeTarget: "main", remote: "origin" },
    worktreeRoot: "../.gaffer-worktrees",
    stateDir: ".gaffer",
    autonomy: "full",
    requireGreenCI: true,
    verify: { timeoutSec: 1800, steps: [
      { name: "install", cmd: "npm ci", optional: true },
      { name: "typecheck", cmd: "npm run build", optional: false },
      { name: "test", cmd: "npm test", optional: false },
    ] },
    gates: { onMatch: "require-human-approval", escalateToken: "ESCALATE:", paths: [] },
    budget: { dailyTokens: 5000000, dailyUsd: 50, perRunTokens: 600000, onExceed: "block" },
    pr: { draft: false, labels: ["gaffer"], bodyFooter: "" },
  };
}

/** Merge: built-in defaults < packaged config/gaffer.policy.json < target repo .gaffer/policy.json */
export function loadPolicy(repoRoot) {
  const base = defaultPolicy();
  const packaged = readJson(path.join(gafferHome(), "config", "gaffer.policy.json")) || {};
  const repoPolicy = readJson(path.join(repoRoot, ".gaffer", "policy.json")) || {};
  const merged = { ...base, ...packaged, ...repoPolicy };
  for (const k of ["repo", "verify", "gates", "budget", "pr"]) {
    merged[k] = { ...(base[k] || {}), ...(packaged[k] || {}), ...(repoPolicy[k] || {}) };
  }
  return merged;
}

export function stateDir(repoRoot, policy) { return path.resolve(repoRoot, policy.stateDir || ".gaffer"); }
export function ledgerPath(repoRoot, policy) { return path.join(stateDir(repoRoot, policy), "ledger.json"); }
export function runDir(repoRoot, policy, ticketId) { return path.join(stateDir(repoRoot, policy), "runs", ticketId); }
export function worktreeRoot(repoRoot, policy) { return path.resolve(repoRoot, policy.worktreeRoot || "../.gaffer-worktrees"); }

// ---- Budget ---------------------------------------------------------------
export function loadLedger(repoRoot, policy) {
  return readJson(ledgerPath(repoRoot, policy), { days: {}, runs: {} });
}
export function recordBudget(repoRoot, policy, { tokens = 0, usd = 0, run } = {}) {
  const ledger = loadLedger(repoRoot, policy);
  const day = today();
  ledger.days[day] = ledger.days[day] || { tokens: 0, usd: 0, events: 0 };
  ledger.days[day].tokens += Number(tokens) || 0;
  ledger.days[day].usd += Number(usd) || 0;
  ledger.days[day].events += 1;
  if (run) {
    ledger.runs[run] = ledger.runs[run] || { tokens: 0, usd: 0 };
    ledger.runs[run].tokens += Number(tokens) || 0;
    ledger.runs[run].usd += Number(usd) || 0;
  }
  writeJson(ledgerPath(repoRoot, policy), ledger);
  return ledger.days[day];
}
export function budgetStatus(repoRoot, policy, { run, need = 0 } = {}) {
  const ledger = loadLedger(repoRoot, policy);
  const day = today();
  const d = ledger.days[day] || { tokens: 0, usd: 0, events: 0 };
  const caps = policy.budget || {};
  const runTokens = run && ledger.runs[run] ? ledger.runs[run].tokens : 0;
  const reasons = [];
  if (caps.dailyTokens && d.tokens + need > caps.dailyTokens)
    reasons.push(`daily token cap ${caps.dailyTokens} would be exceeded (used ${d.tokens}${need ? `, need ${need}` : ""})`);
  if (caps.dailyUsd && d.usd > caps.dailyUsd)
    reasons.push(`daily USD cap ${caps.dailyUsd} exceeded (used ${d.usd.toFixed(2)})`);
  if (caps.perRunTokens && run && runTokens + need > caps.perRunTokens)
    reasons.push(`per-run token cap ${caps.perRunTokens} would be exceeded (run used ${runTokens})`);
  return {
    ok: reasons.length === 0, day, used: d, caps, runTokens, reasons,
    remainingTokens: caps.dailyTokens ? Math.max(0, caps.dailyTokens - d.tokens) : null,
    remainingUsd: caps.dailyUsd ? Math.max(0, caps.dailyUsd - d.usd) : null,
  };
}

// ---- Glob matching (for gate paths) ---------------------------------------
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") { re += ".*"; i++; if (glob[i + 1] === "/") i++; }
      else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if ("/.+^${}()|[]\\".includes(c)) re += "\\" + c;
    else re += c;
  }
  return new RegExp("^" + re + "$");
}
export function matchAnyGlob(file, globs) {
  const norm = String(file).replace(/\\/g, "/");
  return (globs || []).some((g) => globToRegExp(g).test(norm) || globToRegExp("**/" + g).test(norm));
}
