#!/usr/bin/env node
// scripts/gaffer.mjs — thin dispatcher for the `gaffer` bin.
//   gaffer pipeline <...>   → scripts/pipeline.mjs
//   gaffer budget   <...>   → scripts/budget.mjs
// (Skills call `node scripts/pipeline.mjs ...` directly; this is for humans.)
import { main as pipelineMain } from "./pipeline.mjs";
import { main as budgetMain } from "./budget.mjs";

const [sub, ...rest] = process.argv.slice(2);
if (sub === "pipeline") process.exit(pipelineMain(rest));
else if (sub === "budget") process.exit(budgetMain(rest));
else {
  process.stderr.write("usage: gaffer <pipeline|budget> [...args]\n");
  process.exit(sub ? 2 : 0);
}
