// keyscan.mjs — refuses a commit that contains something shaped like a key (R-SEC-6).
//   node sysrouter/tools/keyscan.mjs            scan every file git tracks or is about to add
//   node sysrouter/tools/keyscan.mjs --staged   only what is staged (for a pre-commit hook)
// As a pre-commit hook:   echo 'node sysrouter/tools/keyscan.mjs --staged' > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
// It looks for the shapes of real keys, and for the key files .gitignore already names.
// It prints the file and line, never the value. Zero dependencies.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const SHAPES = [
  ["OpenRouter key", /sk-or-v1-[0-9a-f]{32,}/],
  ["OpenAI-style key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/],
  ["Anthropic key", /\bsk-ant-[A-Za-z0-9_-]{24,}/],
  ["Groq key", /\bgsk_[A-Za-z0-9]{40,}/],
  ["Hugging Face token", /\bhf_[A-Za-z0-9]{30,}/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[baprs]-[0-9A-Za-z-]{20,}/],
  ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["bearer token in code", /authorization['"]?\s*[:=]\s*['"]Bearer\s+[A-Za-z0-9._-]{24,}['"]/i],
  ["key assigned in code", /\b[A-Z][A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD)\s*=\s*['"]?[A-Za-z0-9_\-]{24,}/]
];
const FILES = /(^|\/)(\.env(\.(?!example$)[^/]*)?|secrets\.py|config\.js|[^/]+\.(pem|key))$/;        // what .gitignore names; .env.example is allowed
const SKIP = /\.(png|jpe?g|gif|mp4|stl|uf2|pkl|onnx|wasm|ico|pdf|ipynb)$|(^|\/)(node_modules|\.git)\//;
const OK = /keyscan: ok/;                                                                              // a deliberate test value says so on its own line

const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean);
const staged = process.argv.includes("--staged");
const files = staged ? git(["diff", "--cached", "--name-only", "--diff-filter=ACM"]) : [...new Set(git(["ls-files"]).concat(git(["ls-files", "--others", "--exclude-standard"])))];
let found = 0;
for (const f of files) {
  if (FILES.test(f)) { console.log("KEY FILE   " + f + "   (this file should never be committed)"); found++; continue; }
  if (SKIP.test(f)) continue;
  let text; try { if (statSync(f).size > 3e6) continue; text = readFileSync(f, "utf8"); } catch (e) { continue; }
  text.split("\n").forEach((line, i) => { for (const [what, re] of SHAPES) if (re.test(line) && !OK.test(line)) { console.log("KEY SHAPE  " + f + ":" + (i + 1) + "   " + what); found++; } });
}
console.log(found ? "FAIL: " + found + " possible key(s). Remove them, or mark a deliberate test value with  // keyscan: ok" : "PASS: no keys in " + files.length + " files");
process.exit(found ? 1 : 0);
