// doccheck.mjs — verifies that README.md, SPEC.md, INTEGRATION.md, and RESULTS.md match actual
// wc-equivalent file/line counts, suite counts, mutant counts, and measured results/ figures (PLAN 3C.5, #16, #33, #34).
//   node sysrouter/tools/doccheck.mjs

import { readFileSync, readdirSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const linesOf = (rel) => {
  const s = readFileSync(ROOT + rel, "utf8");
  return (s.match(/\n/g) || []).length;
};

const srcFiles = readdirSync(ROOT + "src").filter((f) => f.endsWith(".js")).sort();
const srcLines = Object.fromEntries(srcFiles.map((f) => [f, linesOf("src/" + f)]));
const totalSrc = Object.values(srcLines).reduce((a, b) => a + b, 0);

const testFiles = readdirSync(ROOT + "test").filter((f) => f.endsWith(".mjs")).sort();
const testLines = Object.fromEntries(testFiles.map((f) => [f, linesOf("test/" + f)]));

const mutantsSrc = readFileSync(ROOT + "test/mutants.mjs", "utf8");
const mutantCount = (mutantsSrc.match(/^\s*\["/gm) || []).length;

const runAllSrc = readFileSync(ROOT + "test/run-all.mjs", "utf8");
const suiteCount = (runAllSrc.match(/^\s*\["/gm) || []).length;

const browserJson = JSON.parse(readFileSync(ROOT + "results/browser.json", "utf8"));
const gatesJson = JSON.parse(readFileSync(ROOT + "models/gates.json", "utf8"));

const countSplit = (rel, split) => readFileSync(ROOT + rel, "utf8").trim().split("\n").filter((l) => JSON.parse(l).split === split).length;
const wakeHeld = countSplit("data/v1/wake.jsonl", "held");
const expressHeld = countSplit("data/v1/express.jsonl", "held");

const readme = readFileSync(ROOT + "README.md", "utf8");
const spec = readFileSync(ROOT + "SPEC.md", "utf8");
const integ = readFileSync(ROOT + "INTEGRATION.md", "utf8");
const results = readFileSync(ROOT + "RESULTS.md", "utf8");

const errs = [];
const expectMatch = (docName, text, re, checkFn, label) => {
  const m = text.match(re);
  if (!m || !checkFn(m)) errs.push(`${docName}: ${label} (got ${m ? m.slice(1).join(", ") : "no match"})`);
};

// README.md checks
expectMatch("README.md", readme, /(\d+) browser ES modules, zero dependencies, (\d+) lines/,
  (m) => +m[1] === srcFiles.length && +m[2] === totalSrc,
  `expected ${srcFiles.length} modules, ${totalSrc} lines`);
expectMatch("README.md", readme, /sysrouter\.js\s+the router \((\d+) lines\)/,
  (m) => +m[1] === srcLines["sysrouter.js"],
  `expected sysrouter.js (${srcLines["sysrouter.js"]} lines)`);

// SPEC.md checks (#33)
expectMatch("SPEC.md", spec, /run-all\.mjs`: (\d+) suites/,
  (m) => +m[1] === suiteCount,
  `expected ${suiteCount} suites from test/run-all.mjs`);
expectMatch("SPEC.md", spec, /(\d+) browser ES modules with no dependencies \(`src\/`, (\d+) lines\); the router itself is `src\/sysrouter\.js` \((\d+) lines\) and `src\/registry\.js` \((\d+) lines\)/,
  (m) => +m[1] === srcFiles.length && +m[2] === totalSrc && +m[3] === srcLines["sysrouter.js"] && +m[4] === srcLines["registry.js"],
  `expected ${srcFiles.length} modules, ${totalSrc} lines, sysrouter.js=${srcLines["sysrouter.js"]}, registry.js=${srcLines["registry.js"]}`);
expectMatch("SPEC.md", spec, /`test\/mutants\.mjs`, (\d+) mutants, all caught/,
  (m) => +m[1] === mutantCount,
  `expected ${mutantCount} mutants in SPEC.md §3`);
expectMatch("SPEC.md", spec, /at full speed: p50 ([0-9.]+) ms, p95 ([0-9.]+) ms, p99 ([0-9.]+) ms/,
  (m) => +m[1] === browserJson.runs.cpu_1x.worker_round_trip_ms.p50 && +m[2] === browserJson.runs.cpu_1x.worker_round_trip_ms.p95 && +m[3] === browserJson.runs.cpu_1x.worker_round_trip_ms.p99,
  `expected browser.json cpu_1x worker_round_trip_ms`);
expectMatch("SPEC.md", spec, /CPU slowed 6×: p50 ([0-9.]+) ms, p95 ([0-9.]+) ms, p99 ([0-9.]+) ms/,
  (m) => +m[1] === browserJson.runs.cpu_6x.worker_round_trip_ms.p50 && +m[2] === browserJson.runs.cpu_6x.worker_round_trip_ms.p95 && +m[3] === browserJson.runs.cpu_6x.worker_round_trip_ms.p99,
  `expected browser.json cpu_6x worker_round_trip_ms`);
expectMatch("SPEC.md", spec, /desktop Chromium ([0-9.]+) with CPU throttling/,
  (m) => m[1] === browserJson.chromium,
  `expected Chromium ${browserJson.chromium}`);
expectMatch("SPEC.md", spec, /`clef` ([0-9.]+) against `clef@primeintellect` ([0-9.]+); `clef-flash` ([0-9.]+) against `clef-flash@primeintellect` ([0-9.]+)/,
  (m) => +m[1] === gatesJson.fuzzy["hosted@cloudflare/clef"].p && +m[2] === gatesJson.fuzzy["hosted@cloudflare/clef@primeintellect"].p && +m[3] === gatesJson.fuzzy["hosted@cloudflare/clef-flash"].p && +m[4] === gatesJson.fuzzy["hosted@cloudflare/clef-flash@primeintellect"].p,
  `expected §14.3 gates to match models/gates.json`);

// RESULTS.md split checks (#34)
expectMatch("RESULTS.md", results, /`wake`: \*\*([0-9,]+)\*\* held-out rows.*`express`: \*\*([0-9,]+)\*\* held-out rows/,
  (m) => +m[1].replace(/,/g, "") === wakeHeld && +m[2].replace(/,/g, "") === expressHeld,
  `expected held-out counts wake=${wakeHeld}, express=${expressHeld}`);

// INTEGRATION.md checks
expectMatch("INTEGRATION.md", integ, /`sysrouter\.js`, `registry\.js` \| (\d+) \+ (\d+)/,
  (m) => +m[1] === srcLines["sysrouter.js"] && +m[2] === srcLines["registry.js"],
  `expected sysrouter.js + registry.js = ${srcLines["sysrouter.js"]} + ${srcLines["registry.js"]}`);
expectMatch("INTEGRATION.md", integ, /`test_router\.mjs` (\d+), `mutants\.mjs` (\d+), `fuzz_router\.mjs` (\d+)/,
  (m) => +m[1] === testLines["test_router.mjs"] && +m[2] === testLines["mutants.mjs"] && +m[3] === testLines["fuzz_router.mjs"],
  `expected test_router=${testLines["test_router.mjs"]}, mutants=${testLines["mutants.mjs"]}, fuzz_router=${testLines["fuzz_router.mjs"]}`);
expectMatch("INTEGRATION.md", integ, /`s1-readers\.js` \| (\d+) \| `test_readers_regression\.mjs` (\d+)/,
  (m) => +m[1] === srcLines["s1-readers.js"] && +m[2] === testLines["test_readers_regression.mjs"],
  `expected s1-readers=${srcLines["s1-readers.js"]}, test_readers_regression=${testLines["test_readers_regression.mjs"]}`);
expectMatch("INTEGRATION.md", integ, /`s1-ngram\.js`, `fuzzy\.js`, `models\/wake\.ngram\.json` \| (\d+)/,
  (m) => +m[1] === srcLines["s1-ngram.js"] + srcLines["fuzzy.js"],
  `expected s1-ngram + fuzzy = ${srcLines["s1-ngram.js"] + srcLines["fuzzy.js"]}`);
expectMatch("INTEGRATION.md", integ, /`boot\.js` \+ your three insertions \| (\d+) \+ 5 \| `test_funnel\.mjs` (\d+)/,
  (m) => +m[1] === srcLines["boot.js"] && +m[2] === testLines["test_funnel.mjs"],
  `expected boot=${srcLines["boot.js"]}, test_funnel=${testLines["test_funnel.mjs"]}`);
expectMatch("INTEGRATION.md", integ, /`emote\.js`, `models\/express\.ngram\.json` \| (\d+)/,
  (m) => +m[1] === srcLines["emote.js"],
  `expected emote=${srcLines["emote.js"]}`);
expectMatch("INTEGRATION.md", integ, /`s1-embed\.js` \([^)]*?(\d+) lines\) and `s1-chat\.js` \([^)]*?(\d+) lines\)/,
  (m) => +m[1] === srcLines["s1-embed.js"] && +m[2] === srcLines["s1-chat.js"],
  `expected s1-embed=${srcLines["s1-embed.js"]}, s1-chat=${srcLines["s1-chat.js"]}`);

// No stale v1 file names in README.md, INTEGRATION.md, or SPEC.md
for (const [name, text] of [["README.md", readme], ["INTEGRATION.md", integ]]) {
  if (/wakeword\.js|expressive\.js/.test(text)) errs.push(`${name}: still mentions wakeword.js or expressive.js`);
}
if (spec.includes("src/wakeword.js") || spec.includes("src/expressive.js")) {
  errs.push("SPEC.md: still mentions src/wakeword.js or src/expressive.js");
}

if (errs.length) {
  for (const e of errs) console.log("FAIL " + e);
  process.exit(1);
}
console.log(`doccheck: ${srcFiles.length} src files (${totalSrc} lines), ${suiteCount} suites, ${mutantCount} mutants, all doc counts passed`);
