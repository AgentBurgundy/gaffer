# Example: pointing gaffer at crew-os

[crew-os](https://github.com/) is a multi-tenant contractor-CRM (Node/Express/TS +
React/Vite + Prisma). It's a good first target: clear subsystems, a real test suite, and a
`CLAUDE.md` that already documents its "Stop and ask" zones — which map directly onto
gaffer's gate list.

## Mapping crew-os onto the two starter teams

| Team | crew-os subsystem (illustrative `ownedPaths`) |
| --- | --- |
| `scheduling` | `server/**/schedule*`, crew/resource availability, `client/src/**/schedule/**`, day-fit & reschedule |
| `jobs` | job CRUD + lifecycle/state transitions, `server/**/pipeline*`, job-service relationships |

(Add `money`, `portal`, `platform` teams later as `agents.list[]` entries + skill grants.)

## Setup

1. `export GAFFER_TARGET_REPO="F:/code/crew-os"` (and `GAFFER_HOME` to your gaffer checkout).
2. Copy the crew-os policy into the repo:
   ```bash
   mkdir -p "$GAFFER_TARGET_REPO/.gaffer"
   cp "$GAFFER_HOME/examples/crew-os/gaffer.policy.json" "$GAFFER_TARGET_REPO/.gaffer/policy.json"
   ```
   Add `.gaffer/` to crew-os's `.gitignore`.
3. Use `examples/crew-os/openclaw.crew-os.json5` as your OpenClaw config (paths pre-filled
   for `F:/code/gaffer` + `F:/code/crew-os`), or merge its blocks into `~/.openclaw/openclaw.json`.
4. `openclaw gateway restart`, then message the CTO an initiative.

## crew-os specifics baked into the policy

- **Base/merge target = `staging`.** crew-os's workflow is *all PRs target `staging`, never
  `main`* — `gaffer.policy.json` reflects that.
- **Gates = crew-os's "Stop and ask" zones:** billing/stripe, `auth.ts`, `permissions.ts`,
  `resolveOrg*`, Prisma migrations + `schema.prisma`. A team touching any of these will
  `ESCALATE:` instead of opening a PR.
- **Verify = `npm ci` → `npm run build` → `npm test`** (Vitest). Tune in the policy if you
  want the client/portal builds gated too.

> Multi-tenancy reminder: crew-os treats a cross-org data leak as P0. The cross-team review
> step is where that gets caught — both reviewer personas are told to check tenant isolation.
