# Claims Ledger — earlier documents checked against reality

The earlier documents were idea-gathering material. They are kept out of this repo. This ledger records what each one claimed that would bear weight in a design, and what we found. Every number in them is treated as a placeholder.

**Documents:**
- **H:** "Definitive Architectural and Operational Handbook for GrowBot"
- **P:** the Jev2GBot proposal
- **C:** "System One Decision Models: Jev, Clef and alternatives" (research file)
- **G1:** "Gemini Initial Development Suggestion"
- **G2:** "GrowBot Router Design Thesis"

**Status:**
- **TRUE:** verified
- **FALSE:** contradicted by code or a primary source
- **OPEN:** not yet checked
- **DROP:** no longer applies to this design

## Hardware, firmware, control

| # | Claim | In | Status | Evidence |
|---|---|---|---|---|
| 1 | Feetech SCS0009 serial bus servos, 1 Mbps half-duplex UART | H, G2 | FALSE | `BOM.md`: MG90S PWM servos; `firmware/PicoRobotics.py` uses PWM |
| 2 | PPO policy → 1000 Hz PD controller on the Pico | H, P, G2 | FALSE | `policy/README.md`: the policy runs on the phone at ~30 Hz; `firmware/act_engine.py`: 50 Hz keyframe glide |
| 3 | Byte-packed "Open Body Protocol", `protocol/conformance_test.py` | H | FALSE | JSON over wss through the relay (`app/relay-transport.js`); only `ports/automower/conformance.html` exists |
| 4 | Firmware enforces torque cutoff, encoder floor, 500 ms watchdog | G2 | FALSE | No such code in `firmware/`. Safety is in the app (band clamp, stop paths, `agent-gateway.js`). The relay has no auth (`PORTING.md`) |
| 5 | NeoPixel / LED ring for emotion | G2, B's brief | FALSE for stock body | `BOM.md` lists no LEDs. Expressive surfaces: screen, speaker, legs |
| 6 | Bipedal ~$30 body, phone as brain | H | TRUE | `README.md`, `BOM.md` |
| 7 | Porting to a lawnmower exists | H | TRUE | `ports/automower/` |

## Software architecture

| # | Claim | In | Status | Evidence |
|---|---|---|---|---|
| 8 | The agent harness is Python with `audio.py`, `protocol_sender`, `semantic_router.py` | P, G1, G2 | FALSE | `agent-harness/reference-loop.mjs` is zero-dependency Node with no speech-to-text. The live brain is browser JS (`app/v3/next.html`) |
| 9 | The model generates and runs Python scripts ("dynamic Python script generation") | H, G2 | FALSE | The reply is validated JSON fields and verbs (`prompts.js:231`) |
| 10 | Every input goes to the VLM; no fast path exists | P, G2 | FALSE | Local readers act before the brain (`sendTxtFrom`, `next.html:12010`); local sensor reflex table (`11590`) |
| 11 | Stop takes ~3,000 ms today | P | FALSE as stated | Stop words are matched locally once the transcript arrives; the floor is STT latency (Brit: p50 1.3–1.9 s, 0827). To measure end-to-end |
| 12 | Soul file grows as raw appended JSON logs needing map-reduce | H, P | FALSE as stated | Soul has bounded regions with caps (`soulRoll`, rules cap 24) and a dream with verbatim-evidence rules (`prompts.js:49–74`). Dream input size: OPEN |
| 13 | Cognitive loop at 0.25–1.0 Hz | H | FALSE | One 2 s cadence; idle thoughts ≥ 11 s apart; event thoughts on input (`CODEMAP.md` §4) |
| 14 | Brain latency 1–4 s per thought | H, P | OPEN | Brit (Discord): "1.5 second responses for simple thoughts" after a provider change; image turns +3.4 s (code comment 0710). To measure |

## Jev, Clef and the decision-model field

| # | Claim | In | Status | Evidence |
|---|---|---|---|---|
| 15 | `langchain_typesafe.JevClient().evaluate(state, primitive)` | P | FALSE | `VENDORS.md` §2 |
| 16 | Jev is built on ModernBERT | H, P | OPEN, likely unsupported | TypeSafe publishes no architecture (C says so too) |
| 17 | Jev latency "firmly below 500 ms regardless of criteria size" | P | OPEN | TypeSafe publishes no latency; Cloudflare measured Jev at 524 ms median in its runs |
| 18 | Jev price $0.042/M input, output free | C | TRUE | `VENDORS.md` §2 |
| 19 | Clef 27B / flash 9B / omni 30B-MoE, Apache-2.0, Jev-compatible body | C | TRUE | `VENDORS.md` §3 |
| 20 | Clef-flash $0.038/M after a cut | C | TRUE (current price) | pricing page |
| 21 | Clef-flash context 24,576 | C | CONFLICT | model page 24,576 vs changelog "64K" |
| 22 | Clef silently truncates long state | C | TRUE | model page |
| 23 | Jev and Clef available on OpenRouter | Discord (Raph2K) | TRUE | `/api/v1/systemone` on OpenRouter (`VENDORS.md` §4) |
| 24 | Kev-9B, Laya, Strands, Semlf, gpt-6-luna | C, G2 | OPEN | `VENDORS.md` §6 |
| 25 | "Never hallucinates" / deterministic | marketing | FALSE as stated | Output is forced into the schema; correctness is not guaranteed (ZenMux; TypeSafe documents failure modes) |
| 26 | Thresholds don't transfer between models | C | OPEN (plausible) | Our benchmark will measure it directly |

## Design suggestions (G1, G2) — keep or drop

| # | Suggestion | Decision | Why |
|---|---|---|---|
| 27 | Provider drivers behind one interface; regex as a provider | KEEP | Fits G1 and Brit's readers |
| 28 | Per-model calibration profiles outside router logic | KEEP | Thresholds are per model and per version |
| 29 | Capability manifest per provider | KEEP | Clef truncates; Jev fails fast; question limits differ |
| 30 | `shadow_only` execution mode | KEEP | Same as the codebase's log-only-first convention |
| 31 | Two-gate trigger: "is this a command" yes/no + raw top probability | KEEP, to benchmark | Directly addresses forced-choice false positives |
| 32 | Reserved core safety namespace | KEEP | G4 |
| 33 | Tier 0 as a naive phrase lookup (Aho-Corasick of wake phrases) | DROP | Would regress Brit's clause-aware reader; Tier 0 *is* his reader |
| 34 | Jev-Guard on generated code | DROP | Nothing generated runs as code; clamps are code |
| 35 | Box for "look at the red cup" | OPEN, low priority | Possible later; the app already tracks faces on-device |
| 36 | Acceptance gates (+35% recall, FPR ≤ 2%, ECE ≤ 0.08, ≥ 60% fewer brain calls) | DROP as numbers | Invented; gates are set after baselines are measured |
| 37 | `run_ensemble(mode="first_confident")` | FIX | The sample returns the first response to arrive without checking confidence |
| 38 | YAML config, Python decorators, `asyncio` | DROP | Wrong runtime; the app is browser JS |
| 39 | Week-based timeline | DROP | Not how this effort is planned |
