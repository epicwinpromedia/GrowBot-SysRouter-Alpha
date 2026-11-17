// t.mjs — the whole test "framework": check(), a seeded random, and a summary line.
// Tests are plain Node scripts that print PASS or FAIL and set the exit code, the way
// policy/forward/test_forward.mjs does. No dependencies.

let pass = 0, fail = 0;
export function check(name, ok, detail) {
  if (ok) pass++; else { fail++; console.log("  FAIL " + name + (detail !== undefined ? "  -> " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : "")); }
  return !!ok;
}
export function throws(name, fn, match) {
  try { fn(); } catch (e) { return check(name, !match || match.test(String(e.message)), e.message); }
  return check(name, false, "did not throw");
}
export function done(label) {
  console.log(label + ": " + pass + " checks passed, " + fail + " failed");
  console.log(fail ? "FAIL" : "PASS");
  process.exit(fail ? 1 : 0);
}
export function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
