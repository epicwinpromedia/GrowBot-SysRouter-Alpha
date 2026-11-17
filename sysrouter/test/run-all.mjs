// run-all.mjs — every test, one command, one verdict.
//   node sysrouter/test/run-all.mjs            the suite (about a minute)
//   node sysrouter/test/run-all.mjs --quick    without the mutation check
// No network, no keys, no dependencies: it runs on a fresh clone. (The embedding model is
// not needed by any test; the benchmark is what uses it.)

import { spawnSync } from "node:child_process";

const here = new URL(".", import.meta.url).pathname, quick = process.argv.includes("--quick");
const TESTS = [
  ["test_router.mjs", "the router's laws"],
  ["test_providers.mjs", "providers and registrations, against recorded live replies"],
  ["test_keys.mjs", "the key resolver"],
  ["test_readers_regression.mjs", "Brit's readers unchanged, alone and behind the router"],
  ["test_funnel.mjs", "the real input funnel with and without the integration"],
  ["fuzz_router.mjs", "20,000 random utterances through random routers"],
  ["fuzz_readers.mjs", "30,000 hostile strings through the readers"],
  ["../integration/apply.mjs", "the integration's anchors still match app/", ["--check"]],
  ["mutants.mjs", "every deliberately broken router must be caught", [], true]
];
let failed = 0;
for (const [file, what, args, slow] of TESTS) {
  if (slow && quick) continue;
  const t = Date.now(), r = spawnSync(process.execPath, [here + file, ...(args || [])], { encoding: "utf8" }), ok = r.status === 0;
  const last = r.stdout.trim().split("\n").filter((l) => /checks passed|anchors ok/.test(l)).pop() || "";
  console.log((ok ? "PASS " : "FAIL ") + what.padEnd(64) + ((Date.now() - t) / 1000).toFixed(1).padStart(6) + " s   " + last.replace(/^.*?: /, ""));
  if (!ok) { failed++; console.log(r.stdout.split("\n").filter((l) => l.includes("FAIL")).slice(0, 8).join("\n")); if (r.stderr) console.log(r.stderr.slice(0, 600)); }
}
console.log(failed ? "FAIL (" + failed + " suite(s))" : "PASS");
process.exit(failed ? 1 : 0);
