// scripts/scaffold-org.mjs
// Deterministic team instantiation for `gaffer init`. Takes an org-plan.json
// (produced by the gaffer-init skill or hand-written) and:
//   1. generates each team's SOUL.md + AGENTS.md from templates,
//   2. computes the full desired agents.list (preserving cto + existing agents),
//   3. writes an OpenClaw config patch and applies it via `openclaw config patch`
//      (schema-validated, write-safe) — never hand-edits openclaw.json.
//
//   scaffold-org --plan <file> [--gaffer-home <dir>] [--apply] [--force]
//
// Default is PREVIEW: writes persona files + the patch, prints the apply command.
// --apply runs the validated patch. A gateway restart (by you) activates it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, readJson, writeJson, ensureDir, run, out, log, gafferHome } from "./lib/gaffer.mjs";

const uniq = (a) => [...new Set(a)];

function configPath() {
  return process.env.OPENCLAW_CONFIG_PATH
    || path.join(process.env.HOME || process.env.USERPROFILE || ".", ".openclaw", "openclaw.json");
}

function renderTemplate(home, name, vars) {
  let s = fs.readFileSync(path.join(home, "scripts", "templates", name), "utf8");
  for (const [k, v] of Object.entries(vars)) s = s.split(`{{${k}}}`).join(v);
  return s;
}

function teamEntry(home, t, otherIds) {
  return {
    id: t.id,
    identity: { name: t.name || t.id, theme: t.title || `${t.id} lead`, emoji: t.emoji || "🛠️" },
    workspace: path.join(home, "agents", t.id),
    model: t.model || "anthropic/claude-sonnet-4-6",
    tools: { profile: "coding", alsoAllow: ["sessions_yield", "subagents"] },
    subagents: { allowAgents: otherIds },
    skills: ["dev-pipeline"],
  };
}

function ctoEntry(home, model, teamIds) {
  return {
    id: "cto", default: true,
    identity: { name: "Avery", theme: "pragmatic engineering CTO", emoji: "🧭" },
    workspace: path.join(home, "agents", "cto"),
    model: model || "anthropic/claude-opus-4-8",
    tools: { profile: "coding", alsoAllow: ["sessions_yield", "subagents"] },
    subagents: { allowAgents: teamIds, delegationMode: "prefer" },
    skills: ["initiative", "gaffer-init"],
  };
}

export function main(argv) {
  const args = parseArgs(argv);
  if (!args.plan) { out({ ok: false, error: "scaffold-org requires --plan <org-plan.json>" }); return 2; }

  const plan = readJson(path.resolve(args.plan));
  if (!plan || !Array.isArray(plan.teams) || plan.teams.length === 0) {
    out({ ok: false, error: "plan must be JSON with a non-empty teams[] array" }); return 2;
  }
  for (const t of plan.teams) {
    if (!t.id || !Array.isArray(t.ownedPaths)) {
      out({ ok: false, error: `each team needs an id and ownedPaths[]; offending: ${JSON.stringify(t)}` }); return 2;
    }
  }

  const home = args["gaffer-home"] ? path.resolve(args["gaffer-home"]) : gafferHome();
  const repo = path.resolve(plan.repo || args.repo || ".");
  const ctoModel = (plan.cto && plan.cto.model) || "anthropic/claude-opus-4-8";
  const teamIds = plan.teams.map((t) => t.id);

  // 1) Persona files (skip existing unless --force)
  const created = [];
  for (const t of plan.teams) {
    const dir = path.join(home, "agents", t.id);
    const vars = {
      ID: t.id,
      NAME: t.name || t.id,
      TITLE: t.title || `${t.id} lead`,
      PERSONA: t.persona || `Lead of the ${t.id} team.`,
      OWNED_PATHS: t.ownedPaths.map((p) => "- `" + p + "`").join("\n"),
      OTHER_TEAMS: teamIds.filter((id) => id !== t.id).join(" / ") || "(no peer teams yet)",
    };
    for (const [file, tmpl] of [["SOUL.md", "team.SOUL.md"], ["AGENTS.md", "team.AGENTS.md"]]) {
      const fp = path.join(dir, file);
      if (fs.existsSync(fp) && !args.force) { log("info", `skip existing ${fp}`); continue; }
      ensureDir(dir);
      fs.writeFileSync(fp, renderTemplate(home, tmpl, vars));
      created.push(fp);
    }
  }

  // 2) Merge into the current agents.list (read the config file directly — avoids CLI banter)
  const cfg = readJson(configPath());
  if (cfg === null) {
    out({ ok: false, error: `could not read/parse ${configPath()} as JSON; fix the config first` }); return 3;
  }
  const current = (cfg.agents && Array.isArray(cfg.agents.list)) ? cfg.agents.list : [];
  const byId = new Map(current.map((a) => [a.id, a]));

  // ensure cto exists / is wired to all teams
  if (!byId.has("cto")) {
    byId.set("cto", ctoEntry(home, ctoModel, teamIds));
  } else {
    const c = byId.get("cto");
    c.subagents = { ...(c.subagents || {}), allowAgents: uniq([...(c.subagents?.allowAgents || []), ...teamIds]) };
    c.skills = uniq([...(c.skills || []), "initiative", "gaffer-init"]);
  }
  // upsert each team (cross-review = every other team)
  for (const t of plan.teams) byId.set(t.id, teamEntry(home, t, teamIds.filter((id) => id !== t.id)));

  const desiredList = [...byId.values()];

  // 3) Build the patch (arrays replace; objects merge — per `openclaw config patch`)
  const patch = {
    agents: {
      defaults: { subagents: { maxSpawnDepth: 2, maxConcurrent: 4, maxChildrenPerAgent: 5, runTimeoutSeconds: 1800 } },
      list: desiredList,
    },
    tools: { agentToAgent: { enabled: true, allow: ["cto", ...teamIds] } },
    bindings: [{ agentId: "cto", match: { channel: "webchat", accountId: "*" } }],
  };
  const patchPath = path.join(repo, ".gaffer", "org.patch.json5");
  writeJson(patchPath, patch);

  const summary = plan.teams.map((t) => ({ id: t.id, model: t.model || "sonnet", owns: t.ownedPaths }));

  // 4) Apply or preview
  if (args.apply) {
    const dry = run("openclaw", ["config", "patch", "--file", patchPath, "--dry-run"]);
    if (dry.code !== 0) {
      out({ ok: false, stage: "dry-run", stderr: dry.stderr || dry.error, patch: patchPath, teams: summary, createdFiles: created });
      return 5;
    }
    const ap = run("openclaw", ["config", "patch", "--file", patchPath]);
    if (ap.code !== 0) {
      out({ ok: false, stage: "apply", stderr: ap.stderr || ap.error, patch: patchPath });
      return 6;
    }
    out({ ok: true, applied: true, teams: summary, createdFiles: created, patch: patchPath,
      next: "Activate the new teams: openclaw gateway restart" });
    return 0;
  }

  out({ ok: true, applied: false, teams: summary, createdFiles: created, patch: patchPath,
    apply: `openclaw config patch --file "${patchPath}" && openclaw gateway restart`,
    note: "Preview only. Review the patch, then run the apply command above (or re-run with --apply)." });
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
