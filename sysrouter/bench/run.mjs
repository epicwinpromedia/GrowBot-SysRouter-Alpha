// run.mjs — the whole benchmark, one command (R-EVAL-5).
//   node sysrouter/bench/run.mjs              everything that can run here, then the report
//   node sysrouter/bench/run.mjs --local      on-device arms only (no key, no network after the model fetch)
// Order: fetch the embedding model, build the dataset, train the on-device arms on the tuning
// split, ask every arm, measure latency one call at a time, check option-order stability,
// write the report. Each step is resumable and skips what is already on disk; delete
// sysrouter/results/raw/ to start from nothing. Hosted arms need a key: copy env.example at
// the repo root to .env and fill in OPENROUTER_API_KEY.

import { spawnSync } from "node:child_process";
import { arms } from "./lib.mjs";

const here = new URL(".", import.meta.url).pathname, local = process.argv.includes("--local"), A = arms().arms;
const run = (file, ...args) => { console.log("\n> node " + file + " " + args.join(" ")); const r = spawnSync(process.execPath, [here + file, ...args], { stdio: "inherit" }); if (r.status !== 0 && !/collect|get-models/.test(file)) process.exit(r.status || 1); };
const names = Object.keys(A).filter((a) => !local || !["http", "chat"].includes(A[a].kind));

run("../tools/get-models.mjs");
run("../data/build.mjs");
for (const route of ["wake", "express"]) run("train.mjs", route);
for (const a of names) run("collect.mjs", "wake", a, "--latency");            // first, alone: nothing else is using the machine or the connection
for (const route of ["wake", "express"]) for (const a of names) run("collect.mjs", route, a);
for (const a of names.filter((a) => A[a].kind !== "readers" && A[a].kind !== "ngram" && !a.includes("@"))) run("collect.mjs", "wake", a, "--shuffle");
run("report.mjs");
