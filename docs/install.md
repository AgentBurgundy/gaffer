# Install & wiring

## Prerequisites

- A working **[OpenClaw](https://docs.openclaw.ai/install)** install (gateway onboarded).
- **node ≥ 18**, **git**, and the **GitHub CLI [`gh`](https://cli.github.com/)** authenticated
  (`gh auth status`).
- A target git repo with a GitHub remote.

## 1. Get gaffer and set env

```bash
git clone <your-fork>/gaffer.git
export GAFFER_HOME="/abs/path/to/gaffer"          # this checkout
export GAFFER_TARGET_REPO="/abs/path/to/your-repo" # the repo the org works on
# (Windows: setx GAFFER_HOME "F:\code\gaffer", etc.)
```

## 2. Wire the org into OpenClaw

Merge `config/openclaw.example.json5` into `~/.openclaw/openclaw.json` (or keep it as your
config). Then:

- Replace every `<ABS_PATH_TO_GAFFER>` with `$GAFFER_HOME`.
- Confirm each agent's `workspace` points at `$GAFFER_HOME/agents/<id>` — this makes the
  personas version-controlled, and **editing a prompt in the OpenClaw web UI writes straight
  back to the tracked `SOUL.md`/`AGENTS.md`** (it shows up in `git diff`).
- Confirm `skills.load.extraDirs` includes `$GAFFER_HOME/skills`.
- Set `skills.entries.dev-pipeline.env` to include `GAFFER_HOME` and `GAFFER_TARGET_REPO`.

## 3. Configure the target repo

Copy a policy into the target repo and tune it:

```bash
mkdir -p "$GAFFER_TARGET_REPO/.gaffer"
cp "$GAFFER_HOME/config/gaffer.policy.json" "$GAFFER_TARGET_REPO/.gaffer/policy.json"
# crew-os users: copy examples/crew-os/gaffer.policy.json instead.
```

Set `repo.baseBranch`/`mergeTarget`, the `verify.steps` (your test/build commands), and the
`gates.paths` (your money/auth/migration globs). Add `.gaffer/` to the target repo's
`.gitignore` (gaffer's runtime state lives there).

## 4. Restart & verify

```bash
openclaw gateway restart
openclaw agents list           # cto, scheduling, jobs
openclaw skills list           # initiative, dev-pipeline (enabled)
```

## 5. Run an initiative

Open the OpenClaw web UI, message the CTO (`cto` is bound to webchat):

> **Initiative:** add a guard that rejects scheduling a job into a past date, with a test.

Watch it decompose → dispatch to `scheduling` → build in a worktree → cross-review with
`jobs` → verify → open a PR. Check spend any time with:

```bash
node "$GAFFER_HOME/scripts/budget.mjs" report --repo "$GAFFER_TARGET_REPO"
```

## Turning on Slack (later)

Add a `channels.slack` block (token + app token) and a binding
`{ agentId: "cto", match: { channel: "slack", accountId: "*" } }`, then restart. Now you
talk to the CTO from Slack instead of (or in addition to) the web UI.
