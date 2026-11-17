// slice.mjs — lifts Brit's own readers out of app/v3/next.html, unchanged, so the benchmark
// and the regression tests run the SAME code the live funnel runs (R-EVAL-4, GATHER W3).
//   node sysrouter/bench/slice.mjs            prints what was sliced and the snapshot hash
// Nothing is copied into this folder: the readers are read from app/ at run time, so a new
// snapshot of app/ is picked up without editing anything here. This is the same idea as the
// slicing harnesses the funnel's own comments describe ("this funnel is sliced on its own by
// several harnesses", next.html sendTxtFrom).

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";

const NEXT = new URL("../../app/v3/next.html", import.meta.url);

// A declaration starts at column 0 with `function name(` or `var name=`. It ends at the first
// line where the text so far parses as a complete script. No brace counting: the regex
// literals in _ftWords would defeat a counter, the parser cannot be fooled.
function cut(lines, start) {
  let src = "";
  for (let i = start; i < Math.min(lines.length, start + 400); i++) {
    src += lines[i] + "\n";
    try { new vm.Script(src); return { src, from: start + 1, to: i + 1 }; } catch (e) {}
  }
  throw new Error("could not slice from line " + (start + 1));
}

export function sliceReaders(names) {
  const text = readFileSync(NEXT, "utf8"), lines = text.split("\n"), parts = [], map = {};
  for (const name of names) {
    const at = lines.findIndex((l) => l.startsWith("function " + name + "(") || l.startsWith("var " + name + "="));
    if (at < 0) throw new Error("not found in next.html: " + name);
    const c = cut(lines, at); parts.push(c.src); map[name] = c.from + "-" + c.to;
  }
  return { src: parts.join("\n"), lines: map, sha256: createHash("sha256").update(text).digest("hex") };
}

// The readers Brit's funnel consults before the brain (CODEMAP §3), plus what they lean on.
export const READER_NAMES = ["_ftWords", "_seekWords", "_languageCommand", "languageCode", "LANGUAGE_NAMES", "NAMED_HALT_RE", "NAMED_SOFT_RE"];

export function loadReaders() {
  const names = READER_NAMES.slice();
  let s;
  for (;;) {                                  // drop a helper name the snapshot does not have, keep the rest
    try { s = sliceReaders(names); break; }
    catch (e) { const m = /not found in next.html: (\w+)/.exec(e.message); if (!m || ["_ftWords", "_seekWords"].includes(m[1])) throw e; names.splice(names.indexOf(m[1]), 1); }
  }
  const box = vm.createContext({});
  vm.runInContext(s.src, box);
  const out = { lines: s.lines, sha256: s.sha256 };
  for (const n of names) out[n] = vm.runInContext(n, box);
  return out;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const r = loadReaders();
  console.log("next.html sha256 " + r.sha256);
  for (const k in r.lines) console.log(k.padEnd(18) + " lines " + r.lines[k]);
  console.log(JSON.stringify(r._ftWords("stop, look at me")), JSON.stringify(r._seekWords("find my keys")));
}
