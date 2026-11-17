// serve.mjs — a static file server for the demo page and the in-browser benchmark.
//   node sysrouter/tools/serve.mjs [port]         then open http://localhost:8765/sysrouter/demo/
// Serves the repository root read-only, so the demo can read app/v3/next.html the way the
// tests do. /ml/* is served from sysrouter/models/cache/ (the ONNX runtime and the embedding
// model, fetched by tools/get-models.mjs), matching the paths the app itself uses.
// Zero dependencies. Local use only: it binds to 127.0.0.1.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

const ROOT = resolve(new URL("../..", import.meta.url).pathname), CACHE = resolve(ROOT, "sysrouter/models/cache");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".jsonl": "text/plain", ".wasm": "application/wasm", ".onnx": "application/octet-stream", ".txt": "text/plain", ".md": "text/plain; charset=utf-8", ".svg": "image/svg+xml" };

export function serve(port) {
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const file = p.startsWith("/ml/") ? resolve(CACHE, (p.includes("ort") ? "ort/" : "") + p.slice(4)) : resolve(ROOT, "." + p);
      if (!(file.startsWith(ROOT + sep)) || p.includes("/.") ) { res.writeHead(403).end("no"); return; }   // nothing outside the repo, no dotfiles (.env, .git)
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" }).end(body);
    } catch (e) { res.writeHead(404).end("not found"); }
  });
  return new Promise((ok) => server.listen(port || 0, "127.0.0.1", () => ok(server)));
}

if (process.argv[1] && process.argv[1].endsWith("serve.mjs")) { const s = await serve(+process.argv[2] || 8765); console.log("http://localhost:" + s.address().port + "/sysrouter/demo/"); }
