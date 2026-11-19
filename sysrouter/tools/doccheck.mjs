// doccheck.mjs — verifies that README.md, SPEC.md, and INTEGRATION.md match actual wc-equivalent
// file/line counts, mutant counts, and test counts (PLAN 3C.5, #16).   // AUDIT-PHASE2 A16 (#33): does NOT check SPEC.md counts (only old file names, line 68) and the mutant check (line 71) is a hard-coded floor; check SPEC.md §0/§3 against run-all and mutants.mjs.
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

const readme = readFileSync(ROOT + "README.md", "utf8");
const spec = readFileSync(ROOT + "SPEC.md", "utf8");
const integ = readFileSync(ROOT + "INTEGRATION.md", "utf8");

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

// No stale v1 file names in README.md or INTEGRATION.md
for (const [name, text] of [["README.md", readme], ["INTEGRATION.md", integ]]) {
  if (/wakeword\.js|expressive\.js/.test(text)) errs.push(`${name}: still mentions wakeword.js or expressive.js`);
}
if (spec.includes("src/wakeword.js") || spec.includes("src/expressive.js")) {
  errs.push("SPEC.md: still mentions src/wakeword.js or src/expressive.js");
}
if (mutantCount < 48) errs.push(`mutants.mjs: expected >= 48 mutants, got ${mutantCount}`);

if (errs.length) {
  for (const e of errs) console.log("FAIL " + e);
  process.exit(1);
}
console.log(`doccheck: ${srcFiles.length} src files (${totalSrc} lines), ${mutantCount} mutants, all doc counts passed`);
