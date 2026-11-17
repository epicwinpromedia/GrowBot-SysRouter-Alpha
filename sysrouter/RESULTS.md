# SysRouter — Benchmark & Measurement Results

Every figure in this document is read from `results/TABLES.md`, `results/results.json`, `results/browser.json`, and `results/raw/`. Nothing is extrapolated or estimated.

---

## 1. What was measured and what it cannot show

- **Held-out splits only.** Every accuracy, recall, wrong-action, false-trigger, precision, and ECE figure comes from held-out lines that neither the on-device models nor the calibration gates saw during training or gate fitting (`wake`: 2,778 held-out rows; `express`: 1,103 held-out rows).
- **In-domain vs out-of-domain.** Gates are fitted on the tuning split so that bad acts (a false trigger on a non-target line or a wrong action on a target line) stay within the route target over all tuning lines (`0.5%` for `wake`/`fuzzy`, `2.0%` for `express`/`emote`).
- **What it cannot show.**
  - Live phone hardware latency (`results/browser.json` uses desktop Chromium with `Emulation.setCPUThrottlingRate` at 1×, 4×, and 6× as a stand-in; actual mid-range phone measurements remain to be gathered).
  - Live creature reply agreement (`why: "agree"`) in production dialogue (`next.html` shadow mode).
  - Real-world STT transcription noise beyond the `stt-clean` and `stt-noisy` splits in the dataset.

---

## 2. Fuzzy commands and cascades (`wake` / `fuzzy`)

On the held-out `wake` split (target: 0.5% bad acts across all tuning lines; `none` triggers nothing):

| Arm / Cascade | Recall | Wrong action (command lines) | Wrong action (all lines) | False trigger (non-commands) | Precision | p50 ms | p95 ms | $ / 1,000 |
|---|---|---|---|---|---|---|---|---|
| `readers` (Brit's regexes) | 20.1% | 0.6% | 0.1% | 0.2% | 94.6% | 0.010 | 0.410 | $0 |
| `ngram` | 47.7% | 1.7% | 0.4% | 0.4% | 94.3% | 0.040 | 0.150 | $0 |
| `minilm-head` | 53.4% | 1.7% | 0.4% | 0.6% | 93.9% | 1.410 | 1.790 | $0 |
| `jev` (`typesafe/jev-1.14`) | 81.0% | 0.3% | 0.1% | 0.0% | 99.7% | 166 | 305 | $0.0253 |
| `clef` (`cloudflare/clef`) | 60.1% | 0.0% | 0.0% | 0.1% | 99.5% | 337 | 513 | $0.1052 |
| `clef-flash` (`cloudflare/clef-flash`) | 56.0% | 0.0% | 0.0% | 0.0% | 100.0% | 245 | 677 | $0.0167 |
| `readers → ngram` | 57.2% | 1.7% | 0.4% | 0.6% | 94.3% | 0.030 | 0.060 | $0.0000 |
| `readers → minilm-head` | 63.2% | 2.0% | 0.5% | 0.8% | 93.6% | 1.550 | 2.200 | $0.0000 |
| `readers → jev` | 83.3% | 0.9% | 0.2% | 0.2% | 98.3% | 173 | 228 | $0.0240 |
| `readers → clef-flash` | 67.5% | 0.6% | 0.1% | 0.2% | 98.3% | 233 | 487 | $0.0158 |
| `readers → ngram → jev` | 85.1% | 2.0% | 0.5% | 0.6% | 95.8% | 0.030 | 202 | $0.0082 |
| `readers → ngram → clef-flash` | 74.4% | 1.7% | 0.4% | 0.6% | 95.6% | 0.030 | 384 | $0.0054 |

- **`readers → ngram` trade-off:** Adding the on-device n-gram model behind Brit's readers raises command recall from **20.1%** to **57.2%** with no network, no key, and 0.030 ms median latency. Its false-trigger rate on non-commands is **0.6%**, and its wrong-action rate is **1.7%** on command lines (**0.4%** across all lines), compared with **0.6%** on command lines (**0.1%** all lines) for `readers` alone, **0.9%** (**0.2%** all lines) for `readers → jev`, and **0.6%** (**0.1%** all lines) for `readers → clef-flash`.
- **Chat models (`llama8b-groq`, `llama8b-logprobs`):** Both received `never` gates (`> 1.0`) because Groq returns no logprobs (`p = 1`) and CoreWeave failed the 0.5% tuning bad-act budget.

---

## 3. Emote (`express` / `emote`)

On the held-out `express` split (target: 2.0% bad acts across all tuning lines; `calm` triggers nothing):

| Arm / Cascade | Recall | Wrong action (emotion lines) | Wrong action (all lines) | False trigger | Precision | p50 ms | p95 ms | $ / 1,000 |
|---|---|---|---|---|---|---|---|---|
| `ngram` | 14.9% | 3.7% | 3.1% | 4.5% | 76.2% | 0.020 | 0.060 | $0 |
| `minilm-zeroshot` | 15.9% | 3.7% | 3.1% | 0.0% | 81.0% | 1.990 | 3.400 | $0 |
| `minilm-head` | 51.4% | 0.9% | 0.8% | 9.1% | 94.8% | 1.800 | 2.980 | $0 |
| `jev` | 87.8% | 0.9% | 0.8% | 0.0% | 99.0% | 174 | 230 | $0.0207 |
| `clef` | 74.8% | 0.9% | 0.8% | 0.0% | 98.8% | 361 | 617 | $0.0767 |
| `clef-flash` | 83.2% | 2.8% | 2.3% | 0.0% | 96.7% | 224 | 418 | $0.0121 |
| `readers → minilm-head` | 51.4% | 0.9% | 0.8% | 9.1% | 94.8% | 1.240 | 1.690 | $0.0000 |
| `readers → jev` | 87.8% | 0.9% | 0.8% | 0.0% | 99.0% | 178 | 247 | $0.0204 |

- `minilm-head` provides strong on-device recall (51.4%) at 1.800 ms p50, while hosted `jev` reaches 87.8% recall with 0.0% false triggers.

---

## 4. Calibration and why the host matters

- **Calibration (ECE):** On `wake`, `jev` achieves ECE **0.007** and `minilm-head` **0.011**, whereas `clef` (**0.075**) and `clef-flash` (**0.173**) are more overconfident and require higher fitted gates (`0.8846` and `0.8794`).
- **Same weights, different host (`clef` vs `clef@primeintellect`):**
  - On `wake`: `clef` (Cloudflare) had **0/2,778** failed calls (p95 **513 ms**, p99 **608 ms**). `clef@primeintellect` had **244/3,007** failed calls (p95 **2,632 ms**, p99 **3,607 ms**).
  - On `express`: `clef` (Cloudflare) had **0/1,103** failed calls (ungated accuracy **94.6%**, recall **74.8%**). `clef@primeintellect` had **172/1,103** failed calls (ungated accuracy **48.1%**, recall **46.7%**).
  - **Cause in raw logs:** Every failed row in `results/raw/wake.clef@primeintellect.jsonl` (244 of 3,007 calls) and `results/raw/express.clef@primeintellect.jsonl` (172 of 1,103 calls) is an **HTTP 429** error (`"Too many concurrent hosted model requests"`).
  - Because different hosts exhibit different reliability, latency, and calibration, `models/gates.json` keys non-default hosts separately (`hosted@cloudflare/clef@primeintellect`) and `boot.js` pins OpenRouter's `provider.only` host per model.

---

## 5. In-browser cost (`results/browser.json`)

Measured in headless Chromium (`156.0.8078.79`, ONNX Runtime Web `1.19.2`, `numThreads: 1`) loading `demo/?embed=1&mode=shadow`:

- **Page ready (including 23 MB quantized MiniLM load):** `2,080 ms` (`cpu_1x` cold MiniLM load: `1,489 ms`; `cpu_4x` cold load: `2,788 ms`).
- **Per-decision latency across CPU throttling:**

| Metric | `cpu_1x` (p50 / p95) | `cpu_4x` (p50 / p95) | `cpu_6x` (p50 / p95) |
|---|---|---|---|
| `ngram_ms` | 0.020 / 0.085 ms | 0.045 / 0.100 ms | 0.070 / 0.265 ms |
| `minilm_ms` | 6.2 / 11.6 ms | 32.1 / 39.3 ms | 50.8 / 65.7 ms |
| `hear_sync_part_ms` | 0.2 / 0.4 ms | 1.3 / 2.1 ms | 2.0 / 3.2 ms |
| `hear_until_all_engines_done_ms` | 5.6 / 13.5 ms | 31.5 / 75.4 ms | 50.0 / 114.3 ms |

- `hear()` returns synchronously in `<= 2.0 ms` p50 even at 6× CPU slowdown; MiniLM runs asynchronously after `hear()` returns.
- Funnel integration overhead in `test_funnel.mjs` (`sendTxtFrom` with 2 shadow routes vs original): added `0.042 ms` p50, `0.113 ms` p99.

---

## 6. Worker isolation cost (`results/browser.json`)

Measured via `worker_round_trip_ms` (300 `postMessage` round-trips per rate):

| CPU rate | p50 | p95 | p99 |
|---|---|---|---|
| `cpu_1x` | 0.0 ms | 0.1 ms | 0.2 ms |
| `cpu_4x` | 0.1 ms | 0.8 ms | 1.0 ms |
| `cpu_6x` | 0.1 ms | 1.2 ms | 1.4 ms |

Isolating a third-party extension in a Web Worker adds `<= 0.1 ms` at p50 and `<= 1.2 ms` at p95 even under 6× CPU slowdown.

---

## 7. Proxy and key checks

- **Key resolver (`test/test_keys.mjs`):** 21/21 checks pass — verifies lane selection (`own`, `byok`, `typesafe`, `house`), host-bound key isolation (a key never leaves its bound host), and secret redaction from error strings.
- **Secret scanner (`tools/keyscan.mjs`):** Scans the repository on every CI run (`.github/workflows/sysrouter.yml`) to ensure no API keys or `.env` files are committed.
