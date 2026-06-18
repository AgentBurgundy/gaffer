// scripts/budget.mjs
// Token/$ spend ledger + guard — gaffer's hard ceiling on autonomous spend.
//
//   budget record --tokens N [--usd X] [--run ID]   # add usage (from announce stats)
//   budget check  [--run ID] [--need-tokens N]      # exit 0 ok / exit 3 over-cap
//   budget report                                   # today's usage vs caps
//
// Tier-1 enforcement: the pipeline calls `check` before expensive steps and
// refuses to open a PR when over budget. Turn-level enforcement (capping the
// agents' own reasoning tokens) needs a typed OpenClaw plugin hook — see
// docs/budget.md. This script is provider-agnostic: feed it the token/cost
// numbers from each sub-agent's announce stats line.
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseArgs, findRepoRoot, loadPolicy, recordBudget, budgetStatus, out, log,
} from "./lib/gaffer.mjs";

export function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  const repoRoot = args.repo ? path.resolve(args.repo) : findRepoRoot();
  const policy = loadPolicy(repoRoot);

  if (cmd === "record") {
    const day = recordBudget(repoRoot, policy, {
      tokens: Number(args.tokens || 0), usd: Number(args.usd || 0), run: args.run,
    });
    out({ ok: true, recorded: { tokens: Number(args.tokens || 0), usd: Number(args.usd || 0), run: args.run || null }, today: day });
    return 0;
  }

  if (cmd === "check") {
    const status = budgetStatus(repoRoot, policy, { run: args.run, need: Number(args["need-tokens"] || 0) });
    out(status);
    return status.ok ? 0 : 3;
  }

  if (cmd === "report" || !cmd) {
    out(budgetStatus(repoRoot, policy, {}));
    return 0;
  }

  log("error", `unknown budget command: ${cmd}`);
  out({ ok: false, error: `unknown command: ${cmd}`, usage: "budget <record|check|report> [--tokens N] [--usd X] [--run ID] [--need-tokens N]" });
  return 2;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
