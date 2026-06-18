# Architecture

`gaffer` is an **OpenClaw agent pack**. OpenClaw provides the platform; gaffer provides
the org and the engineering guarantees. Nothing here re-implements a gateway, a UI, a
scheduler, or a sandbox — those are inherited.

## The split: OpenClaw vs. gaffer

| Concern | Provided by OpenClaw | Provided by gaffer |
| --- | --- | --- |
| Long-running server, web UI, channels | Gateway daemon, WebChat, Slack/Discord/… | — |
| Editing agent prompts in the UI | `agents.files.set` over `SOUL.md`/`AGENTS.md` | the personas themselves (`agents/`) |
| Multiple isolated agents + routing | `agents.list[]`, `bindings[]`, per-agent workspace/model/tools | the CTO + team definitions (`config/openclaw.example.json5`) |
| CTO → team handoff | `sessions_spawn({ agentId, cwd })`, `subagents.allowAgents`, `maxSpawnDepth` | the `initiative` + `dev-pipeline` skills |
| Peer Q&A between teams | `tools.agentToAgent` | enabling + allowlist |
| 24/7 + standup | native `cron` (at/every/cron+tz, announce-to-channel) + OS daemon | job definitions (deferred in v0) |
| Human approval for risky actions | exec-approval, RBAC scopes | the gate path list + `ESCALATE` protocol |
| Multi-LLM | `provider/model-id` + fallbacks | per-team model tiers |
| **Spend cap** | *(none — no native budget primitive)* | **`scripts/budget.mjs`** ledger + guard |
| **Deterministic build pipeline** | `exec` tool (runs shell, real exit codes) | **`scripts/pipeline.mjs`** |

## The loop

```
human ──▶ CTO (webchat / Slack)
            │  initiative skill: clarify → decompose → write ticket → dispatch
            ▼
       sessions_spawn(agentId:"<team>", cwd: TARGET_REPO, task: ticket)   [depth 1]
            │  dev-pipeline skill drives pipeline.mjs at each checkpoint:
            ▼
  start(worktree) ─▶ implement ─▶ gate-check ─▶ cross-review ─▶ verify ─▶ open-pr
                                      │            │ (sessions_spawn other team [depth 2])
                                      │            ▼
                                  gated? ──yes──▶ ESCALATE: + stop (human signs off)
                                      │
                                   budget guard (block over cap)
                                      ▼
                                 PR → base branch (never main); human merges
```

**Division of labor:** the LLM decides *what* to build and *whether a review passes*. The
script decides *whether the build is green*, *whether a gated path was touched*, and
*whether spend is under the cap* — in code, with real exit codes. Skills are the thin
runbook between them. That's why a confidently-wrong agent still can't merge a red build,
slip a money-path change past a human, or blow the budget.

## Why teams are *configured agents*, not ad-hoc spawns

OpenClaw injects only `AGENTS.md` + `TOOLS.md` into a spawned sub-agent — **not** `SOUL.md`.
So each team is a real `agents.list[]` entry with its own workspace, and its operating
rules live in `AGENTS.md` (which is injected). `SOUL.md` is the direct-chat persona. The
CTO, which you talk to directly, gets its full `SOUL.md`.

## Repo map

```
config/   openclaw.example.json5   the org chart (merge into ~/.openclaw/openclaw.json)
          gaffer.policy.json       generic deterministic-pipeline policy (→ target repo .gaffer/policy.json)
agents/   <id>/SOUL.md, AGENTS.md  per-agent persona + operating rules (version-controlled;
                                   the web UI edits these in place)
skills/   initiative/SKILL.md      CTO dispatch runbook
          dev-pipeline/SKILL.md    team build/review/PR runbook
scripts/  pipeline.mjs             deterministic: worktree, verify (CI gate), gates, PR
          budget.mjs               token/$ ledger + guard
          lib/gaffer.mjs           shared helpers
          gaffer.mjs               `gaffer` bin dispatcher
examples/crew-os/                  a concrete target-repo configuration
```

## Deferred (v0 → v1)

- **Sandboxed autonomous push.** v0 opens PRs with your **local `gh`** on the main
  (non-sandboxed) session. Production should run build agents in OpenClaw's Docker
  sandbox with a provisioned image (git/node), egress enabled, and a deliberate
  credential-injection choice — or a dedicated SSH build host. See [autonomy.md](autonomy.md).
- **Turn-level budget enforcement.** v0's guard is enforced at pipeline checkpoints
  (tier 1). Hard per-turn enforcement needs a typed OpenClaw plugin hook
  (`before_tool_call`). See [budget.md](budget.md).
- **Standup / bug-sweep cron jobs**, more teams, multi-provider tuning.
