# gaffer 🪖

> **An AI software-development org that runs itself.**
> A CTO you chat with, plus specialized team agents that plan, build, review each
> other's code, and ship pull requests — autonomously, 24/7, on a token budget.

`gaffer` is an **[OpenClaw](https://github.com/openclaw/openclaw) agent pack**. It is *not* a
new platform. It stands on OpenClaw's gateway, web UI, channels (Slack/Discord/…),
scheduler, sandbox, and multi-agent runtime, and adds the ~20% that turns a
general assistant framework into an autonomous engineering organization:

- an **org chart** (`config/`, `agents/`) — a CTO plus per-subsystem teams, each with
  its own persona, owned code paths, model tier, and tool scope;
- two **skills** (`skills/`) — `initiative` (the CTO decomposes a goal and dispatches it)
  and `dev-pipeline` (a team builds, gets cross-reviewed, and opens a PR);
- a **deterministic pipeline** (`scripts/pipeline.mjs`) — the part that must be exact:
  git worktrees, the test/build CI gate (real exit codes), money/auth path gates, and PR creation;
- a **budget guard** (`scripts/budget.mjs`) — a hard token/$ ceiling, because an
  autonomous org you can't cap is an autonomous bill you can't cap.

> **Name:** `gaffer` (British/film-set for "foreman") is a working placeholder — rename freely.
> "Foreman" is taken in OSS, so this avoids the collision.

## Why "on OpenClaw"?

Everything below is inherited for free; we don't rebuild any of it:

| You get from OpenClaw | We add |
| --- | --- |
| Gateway daemon + **web UI** (chat + edit any agent's `SOUL.md`/`AGENTS.md` live) | the org's personas & policy |
| **Talk to the CTO** in the browser now; flip on Slack later (one config block) | the `initiative` dispatch skill |
| `sessions_spawn` CTO→team handoff + `maxSpawnDepth` orchestrator tree | the `dev-pipeline` build/review/PR skill |
| Native **cron** (24/7, daily standup → posted to a channel) | standup/sweep job definitions |
| Docker **sandbox** + human **exec-approval** gating | the money/auth gate list + `ESCALATE` protocol |
| Multi-LLM (`provider/model-id` + fallbacks) | per-team model tiers |
| — *no native spend cap* — | the **budget ledger + guard** |

## How a feature ships (the loop)

```
you ──▶ CTO (web UI / Slack)
          │  initiative skill: decompose into per-team tickets
          ▼
       sessions_spawn(agentId: "<team>", cwd: <git worktree>)
          │  dev-pipeline skill, calling pipeline.mjs at each checkpoint:
          ▼
   start ─▶ implement ─▶ cross-team review ─▶ verify (test+build, real exit codes)
          │                                        │
          │                                  gate-check (money/auth paths?)
          │                          ┌─────────────┴─────────────┐
          │                        clear                       gated
          ▼                          ▼                           ▼
       budget guard ───────▶  open PR (gh, → staging)     ESCALATE + stop for human
```

The **judgment** (what to build, is this review acceptable) is the LLM. The
**guarantees** (a build either passes or it doesn't; a money-path change cannot
merge without a human; spend cannot exceed the cap) live in `pipeline.mjs` and
`budget.mjs` as plain code with real exit codes. Skills are the thin runbook
wiring the two together.

## Status

**v0 / walking skeleton.** Proves one loop end-to-end against a target repo with two
teams. Deliberately deferred (see [docs/architecture.md](docs/architecture.md)):
turn-level budget enforcement via a typed OpenClaw plugin hook, sandbox-hardened
autonomous `git push` (v0 opens PRs with your **local `gh`** on the main session),
the standup/sweep cron jobs, and more teams.

## Quickstart

You need: a working [OpenClaw](https://docs.openclaw.ai/install) install, `node >=18`,
`git`, and the GitHub CLI [`gh`](https://cli.github.com/) authenticated.

1. Clone this repo and set `GAFFER_HOME` to it.
2. Point OpenClaw at the pack: copy `config/openclaw.example.json5` into your
   `~/.openclaw/openclaw.json` (or merge the `agents`, `bindings`, and `skills.load`
   blocks), and edit the workspace paths + your target repo path.
3. Copy `config/gaffer.policy.json` into your **target repo** as `.gaffer/policy.json`
   and tune the gate paths + verify commands for that repo.
4. `openclaw gateway restart`, open the web UI, and message the CTO:
   *"Initiative: <one small change>."*

Full steps: **[docs/install.md](docs/install.md)**. Pointed at the bundled
example (a real contractor-CRM repo): **[examples/crew-os/](examples/crew-os/)**.

## Docs

- [docs/architecture.md](docs/architecture.md) — how the pack maps onto OpenClaw primitives, and what's deferred
- [docs/autonomy.md](docs/autonomy.md) — autonomy levels, the gate list, `ESCALATE`, merge policy
- [docs/budget.md](docs/budget.md) — the three tiers of spend enforcement and why v0 ships tier 1
- [docs/install.md](docs/install.md) — install & wiring
- [docs/init.md](docs/init.md) — `gaffer init`: survey a repo + vision, auto-split it into feature teams, and scaffold them

## License

MIT © 2026 Ronald Barnhart
