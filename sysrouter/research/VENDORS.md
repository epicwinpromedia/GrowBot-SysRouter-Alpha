# Vendor Facts — System One engines and routes to them

**Read on:** 2026-11-16, from primary sources (vendor docs, API schemas, model cards). Each fact cites its page.
**Rule:** vendor performance claims are listed as *vendor-reported*. Nothing here is a benchmark result of ours.

---

## 1. The shared contract

TypeSafe's API, Cloudflare's Clef and OpenRouter all take the same request body (V):

```json
{ "model": "<id>",
  "state": "<string | object | array>",
  "questions": {
    "<name>": { "type": "noul",   "instructions": "...", "criteria": {"true": "...", "false": "..."} },
    "<name>": { "type": "choice", "instructions": "...", "criteria": {"<option>": "<description>", "...": "..."} },
    "<name>": { "type": "score",  "instructions": "...", "criteria": ["lowest level", "...", "highest level"] } } }
```

Response (V): `{ model, answers: { <name>: {...} }, usage: { input_tokens, output_tokens } }`
- **noul:** `{type, noul: 0..1}`, the probability of yes
- **choice:** `{type, choice, probabilities, confidence}`
- **score:** `{type, score, confidence, legend, probabilities}`. `score` is the probability-weighted expected value and can fall between levels.

Sources: https://docs.typesafe.ai/api/system-one ; https://developers.cloudflare.com/workers-ai/models/clef/schema-input.json and `schema-output.json` ; https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request.md

**Confidence formulas** (from TypeSafe's docs, as summarized in B's research file; to re-verify against the docs page):
- Choice confidence depends only on the top probability and the option count. Gate on the raw top probability, not on `confidence`.
- Score confidence is a dispersion measure (mean absolute deviation around the mode). Check it before trusting `score`.

## 2. TypeSafe Jev (direct)

| Fact | Value | Source |
|---|---|---|
| Endpoint | `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <key>` | docs.typesafe.ai/api/system-one |
| Models | `jev-1.14.0` (current, from 2026-10-14), `jev-1.13.0`; aliases `jev-latest`, `jev-preview` (both → 1.14.0; "no preview build available right now") | docs.typesafe.ai/go/models.md |
| Question types | `noul`, `choice` (1–255 options), `score` (1–10 levels), `box` (1.14 only, needs header `TypeSafe-Danger-Zone-Images: true`) | OpenAPI on docs.typesafe.ai/api/system-one |
| Context | 64k tokens per request, 32k per question; 262k opt-in with header `TypeSafe-Danger-Zone-Long-Context: true`, documented as "slower and less accurate" | models page |
| Price | $0.042 per million input tokens; output free | models page |
| Inputs | text; PNG/JPEG images on 1.14 | models page |
| SDKs | JS `@typesafe-ai/sdk` (Node ≥ 22), `TypeSafeClient.systemOne({state, questions, model?, assets?})`. Python `typesafe-sdk`, `TypeSafeClient` / `AsyncTypeSafeClient`, `system_one(...)` | docs.typesafe.ai/sdk |
| Errors | 400 (`detail`), 422 (validation array), 429 with `retry-after`; SDKs retry by default | OpenAPI; models page |
| Browser use | **Not stated.** All examples keep the key server-side | docs.typesafe.ai/sdk |
| Latency | **Not published by TypeSafe** | — |

**Corrections to earlier documents:** `langchain_typesafe.JevClient().evaluate(state=, primitive=…)` does not exist in TypeSafe's docs. The request field is `questions`, not `primitive`.

## 3. Cloudflare Clef

| Fact | Value | Source |
|---|---|---|
| Models | `@cf/cloudflare/clef` (27B, from Qwen3.8-27B), `@cf/cloudflare/clef-flash` (9B, from Qwen3.5-9B), `@cf/cloudflare/clef-omni` (30B MoE, 3B active; images, audio, video) | Workers AI model pages; HF cards |
| `model` field | `"clef"` / `"clef-flash"` (schema pattern), `"clef-omni"` | schema-input.json |
| Endpoints | Worker binding `env.AI.run("@cf/cloudflare/clef", body)`; REST `POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/@cf/cloudflare/clef` with a Bearer token. **No hosted `/v1/systemone` path is documented**; the changelog says the body is Jev-compatible | changelog 2026-10-01; model pages |
| Questions | 1–64 per request. Choice: 2–255 options. Score: 2–10 levels. `instructions` is required (Cloudflare schema; the HF card says optional, so follow Cloudflare) | schema-input.json |
| Images | Up to 4; data URL or `{content_type, base64}`; png/jpeg/webp; 4 MiB and 16 MP each; 13 MiB per body; no remote URLs | schema-input.json |
| Context | clef 65,536; clef-omni 64,000; **clef-flash: 24,576 on the model page vs "64K" in the changelog (conflict, assume 24,576)** | model pages; changelog |
| Overflow | If media plus questions exceed the window, the request fails; otherwise **the text state is silently truncated** | model page |
| Price | clef $0.24/M input (21,818 neurons/M); clef-flash $0.038/M (3,455 neurons/M); clef-omni $0.150/M (13,636 neurons/M); no output charge. Free tier: 10,000 neurons per day; then $0.011 per 1,000 neurons | pricing page (updated 2026-11-12) |
| Latency (vendor-reported) | clef median 209.3 ms, p95 238.6 ms; clef-flash median 38.8 ms, p95 122.4 ms; Jev median 524.1 ms in the same runs. "Internal run of Decision Index 0.2.1", hardware and hosted/not unstated | changelog; HF cards |
| Weights | Apache-2.0, BF16 safetensors on Hugging Face; third-party quantizations exist (not Cloudflare's) | HF cards |
| Browser use | Not stated; REST examples use a server-side token | model pages |

**Independent latency (secondary source, from B's research file; to re-verify):** live sequential Workers AI calls measured medians of 191–205 ms (clef-flash) and 524–726 ms (clef), with spikes up to 3,000 ms (flaviocopes.com/clef).

## 4. OpenRouter (route to both, with one key)

| Fact | Value | Source |
|---|---|---|
| Endpoints | `POST https://openrouter.ai/api/v1/systemone` (TypeSafe-SDK compatible) and `POST https://openrouter.ai/api/alpha/decisions` ("Alpha: the shape may change") | openrouter.ai/docs/guides/community/jev.md |
| Not chat | Decision models are **not** served through `/api/v1/chat/completions` | same |
| Slugs | `typesafe/jev-1.14`, `typesafe/jev-1.13`, alias `~typesafe/jev-latest`; bare `jev-1.13` / `jev-latest` in SDK examples. Clef: `cloudflare/clef`, `cloudflare/clef-flash`, `cloudflare/clef-omni` (listed on the hub; model pages returned 404 to our fetcher) | jev.md; typesafe-sdk.md |
| Keys | "An OpenRouter API key authenticates both"; no separate TypeSafe account needed | jev.md |
| Usage block | Decisions API returns `provider` and `usage.cost`, `usage.is_byok` | decisions OpenAPI page |
| Price on OpenRouter | **Not retrieved** (model pages 404'd to our fetcher) | — |

**Why this matters for GrowBot (I):** GrowBot already funds model calls through OpenRouter in two lanes: the house lane and the user's own `sk-or-` key (`CODEMAP.md` §4). If Brit's `/api/llm` proxy forwards `/api/v1/systemone` the way it forwards chat, System One calls ride the funding, metering and key handling that already exist. This is the leading candidate route. It needs a live test with a real key, and a server-side change on Brit's side to adopt.

## 5. Vercel AI Gateway (Jev)

- Model `typesafe-ai/jev`; providers typesafe-ai and digitalocean; $0.042/M input; context 32,000 (Vercel figure). https://vercel.com/ai-gateway/models/jev
- AI SDK ≥ 7.0.105: `experimental_evaluate` (changelog page) vs `experimental_decide` (model page). **The two Vercel pages disagree on the function name.** Vercel's OpenAI-compatible endpoints do not support Jev evaluation. https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk

## 6. Named in B's research, **not yet verified**

Kev-9B, Laya (421M), Strands Decider 2B, Semlf ("formerly OpenJev"), OpenAI Decisions API / `gpt-6-luna`, the "Decision Index" community leaderboard. Each needs a primary source before it enters a benchmark plan.

## 7. Other engine families the benchmark needs (to research)

- **A fast small generative model** (Brit raised Groq and Cerebras with Llama at 0.3–0.4 s, Discord 2026-09-20). This is the arm Brit will ask about first.
- **On-device models** in the browser: ONNX Runtime Web (already shipped by GrowBot for Silero) or transformers.js, for intent and sentiment. No network, no key, no per-call cost.
- **Brit's regex readers,** unchanged, as the baseline System One provider.
