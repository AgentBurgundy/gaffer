# Budget & spend control

OpenClaw has **no native spend cap** (it records usage telemetry and pricing, but enforces
no ceiling). For an autonomous org you self-fund, an uncapped agent is an uncapped bill —
so gaffer ships its own budget primitive.

## The ledger

`scripts/budget.mjs` maintains a JSON ledger at `<target-repo>/.gaffer/ledger.json` with
per-day and per-run buckets:

```
budget record --tokens N [--usd X] [--run ID]   # add usage
budget check  [--run ID] [--need-tokens N]       # exit 0 ok / exit 3 over-cap
budget report                                    # today's usage vs caps
```

Caps come from `.gaffer/policy.json`:

```json
"budget": { "dailyTokens": 5000000, "dailyUsd": 50, "perRunTokens": 600000, "onExceed": "block" }
```

Feed it real numbers: every OpenClaw sub-agent completion includes an **announce stats
line** (runtime, input/output tokens, estimated cost when model pricing is configured). The
`dev-pipeline` skill instructs each team to `budget record` those figures keyed to the run.
It's provider-agnostic — works for Claude, GPT, Gemini, whatever the announce reports.

## Three tiers of enforcement

| Tier | What it caps | Status |
| --- | --- | --- |
| **1 — checkpoint guard** | The pipeline calls `budget check` and `open-pr` refuses (exit 6) when over cap. Bounds the expensive build/PR work. | ✅ shipped (v0) |
| **2 — dispatch discipline** | The CTO tracks the running tally and stops dispatching when the day's budget is spent. | ✅ via `initiative` skill (soft) |
| **3 — turn-level hard stop** | Cap the agents' *own* reasoning tokens, aborting a turn mid-flight when the cap is hit. | ⛔ follow-up |

Tier 3 needs a typed OpenClaw **plugin hook** (`before_tool_call` / `before_agent_reply`) —
internal file hooks can observe lifecycle events but cannot block a tool call. That's a
small OpenClaw plugin (Plugin SDK) that reads the ledger and refuses the call when over cap.
Documented as the next increment; v0 deliberately ships tiers 1–2, which already bound the
costly autonomous actions.

## Tuning

- Start conservative (`dailyTokens` low) and watch `budget report`.
- `onExceed: "block"` hard-stops; set `"warn"` to log-and-continue while you calibrate.
- Per-run cap (`perRunTokens`) catches a single runaway ticket without throttling the day.
