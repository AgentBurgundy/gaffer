# `gaffer init` — staff an org from a repo + a vision

Point gaffer at any repository, describe the app and where it's headed, and it splits the
codebase into feature teams and scaffolds them as live agents. Two halves, true to
gaffer's design:

- **`gaffer-init` skill** (LLM judgment) — the CTO surveys the repo + your vision and
  produces an **org plan**.
- **`scaffold-org.mjs` script** (deterministic) — turns the plan into persona files and a
  **schema-validated** config patch. It never hand-edits `openclaw.json`.

## Run it (via the CTO)

In the dashboard WebChat (or Slack), tell Avery:

> **gaffer init** the repo at `/abs/path/to/repo`. Here's the app and the vision: *[2–5
> sentences — what it does, who it's for, where it's going, what matters most]*. Propose
> the teams.

The CTO reads the repo, splits it into 3–6 feature teams, writes the plan to
`<repo>/.gaffer/org-plan.json`, and runs a **preview** scaffold. It shows you the proposed
teams and the apply command. When you approve, it applies and tells you to restart.

## Run it (by hand)

You can also write the plan yourself and scaffold directly:

```bash
# preview (writes persona files + .gaffer/org.patch.json5, changes nothing live)
node "$GAFFER_HOME/scripts/scaffold-org.mjs" --plan /abs/path/to/repo/.gaffer/org-plan.json

# apply (validated patch) then activate
node "$GAFFER_HOME/scripts/scaffold-org.mjs" --plan .../org-plan.json --apply
openclaw gateway restart
```

## The org plan

```json
{
  "repo": "/abs/path/to/repo",
  "vision": "one-line summary",
  "cto": { "model": "anthropic/claude-opus-4-8" },
  "teams": [
    {
      "id": "scheduling",
      "name": "Sam",
      "title": "scheduling & calendar lead",
      "persona": "obsessive about timezone and availability correctness",
      "ownedPaths": ["server/**/schedule*", "client/src/**/schedule/**"],
      "model": "anthropic/claude-sonnet-4-6",
      "gatedBorders": []
    }
  ]
}
```

`id` and `ownedPaths` are required per team; the rest have sensible defaults.

## What scaffold-org does

1. Generates `agents/<id>/SOUL.md` + `AGENTS.md` for each team from
   `scripts/templates/` (skips existing files unless `--force`), filling in the persona
   and owned paths.
2. Reads your current `agents.list` straight from the config file, then computes the full
   desired list — **preserving the CTO and any existing agents**, adding/updating the
   plan's teams, and wiring cross-team review (`subagents.allowAgents` = every other team).
3. Writes `<repo>/.gaffer/org.patch.json5` and, with `--apply`, runs
   `openclaw config patch --file … --dry-run` then the real patch (OpenClaw validates the
   full post-change config and refuses anything that wouldn't load — so a bad plan can't
   corrupt your gateway).

## Safety

- **Preview by default.** Nothing touches your live config until you pass `--apply`.
- **No hand-editing.** The config write goes through `openclaw config patch`, which is
  schema-validated and write-safe (it saves a `.rejected` copy on failure rather than
  clobbering the active config).
- **You restart.** The script never restarts the gateway; it prints the command and lets
  you do it.
- **Idempotent.** Re-run after editing the plan; it converges instead of duplicating.
