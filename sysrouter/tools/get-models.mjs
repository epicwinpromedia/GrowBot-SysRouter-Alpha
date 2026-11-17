// get-models.mjs — fetches the on-device embedding model for the benchmark's embed arms.
//   node sysrouter/tools/get-models.mjs
// all-MiniLM-L6-v2 (sentence-transformers, Apache-2.0), the quantized ONNX export published
// as Xenova/all-MiniLM-L6-v2 on Hugging Face. 23 MB, so it is fetched, not committed; the
// sha256 below pins the exact bytes the published results were measured with.

import { createHash } from "node:crypto";
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";

const REV = "751bff37182d3f1213fa05d7196b954e230abad9";
const FILES = [
  ["all-MiniLM-L6-v2.q.onnx", "onnx/model_quantized.onnx", "afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1"],
  ["vocab.txt", "vocab.txt", "07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3"]
];
const dir = new URL("../models/cache/", import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
let ok = true;
for (const [name, path, want] of FILES) {
  let buf = existsSync(dir + name) ? readFileSync(dir + name) : null;
  if (!buf || createHash("sha256").update(buf).digest("hex") !== want) {
    const r = await fetch("https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/" + REV + "/" + path);
    if (!r.ok) { console.log("FAIL " + name + " http " + r.status); ok = false; continue; }
    buf = Buffer.from(await r.arrayBuffer()); writeFileSync(dir + name, buf);
  }
  const got = createHash("sha256").update(buf).digest("hex");
  console.log((got === want ? "ok   " : "FAIL ") + name + " " + buf.length + " bytes sha256 " + got.slice(0, 16));
  if (got !== want) ok = false;
}
process.exit(ok ? 0 : 1);
