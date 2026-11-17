// build.mjs — assembles the versioned benchmark dataset (R-EVAL-1).
//   node sysrouter/data/build.mjs
// Reads:  authored.mjs (written for this effort), sources/*.jsonl (public sets, sampled),
//         sources/stt_roundtrip.jsonl (real Whisper transcriptions of the authored lines).
// Writes: v1/wake.jsonl, v1/express.jsonl, v1/MANIFEST.json
// Deterministic: same inputs, same bytes. The split is a hash of the ORIGINAL text, so a
// line and its transcribed variants always land on the same side (no leak between splits).
//   tune = thresholds and on-device models are fitted here      held = every reported number

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { WAKE, WAKE_TRAPS, WAKE_CHAT, EXPRESS } from "./authored.mjs";

const here = new URL(".", import.meta.url).pathname;
const sha = (t) => createHash("sha1").update(t).digest("hex");
const id = (t) => sha(t).slice(0, 10);
const split = (t) => (parseInt(sha("split:" + t).slice(0, 8), 16) % 2 ? "held" : "tune");
const jsonl = (p) => existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const norm = (t) => t.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();

const wake = [], express = [], labelOf = {};
const push = (out, route, text, label, kind, extra) => { out.push(Object.assign({ id: id(route + ":" + kind + ":" + text), route, text, label, kind, split: split((extra && extra.of) || text) }, extra || {})); };

for (const label in WAKE) for (const t of WAKE[label]) { push(wake, "wake", t, label, "authored"); labelOf[id(t)] = ["wake", label, "authored"]; }
for (const t of WAKE_TRAPS) { push(wake, "wake", t, "none", "trap"); labelOf[id(t)] = ["wake", "none", "trap"]; }
for (const t of WAKE_CHAT) { push(wake, "wake", t, "none", "chat"); labelOf[id(t)] = ["wake", "none", "chat"]; }
for (const label in EXPRESS) for (const t of EXPRESS[label]) { push(express, "express", t, label, "authored"); labelOf[id(t)] = ["express", label, "authored"]; }

// public sets. CLINC150 rows are assistant requests and out-of-scope questions: none of them
// is a command to a robot, so each is a "none" for wake. This is the false-trigger set.
for (const r of jsonl(here + "sources/clinc_oos.sample.jsonl")) push(wake, "wake", r.text, "none", r.clinc_intent === "oos" ? "clinc-oos" : "clinc-in");
// GoEmotions rows are Reddit comments, not speech to a creature: a transfer check, reported apart.
for (const r of jsonl(here + "sources/go_emotions.sample.jsonl")) push(express, "express", r.text, r.label, "goemotions");

// the speech round trip: the SAME line as Whisper heard it. Label and split follow the source line.
let stt = 0, changed = 0;
for (const r of jsonl(here + "sources/stt_roundtrip.jsonl")) {
  const src = labelOf[r.id]; if (!src || !r.stt) continue;
  const diff = norm(r.stt) !== norm(r.text); stt++; if (diff) changed++;
  push(src[0] === "wake" ? wake : express, src[0], r.stt, src[1], "stt-" + r.cond, { of: r.text, base: src[2], voice: r.voice, changed: diff ? 1 : 0 });
}

mkdirSync(here + "v1", { recursive: true });
const count = (rows) => { const c = {}; for (const r of rows) { const k = r.split + "/" + r.kind; c[k] = (c[k] || 0) + 1; } return Object.fromEntries(Object.entries(c).sort()); };
const out = (name, rows) => { const s = rows.map((r) => JSON.stringify(r)).join("\n") + "\n"; writeFileSync(here + "v1/" + name, s); return createHash("sha256").update(s).digest("hex"); };
const manifest = { version: "v1", built_from: "authored.mjs + sources/", stt_rows: stt, stt_changed_by_whisper: changed,
  wake: { rows: wake.length, sha256: out("wake.jsonl", wake), counts: count(wake) },
  express: { rows: express.length, sha256: out("express.jsonl", express), counts: count(express) } };
writeFileSync(here + "v1/MANIFEST.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest, null, 1));
