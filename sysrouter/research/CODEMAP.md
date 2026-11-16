# Code Map — how GrowBot works today, where SysRouter touches it

**Pinned to:** this repo at `f1dd1b2`. `app/` is Brit's snapshot of growbot.dev from private commit `39eb8143`, build `6eayvkvufuuy`, 2026-11-12 (`app/README.md`). Upstream will move; line numbers below are for this snapshot.

**Labels:** **V** = verified by reading the code at the cited line. **B** = Brit's own field measurement, quoted from a code comment (date in the comment). **I** = our inference, still to be confirmed.

---

## 1. Topology

```
 phone browser (growbot.dev/v3/next.html, ~15.9k lines, one page)                 Brit's server (NOT in repo)
 ┌───────────────────────────────────────────────────────────────────┐            ┌──────────────────────────┐
 │ mic → VAD (Silero, ONNX Runtime Web, on device) → clip            │──audio────▶│ /api/llm?target=groq-audio│→ Whisper large-v3-turbo
 │ heardText (junk/echo guards) → sendTxtFrom (THE input funnel)     │◀─text──────│ /api/llm?target=deepinfra-audio
 │   ├─ local readers act at once (stop/halt, face, get-up, hunt…)   │            │                          │
 │   └─ _humanAsk → think()  (ONE thought in flight)                 │──prompt───▶│ /api/llm?target=openrouter│→ OpenRouter model
 │ reply JSON → dispatchers (say, emotion, sound, body, walk, …)     │◀─JSON──────│ /api/llm-stream           │
 │ sensors 20 Hz → reflex table (11 sensor triggers) → local acts    │            │ /api/config /api/journal …│
 │ walk policy ~30 Hz on phone IMU → pose stream                     │            └──────────────────────────┘
 └──────────────┬────────────────────────────────────────────────────┘
                │ wss JSON (pose / act / routine / stop)
         Cloudflare relay worker (growbot-relay.growbot.workers.dev, no auth yet)
                │
         Pico 2 W / ESP32 → 2× MG90S PWM servos (50 Hz keyframe glide, act_engine.py)
```
Sources (V): `README.md`, `PORTING.md`, `app/relay-transport.js:1–22`, `firmware/act_engine.py:5`, `firmware/PicoRobotics.py`, `BOM.md`, `policy/README.md`, `next.html:2632–2740`, `6397`, `6989–6998`.

## 2. Speech in

| Step | Where | Notes |
|---|---|---|
| Voice activity detection | `next.html:7812 vadTick`, Silero model loaded at `6989–6998` | V. On-device ONNX Runtime Web (`/ml/ort.min.js`, `/ml/silero_vad.onnx`). Proof that in-browser model inference already runs in production. |
| Transcription | `next.html:2632 transcribe` | V. Whisper `whisper-large-v3-turbo`, `verbose_json`, temperature 0. Groq is primary (`STT_GROQ`), DeepInfra the backstop, through Brit's `/api/llm`. 8 s lease on the primary, 12 s on the backstop. |
| STT latency | comments at `next.html:2645–2675` | **B (0827):** a direct DeepInfra turn was p50 **1891 ms**; on clips DeepInfra could not finish in 8 s, Groq finished the same audio in a median of **1302 ms**; a fallback turn cost p50 **9302 ms**. These are Brit's numbers, not ours. Our benchmark must measure STT itself. |
| Junk filtering | `next.html:2787 heardText` | V. Structural guards: Whisper hallucination phrases, loops, end-cards, brackets, "as an AI" meta, empty, anti-echo of its own voice. Law noted in comments: never ban a word, only shapes. |
| Body sounds | `next.html:2832 _bodyVet`, `_sttSoft` | V. Faint 1–2-word clips become "a short faint sound". Command words veto this (`_localCmd`, `11999`), so a quiet "Stop." is still treated as words. |

## 3. The input funnel — `sendTxtFrom` (`next.html:12010`)

Every utterance, typed or heard, passes through here. In order (V):

1. Expression/imitation cancel on new input (`_expressionIncoming`, `1307`).
2. `_namedHalt(t)` (`4529`), `_gsHear`, `_recHalt`: stop words halt get-up motions now.
3. `_ftWords(t)` (`11885`): Brit's clause-aware reader of follow/stop/halt/still words, one clause at a time, later clause wins, negation-aware ("stop, look at me" follows; "look at me. no, stop" stops; "never, ever stop following me" is one negation). Built over several review rounds (ASTRA rounds 3–7).
4. Halt/still → `_bodyHalt()` (`3899`), `_partsHalt`, face tracker latch.
5. `_imitationRequest`, then `_seekWords` (`11995`) set or clear a hunt goal.
6. If the brain is busy, paused or cooling down → **queue** (`_queueUser`, `11745`; `12059`). Otherwise → `_humanAsk` (`11762`) → `think(…,"event")`.

**What this means for SysRouter (I):** the funnel is already an informal router: deterministic readers first, the brain last. It is the natural place for the router's input hook. Brit's readers become the first System One provider ("regex engine"), unchanged.

## 4. The brain — `think()` (`next.html:10750`)

- **Single flight (V):** returns at once if `inFlight`, no config, paused, cooling down or hidden (`10754`).
- **Cadence (V):** one 2 s interval drives every autonomous beat (`13378–13443`). Floors: idle musing ≥ 11 s apart (`10758`); activity beats ≥ 6 s after the last call and ≥ 4 s after the last reply; a quiet "watch" every 90 s when rules exist; an ambient beat at most every 240 s; an expression beat ≥ 30 s after it last spoke (`REST_AFTER_MS`, `WATCH_GAP_MS`, `EXPR_GAP_MS` at `11358`).
- **Prompt (V/B):** `buildSystem` (prompts.js) + speech style + move guide + self-stats + visual memory; up to 4 recent traces; senses, sensor readout and the moment. **B (0918):** the prompt is about **13.2k tokens**. **B (FATLAB 0710):** any image adds about **3.4 s** (5.6 s vs 2.2 s text-only).
- **Model choice (V):** `slug = brainOverride(kind==="tick" ? orCfg.fast : orCfg.active)` (`10818`). `orCfg` comes from `/api/config` with fields `active`, `fast`, `dream`, `wall`, `fallback`, `retailDiv`. Reply budget `_decisionTokens` defaults to 512.
- **Three funding lanes (V):** `callModel` (`6397`):
  - **Local server:** `llmCfg()` (`5712`): `pb_llm_url` + `pb_llm_model` (+ optional `pb_llm_key`), any OpenAI-style `/chat/completions`. Takes the whole lane.
  - **The user's own OpenRouter key:** `byoKey()` (`5706`): `pb_byok`, only accepted if it starts `sk-or-`, sent as header `x-openrouter-key`.
  - **House credits:** otherwise, with device token `x-pb-device`.
  
  A free lane (`gb_brain="free"`) has its own rotation and a capped house "wall" model (`5809 brainOverride`).
- **Streaming (V):** on by default for every non-tick think (`_STREAM`, `1018`); ticks are buffered.
- **Mandatory-reasoning registry (V/B):** some models can't turn reasoning off. **B (0814):** on `google/gemini-3.7-flash` the lowest effort was ~0.9 s faster and had no empty replies.

## 5. Reply dispatch

The reply is one line of minified JSON (`prompts.js:231 buildOutputSchema`). Fields (V):
- **Words:** `say`
- **Expressive:** `emotion` (calm|curious|happy|alert|scared), `sound`, `burst`, `sky`, `sing`, `glow`, plus `expression` on the bench flag
- **Body:** `body.steps`, `walk`, `gesture`, `track`
- **Memory and rules:** `scratchpad` (state, mood, add/remove rules, `reflex`, gestures), `owner`, `name_proposal`, `log`, `ladder`, `identity_proposal`
- **Activity:** `goal`, `found`, `phase`, `why`, `wake`, `afterMs`

Parsing and rescue: `tryParse` (`6708`), `jparse` (`6698`), plus the `say_missing` rescue. Placeholder words like "OMIT" are dropped. A truncated `say` is cut to its last clean sentence. Emotion feeds mood through `EMO2MOOD` (`4987`).

**For SysRouter (I):** every expressive channel is a reply field, so the body can only emote after the full thought returns. An expressive co-processor would drive the same channels earlier, through the same executors, while the brain's later reply still wins.

## 6. Fast paths that already exist

| Path | Where | Trigger | Notes |
|---|---|---|---|
| Reflex table | `TRIGS`/`ACTS` `11590`; `reflexFromRule` `11591`; `applyScratchWrites` `11619`; `fireReflex` `8063` | 11 sensor events: tap, tap2 (`13357`), loud, wash (`6843–6846`), tone (`7446`), dark, bright, face (`7969–7973`), shake, upright, fall (`9691–9707`) | V. The creature writes its own reflexes through `scratchpad.reflex`. The table is whitelist-clamped and runs locally, "even while you sleep". Per-trigger debounce of 1.5 s (4 s for loud). **There are no semantic (text-meaning) triggers.** This is where Brit's "Simon says" idea (the creature writing its own soft reaction rules) connects. |
| Stop and command words | `_ftWords` `11885`, `_localCmd` `11999`, `_namedHalt` `4529`, halt-word tests at `4535`, `4645`, `4925` | Regex on the transcript | V. Acts before the queue, so it works while the brain is busy. |
| Expression stillness | `_expressionPerson` `3281` | Regex on stop/still/lie-down words | V. Bench flag only. |

## 7. Expression system

- `app/v3/expression.js` (V): six deterministic recipes (purr, breathe, sigh, perk, shiver, droop), each a pose contour plus a synthesized sound. The sound plan accepts model-authored contours, with ranges validated in code.
- In `next.html`, expressions are behind `?express=bench` (`_expressionBench`). Gating is in `_expressionWhyNot` (paused, asleep, legs offline, stance unknown). They play through `moveLegs` (`3606`), which does band clamp, slew floor, takeover and stop. `_expressionReply` is at `3321`.
- There are no LEDs on the stock body (BOM). The expressive surfaces are the screen (face, sky, bursts, glow), the speaker (sound, sing) and the legs.

## 8. Body and safety layers

- **Wire:** `app/relay-transport.js` (V). `pose` (latest wins, ~30 Hz), `act` keyframes, `routine`, `stop` (halt and go limp). Acks come back. The relay is unauthenticated: the pairing code works like a password (`PORTING.md`).
- **`app/agent-gateway.js`** (V): `SafeBody`, the layer between an external brain and the body. It speaks verbs (speak, forward, turn, stop, gesture), validates against body truth, clamps, enforces a duty budget and runs the walk policy in the browser. Its own header says it is **not a security boundary**: it protects against a buggy cooperative brain, not a hostile one. Used by `tester/custom.html`.
- **`app/v3/agent_kernel.js`** (V): small dependency-free verb parser and validator (speak, turn, forward…).
- **Band clamp:** `servos[0].band` from the body declaration (prompts.js `233`; `PORTING.md`).

## 9. Telemetry

- `logEv(e,d)` (`457`): journal rows with redaction of quoted text and names. Flushed every 8 s (`flushLog` `638`, interval at `657`) to `/api/journal`.
- `model_usage` row per model call (`_usageEnd` `5734`, V): route (local|byok|house), phase (think|dream), lane, model, providerUsd, prompt/completion/total tokens, reasoning tokens, cached tokens (`ct`), cache-write tokens (`cw`). Speech-to-text writes `stt` rows (latency, size, lane, confidence fields `lp`, `nsp`, `cr`).
- **For SysRouter (I):** routing decisions should be written as rows of the same kind, so Brit's existing journal readers see them without new tooling.

## 10. Keys and local storage today

| What | Where | Notes |
|---|---|---|
| User's OpenRouter key | `localStorage.pb_byok` | V. Only `sk-or-…` is accepted (`5706`). |
| Local server | `pb_llm_url`, `pb_llm_model`, `pb_llm_key`, `pb_llm_vision`, `pb_llm_json`, `pb_llm_nothink` | V (`5712`). An https page can only reach a LAN box through a tunnel. |
| Device token | `pb_device` → header `x-pb-device` | V. Per-device allowance and credits. |
| Brain choice | `gb_brain`, `gb_free_pick`, `gb_effort` | V. |
| Harness keys | environment variables `OPENROUTER_API_KEY`, `BASE_URL`, `MODEL` | V (`agent-harness/reference-loop.mjs:35–38`). |
| Firmware secrets | `firmware/secrets.example.py` → `secrets.py` (gitignored) | V. |
| Ignored by git | `.env`, `.env.*`, `*.key`, `*.pem`, `secrets/`, `secrets.py`, `config.js` | V (`.gitignore`). |

There is no shared secrets mechanism across components. Each component has its own convention. See `REQUIREMENTS.md` §R-SEC.

## 11. Codebase conventions SysRouter must follow (V)

- **Date-stamped decision comments** with the evidence that drove each change (e.g. `0827`, `1109`).
- **Feature flags** read from the URL and persisted to `localStorage`, with a kill switch (`?bodysnd=0`, `?stt=di`, `?stream=0`, `?express=bench`), and flag-fenced blocks `/*NAME{*/ … /*}NAME*/`.
- **`typeof`-guarded calls** ("this funnel is sliced on its own by several harnesses"). Brit's private test suite extracts functions and tests them standalone. Named tests appear in comments (`saymissingtest`, `reflextruthtest`, `costlogtest`, `cachesplittest`…). **The test suite isn't in this repo.**
- **Log-only first,** then a shadow arm, then a flip (e.g. the STT "slice, not a switch", the FLEX-TICKS tester arm).
- **Read-only `app/`.** It is replaced on each snapshot (`CONTRIBUTING.md`).

## 12. Candidate integration seams (I — to be designed and benchmarked)

| Seam | Where | What SysRouter would do |
|---|---|---|
| S1 Input hook | `sendTxtFrom` before the queue | Run registered System One routes on the transcript while the brain is busy or idle. Brit's readers stay first. |
| S2 Semantic reflex triggers | reflex table | Add meaning-based triggers next to the 11 sensor triggers. The creature writes its own soft rules. |
| S3 Pre-brain gate | `_humanAsk` / `think` | "Does this need a big model call?" (Brit's own question, Discord 2026-09-20). |
| S4 Expressive co-processor | before reply dispatch | Drive `emotion` / `burst` / `sky` / `sound` / `expression` from System One within the latency budget. The brain's reply still wins. |
| S5 Dream input | `dream()` (`next.html:11442`) | Pre-filter the evidence passed to the dream call. Measure the dream input size first. |
| S6 Third-party access | `agent-gateway.js` / registration API | Extensions register System One routes that can only target registered, clamped actions. |
| S7 Live shadow harness | the local-server door (`llmCfg`) | Point the live growbot.dev app at our own endpoint. It forwards to the real model and runs System One candidates on the same input in parallel. This gives real traffic from B's own creature with no change to Brit's server. **I: verify that the door accepts this and what it sends.** |

## 13. Not in this repo

Brit's server (`/api/*`), his test suite, `tester/llm.html`, third-party vendor files (`app/README.md`), and the newer walk policies (`policy/README.md`).
