---
name: gaffer-init
description: "Staff an engineering org for a repo: read the whole codebase plus the owner's app description and vision, split it into feature teams, and scaffold them as live gaffer agents. Use when the owner says 'init this repo', 'staff this codebase', 'gaffer init', or hands you a repo + a vision to organize teams around."
metadata:
  {
    "openclaw":
      {
        "emoji": "🧱",
        "requires":
          {
            "anyBins": ["node", "git"],
            "config": ["skills.entries.gaffer-init.enabled"],
          },
      },
  }
---

# Gaffer Init

Turn a repository + the owner's vision into a staffed engineering org. You (the CTO)
survey the codebase, split it into feature teams, and scaffold them as real gaffer
agents. The split is **judgment**; the instantiation is a deterministic script.

## Inputs

- The target repo path (absolute).
- The owner's **app description + greater vision** (from their message). If either is
  missing, ask once — the vision decides *how* you split (by feature, by layer, by risk).
- Env: `$GAFFER_HOME` (this pack).

## Steps

1. **Survey the repo, read-only** (don't build or edit anything; sample, don't read it all):
   - directory shape: `git -C <repo> ls-files | sed 's#/[^/]*$##' | sort -u | head -60`
   - read `README*`, the manifest (`package.json`/`pyproject.toml`/…), any `CLAUDE.md`/`AGENTS.md`, and the tops of the main source dirs
   - note the languages, the build/test commands, and any money / auth / migration / tenancy areas
2. **Split into 3–6 feature teams**, biased to the owner's vision — organize around the
   features and outcomes they care about, not just folders. Each team owns a coherent
   slice with minimal overlap.
3. For each team decide: `id` (kebab-case), `name` (human, e.g. "Sam"), `title`,
   `persona` (one line — what they care about / guard), `ownedPaths` (real globs from the
   repo), `model` (`anthropic/claude-opus-4-8` for complex/risky areas,
   `anthropic/claude-sonnet-4-6` for routine), and `gatedBorders` (money/auth/migration/
   tenancy paths they border).
4. **Write the plan** with the `write` tool to `<repo>/.gaffer/org-plan.json`:
   ```json
   {
     "repo": "<abs repo path>",
     "vision": "<one-line summary of the owner's vision>",
     "cto": { "model": "anthropic/claude-opus-4-8" },
     "teams": [
       { "id": "payments", "name": "Robin", "title": "payments lead",
         "persona": "owns money flows; paranoid about rounding and idempotency",
         "ownedPaths": ["server/billing/**", "server/stripe*.ts"],
         "model": "anthropic/claude-opus-4-8",
         "gatedBorders": ["server/billing/**"] }
     ]
   }
   ```
5. **Preview the scaffold** (changes nothing live — generates persona files + a patch):
   ```
   node "$GAFFER_HOME/scripts/scaffold-org.mjs" --plan "<repo>/.gaffer/org-plan.json"
   ```
6. **Present to the owner**: the subsystem map, the proposed teams as a table, and the
   apply command the preview printed. Ask them to confirm. On a yes, apply:
   ```
   node "$GAFFER_HOME/scripts/scaffold-org.mjs" --plan "<repo>/.gaffer/org-plan.json" --apply
   ```
   then tell them to run **`openclaw gateway restart`** to activate the teams — you cannot
   restart your own gateway mid-turn.

## Rules

- Read-only survey. Never modify the target repo or build anything during init.
- Keep it to 3–6 teams. Overlapping ownership is a smell — split on clear boundaries.
- Never auto-apply without the owner's OK, and never restart the gateway yourself.
- Token-aware: sample files; don't read the entire repo into context.
- Re-running is safe: `scaffold-org` is idempotent — it preserves the CTO and existing
  agents, and only adds/updates the teams in the plan.
