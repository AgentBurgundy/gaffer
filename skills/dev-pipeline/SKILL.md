---
name: dev-pipeline
description: "Team runbook: build a ticket into a cross-reviewed, verified pull request using the deterministic gaffer pipeline. Use when you are spawned with a ticket to implement, or asked to review another team's diff."
metadata:
  {
    "openclaw":
      {
        "emoji": "🛠️",
        "requires":
          {
            "anyBins": ["node", "git", "gh"],
            "config": ["skills.entries.dev-pipeline.enabled"],
          },
      },
  }
---

# Dev Pipeline

You build a ticket into a reviewed, verified PR. The **deterministic** steps (worktree,
gate-check, verify, PR) are a Node CLI that returns JSON on stdout and real exit codes —
you read its JSON and react. You provide the **judgment** and the actual code.

## Environment

- `$GAFFER_HOME` — this pack (contains `scripts/`).
- `$GAFFER_TARGET_REPO` — the repo you build in.

> Commands below are bash-style (OpenClaw's `exec` convention). On a Windows host use the
> equivalent env-var syntax if your gateway's exec shell differs.

## If you were spawned to REVIEW a diff

The task contains a diff and asks for review. **Do not run the pipeline.** Read the diff,
check correctness, edge cases, tenant-isolation/security, and your-domain semantics.
Reply with exactly `REVIEW: PASS` or a short numbered list of **must-fix** items. Stop.

## Build runbook

1. **Start** — create your isolated worktree:
   ```
   node "$GAFFER_HOME/scripts/pipeline.mjs" start --ticket "<ticketPath>" --repo "$GAFFER_TARGET_REPO"
   ```
   Read the JSON; note `worktree` (call it `$WT`) and `base`.
2. **Implement** the smallest change that satisfies the ticket, INSIDE `$WT`, using
   `read`/`write`/`edit`. Read neighboring code first and match its style. Add or adjust
   tests for the behavior you changed.
3. **Gate-check:**
   ```
   node "$GAFFER_HOME/scripts/pipeline.mjs" gate-check --worktree "$WT"
   ```
   If `gated: true`, reply exactly `ESCALATE: touches gated paths (<gatedFiles>)` and **stop**.
4. **Cross-team review:**
   - Capture the diff: `git -C "$WT" diff <base>`
   - Spawn the *other* team to review (then `sessions_yield`):
     ```
     sessions_spawn({ agentId: "<other-team>", cwd: "$WT",
       task: "Review this diff. Return REVIEW: PASS or a numbered must-fix list.\n\n<diff>" })
     ```
   - Address every must-fix item. Re-review if the changes were substantial.
5. **Verify (the CI gate):**
   ```
   node "$GAFFER_HOME/scripts/pipeline.mjs" verify --worktree "$WT"
   ```
   Proceed only on `ok: true` (exit 0). On failure, read each step's `tail`, fix, re-run.
   Never proceed on red.
6. **Record spend** — from each sub-agent's announce stats line (tokens + est. cost):
   ```
   node "$GAFFER_HOME/scripts/budget.mjs" record --tokens <N> --usd <X> --run <ticketId> --repo "$GAFFER_TARGET_REPO"
   ```
7. **Open the PR:**
   ```
   node "$GAFFER_HOME/scripts/pipeline.mjs" open-pr --worktree "$WT"
   ```
   - `ok: true` → report `prUrl` to the CTO.
   - `refused: "gated"` → `ESCALATE:` and stop.
   - `refused: "verify-failed"` → fix, back to step 5.
   - `refused: "over-budget"` → report remaining budget and stop (do not retry-loop).

## Report

Your final message to the CTO is the PR URL **or** a single `ESCALATE:`/blocker line,
plus a one-line cost note. Never claim a pass you didn't get from `verify`.

## Hard rules

- Work only inside `$WT`. Keep the diff small and on-ticket.
- Never touch gated paths (money / auth / tenancy / migrations) — `ESCALATE:` instead.
- Changed behavior needs a test. A green build with no new test for new logic is not done.
