# Dataset v1 — what it is, where it came from, what it can and cannot show (R-EVAL-1)

Built by `node sysrouter/data/build.mjs` into `v1/wake.jsonl` and `v1/express.jsonl`; exact row counts and file hashes are in `v1/MANIFEST.json`. The build is deterministic.

## The two tasks

| File | Question | Labels |
|---|---|---|
| `wake.jsonl` | Is the person giving the robot a direct command, and which? | `halt`, `still`, `follow`, `unfollow`, `walk_forward`, `walk_back`, `spin`, `sing`, `none` |
| `express.jsonl` | How should the creature feel about what the person just said? | `happy`, `sad`, `scared`, `alert`, `curious`, `calm` |

## Sources

| Kind | Rows | Source | Licence | What it is for |
|---|---|---|---|---|
| `authored` | 328 + 240 | Written for this effort (`authored.mjs`), 2026-11-17 | this repo's | Commands and feelings in varied phrasing: 40 per label |
| `trap` | 162 | Written for this effort | this repo's | A command word with no command ("let's stop by the store"). The hard negatives. |
| `chat` | 80 | Written for this effort | this repo's | Ordinary talk to a companion. Easy negatives. |
| `clinc-in`, `clinc-oos` | 900 + 700 | CLINC150 "plus", validation and test splits, sampled (`sources/clinc_oos.sample.jsonl`). Larson et al., 2019. `clinc/clinc_oos` on Hugging Face. | CC BY 3.0 | Real assistant requests and out-of-scope questions. None is a command to a robot, so every row is `none`: the large false-trigger set. Rows from intents that overlap our actions (`cancel`, `no`, `yes`, `maybe`, `play_music`, `next_song`, `repeat`, `change_speed`, `whisper_mode`) are excluded. |
| `goemotions` | 863 | GoEmotions "simplified", validation and test splits, single-label rows, sampled (`sources/go_emotions.sample.jsonl`). Demszky et al., 2020. `google-research-datasets/go_emotions`. | Apache 2.0 | Reddit comments with emotion labels, mapped onto the six reactions. **A transfer check only**: not speech to a creature, never used for training or gates, reported apart. |
| `stt-clean`, `stt-noisy` | 568 + 40 | The authored `wake` lines spoken by three synthetic voices (Piper, MIT) and transcribed by Whisper large-v3-turbo (faster-whisper, int8, CPU). `tools/stt_roundtrip.py`. | this repo's | The same line **as a recogniser heard it**. Whisper changed the words in 58 of 608 ("stop face tracking" → "Stop feast tracking.", "stay" → "Day."). "noisy" adds brown noise at 5 dB SNR. |

GoEmotions mapping: joy, excitement, love, admiration, gratitude, pride, amusement, relief → `happy`; sadness, grief, disappointment, remorse → `sad`; fear, nervousness → `scared`; surprise → `alert`; curiosity, confusion → `curious`; neutral → `calm`. Anger-family labels are left out: whether anger should frighten the creature depends on who it is aimed at, which a Reddit comment cannot tell us.

Brit's own documented reader cases (42, each quoted from a comment in `next.html`) are not in the benchmark data. They are a regression test: `test/test_readers_regression.mjs`.

## Splits

Each row is `tune` or `held` by a hash of its **original** text, so a line and its transcribed variants are always on the same side.

- **`tune`**: the on-device models are trained here, and every gate is fitted here. Trained models are gated on out-of-fold scores (`bench/train.mjs`), since a model is over-confident on rows it was trained on.
- **`held`**: every number in `RESULTS.md` is from here.

## Limits. Read before quoting a number.

1. **No field data.** No real GrowBot user said any of these lines. The authored lines were written by the same hand that designed the routes, which flatters every engine a little. The fix is the live shadow run (GATHER W6), for which the tools exist (`tools/proxy.mjs`).
2. **English only.** The app speaks 37 languages (`prompts.js`).
3. **The speech round trip is synthetic voices on a CPU build of the model family the app uses**, not phone microphones in rooms through Groq. It yields real Whisper errors, fewer and milder than the field will. Only 40 noisy rows were finished in the time available.
4. **Small label counts.** About 20 held-out lines per command label. A single line moves a per-label recall by 5 points. Read per-label figures as indicative.
5. **`express` has 111 in-domain tuning rows.** Enough to rank the hosted engines, too few to train a good on-device model or to fit a tight gate, and the tables show it.
6. **The traps are adversarial by construction.** A false-trigger rate on traps is an upper bound on purpose; the CLINC rows are the closer estimate of ordinary talk.
