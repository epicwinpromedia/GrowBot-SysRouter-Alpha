// apply.mjs — the whole integration into the app page, as three one-line insertions.
//   node sysrouter/integration/apply.mjs --check              do the anchors still match app/v3/next.html?
//   node sysrouter/integration/apply.mjs --out /tmp/next.html  write a PATCHED COPY (never touches app/)
//   node sysrouter/integration/apply.mjs --diff               print the change as a unified diff
// app/ is Brit's read-only mirror (CONTRIBUTING.md), so nothing here edits it. This file is
// the exact, machine-checked description of the change for him to make at the source.
// Each hunk is anchored on a line of the snapshot and fenced /*SYSROUTER{*/ … /*}SYSROUTER*/
// the way the page fences its other flags, so it can be cut out again in one pass.

import { readFileSync, writeFileSync } from "node:fs";

export const HUNKS = [
  { name: "load", step: 1, before: false, anchor: '<script type="module" src="/forward-choice.mjs?v=1001"></script>',
    line: '<!--SYSROUTER{--><script type="module" src="/sysrouter/boot.js?v=1117"></script><!--}SYSROUTER-->   <!-- 1117: off unless ?sysrouter=1; every route starts in shadow (decides, logs, acts on nothing) -->' },
  { name: "hear", step: 1, before: true, anchor: '  if(!_bsnd&&typeof _imitationRequest==="function"&&_imitationRequest(t))return;',
    line: '/*SYSROUTER{*/  try{ if(!_bsnd&&typeof SysRouter!=="undefined"&&SysRouter) SysRouter.hear(t); }catch(_sr){}   /* 1117 SYSROUTER (shadow): the registered System One routes hear the same words, AFTER every local reader above has acted and BEFORE the queue, so they decide while a thought is in flight. Shadow rows only (logEv "sysroute"): nothing here can act, return, or change what reaches the turn. Guarded like its neighbours: this funnel is sliced on its own by several harnesses */\n/*}SYSROUTER*/' },
  { name: "replied", step: 1, before: true, anchor: '      var _mm=_live.scratch.mood||(_live.scratch.mood={v:0,e:0.4}), _tgt=EMO2MOOD[emotion];',
    line: '/*SYSROUTER{*/      try{ if(typeof SysRouter!=="undefined"&&SysRouter) SysRouter.replied(o); }catch(_sr){}   /* 1117 SYSROUTER (shadow): one "agree" row per route: did the reply\'s emotion match what the fast engine decided for the same words */\n/*}SYSROUTER*/' }
];

export function patch(text) {
  const lines = text.split("\n"), out = [], hit = {};
  for (const l of lines) {
    const h = HUNKS.find((x) => l.startsWith(x.anchor) && !hit[x.name]);
    if (h && h.before) out.push(h.line);
    out.push(l);
    if (h && !h.before) out.push(h.line);
    if (h) hit[h.name] = out.length;
  }
  const missing = HUNKS.filter((h) => !hit[h.name]).map((h) => h.name);
  return { text: out.join("\n"), missing, at: hit };
}

if (process.argv[1] && process.argv[1].endsWith("apply.mjs")) {
  const src = new URL("../../app/v3/next.html", import.meta.url), text = readFileSync(src, "utf8"), r = patch(text);
  if (r.missing.length) { console.log("FAIL anchors not found: " + r.missing.join(", ") + " (app/ moved: re-pin the anchors)"); process.exit(1); }
  const i = process.argv.indexOf("--out");
  if (i > 0) { writeFileSync(process.argv[i + 1], r.text); console.log("wrote patched copy to " + process.argv[i + 1]); }
  if (process.argv.includes("--diff")) for (const h of HUNKS) console.log("@@ " + h.name + " (" + (h.before ? "before" : "after") + " the line starting: " + h.anchor.slice(0, 70) + ")\n" + h.line.split("\n").map((l) => "+" + l).join("\n") + "\n");
  const added = r.text.split("\n").length - text.split("\n").length;
  console.log("anchors ok: " + HUNKS.map((h) => h.name).join(", ") + "  (+" + added + " lines, 0 lines changed, 0 removed)");
}
