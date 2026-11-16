# What we still need — and the order we get it in

Status as of 2026-11-16. Items move to the research files once done, with their evidence.

---

## A. Access and equipment (B to provide or confirm)

| # | Item | Why | Notes |
|---|---|---|---|
| A1 | **OpenRouter API key** | One key reaches Jev *and* Clef through `/api/v1/systemone` (`research/VENDORS.md` §4), and it's the same lane GrowBot already uses | Highest value. Goes in a local `.env`, never in chat or a commit |
| A2 | Cloudflare account + Workers AI API token | Clef direct (REST and Worker binding), and the in-Worker latency path that Brit's relay stack could use | Free tier: 10,000 neurons/day |
| A3 | TypeSafe direct key (optional) | Direct vs OpenRouter-routed Jev: latency, version pinning | The docs say self-serve sign-ups were paused at one point; check |
| A4 | Fast small LLM key(s): Groq and/or Cerebras | The arm Brit asked about by name | Pick after A-B5 research |
| A5 | Phone: model, OS version, browser | All end-to-end latency is measured on it | |
| A6 | **Do you have a GrowBot body built?** | Decides whether live tests include legs, or screen and sound only | Not required for most of the work |
| A7 | Laptop: OS, Node version, GPU (if any) | Benchmarks, a local proxy, possibly self-hosted Clef-flash | |

## B. Facts still to verify (we do these)

| # | Question | How |
|---|---|---|
| B1 | Does the local-server door (`pb_llm_url`) let us shadow-run System One on live traffic from your creature, and exactly what does it send? (seam S7) | Read growbot.dev/local-brain.html; run a local endpoint and log what arrives |
| B2 | growbot.dev public docs that aren't in the repo: `agent-docs.html`, `body-docs.html`, `local-brain.html` | Read and summarize into `research/` |
| B3 | OpenRouter `/api/v1/systemone`: prices, latency, version pinning, `is_byok` behavior | Live calls with A1 |
| B4 | TypeSafe confidence formulas and documented failure modes, from the docs page itself | Fetch and quote |
| B5 | Fast small generative models today: which, where, price, measured latency | Primary sources, then live calls |
| B6 | In-browser models for intent and sentiment (ONNX Runtime Web, transformers.js): size, load time, phone CPU cost, licences | Model cards, then on-phone measurement |
| B7 | Candidate datasets and their licences (command intents, out-of-scope traps, emotion labels) | Dataset cards; keep only licences compatible with publishing results |
| B8 | Unverified names: Kev-9B, Laya, Strands Decider 2B, Semlf, OpenAI Decisions | Primary sources or drop |
| B9 | Real STT latency and real brain latency on your phone, per lane | Our measurement harness (W1) |
| B10 | Dream input size in tokens | Instrument a dream with a local endpoint (B1) |
| B11 | Clef-flash context: 24,576 or 64K | Ask the API: send a long state and read usage |

## C. Workstreams (proposed order)

1. **W0 Facts** (this document set): code map, vendor facts, claims ledger, mission, requirements. *Done for v0.*
2. **W1 Measurement harness:** run the same input through every arm and record latency (network vs model), answers, probabilities, cost and errors. Node first, then on the phone.
3. **W2 Dataset:** public sources (B7), Brit's documented regex edge cases, a text-to-speech → Whisper round trip for real transcription errors, and our own labeled traps. Versioned, with tuning and held-out splits.
4. **W3 Baselines and arms:** Brit's readers copied unchanged from `next.html`, then each engine, then hybrids. Thresholds fitted on the tuning split only.
5. **W4 Specification:** router, provider, registration, secrets and threat model, written from W1–W3 evidence.
6. **W5 Reference implementation:** browser ES module, zero dependencies, flags and kill switch, the two first co-processors, shadow mode first.
7. **W6 Live shadow:** your creature on growbot.dev through seam S7. Real traffic, nothing acted on.
8. **W7 Presentation package:** results, spec, implementation, and an integration plan in small steps Brit controls.

## D. Decisions waiting on B

- **D1** Approve the repo layout (`sysrouter/` holds all our work; Brit's files stay untouched).
- **D2** Who holds the keys for live tests: your laptop `.env` only, or also a Cloudflare Worker we deploy under your account (needed if the phone calls System One directly).
- **D3** Benchmark tooling language: Node (matches the app and harness, zero-dependency culture) unless an arm needs Python (for example a self-hosted Clef-flash via SGLang). I recommend Node, with Python only where a vendor tool requires it.
