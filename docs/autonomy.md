# Autonomy & guardrails

gaffer is built to run **fully autonomously**, but autonomy is *policy* — and policy is
per-repo config. The guardrails below are what make autonomous merging safe rather than a
footgun. All of it lives in `.gaffer/policy.json` in the target repo.

## Autonomy levels (`autonomy`)

| Level | Behavior |
| --- | --- |
| `full` | Teams build, cross-review, verify, and open PRs without asking. (Merge is still human in v0.) |
| `propose` | Same, but never pushes — produces the branch + diff locally for a human to push/PR. |
| `off` | Pipeline disabled; agents can plan/review but not build. |

## The two things that make autonomous merge safe

1. **Green CI before PR (`requireGreenCI: true`).** `pipeline open-pr` refuses unless
   `pipeline verify` passed (tests + build, real exit codes). Without this, "autonomous
   merge" eventually means "autonomous breakage."
2. **A gate list for irreversible zones (`gates.paths`).** Any changed file matching a gate
   glob makes `pipeline gate-check` flag it and `open-pr` refuse (exit 4) unless a human
   passes `--approved`. The team emits `ESCALATE:` and stops. You don't take gaffer's word
   for which paths — *you* list them. For crew-os these are exactly the CLAUDE.md
   "Stop and ask" zones: `server/billing/**`, `server/stripe*.ts`, `server/auth.ts`,
   `server/permissions.ts`, `server/middleware/resolveOrg*`, `prisma/migrations/**`.

Set `gates.paths: []` to disable gating entirely — but keep money/auth/migrations gated.
They're irreversible and P0, not timidity.

## Merge target

PRs always open against `repo.mergeTarget` (e.g. `staging`), **never `main` directly**.
Merging is a human action in v0; gaffer never merges its own work.

## The `ESCALATE` protocol

When a team can't proceed safely (gated paths, ambiguous spec, repeated verify failure), it
replies with a single line beginning with the configured token (default `ESCALATE:`) and
stops. The CTO surfaces this to the human verbatim and never resolves a gated escalation
itself. This mirrors crew-os's own autonomous-agent rule (`ESCALATE: <reason>`).

## Sandbox & credentials (the v0 cut)

The build pipeline runs `git`/`gh` to push and open PRs. In v0 it runs on the **main
(non-sandboxed) session** and uses **your local `gh` credentials** — simplest, and fine for
running against your own repo on your own machine.

Before granting real autonomy on shared infrastructure, harden this:

- Run team/build sessions in OpenClaw's Docker **sandbox** (`agents.defaults.sandbox.mode:
  "non-main"`), which is default-deny (read-only root, `network: "none"`, no workspace mount,
  credential paths blocked).
- Provision a build image with `git`/`node`, enable egress (`docker.network: "bridge"`),
  mount the target repo `rw`, and inject a **scoped** push/PR token deliberately (a mounted
  secret or a dedicated SSH build host — *not* a broad PAT in `docker.env`, which leaks via
  `docker inspect`).

Until then, treat gaffer as "autonomous within one trusted machine."
