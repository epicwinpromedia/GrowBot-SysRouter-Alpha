# sysrouter/ — the GrowBot System Router

One small registry for the fast paths. A **route** is a typed question about what was just said (yes/no, pick one, score) plus a table of which answer may trigger which action the page already has. A **provider** answers it: Brit's own regex readers first, then an on-device model, then, if the person chooses, a decision model such as Jev or Clef. The router asks, checks the answer, and at most *selects* a registered action. It starts in shadow, where it only writes journal rows.

Everything this effort produced lives in this folder. The rest of the repository is a copy of Brit Cruise's GrowBot and is untouched. `app/` in particular is his read-only mirror of growbot.dev.

## Try it (no key, no install)

```bash
node sysrouter/test/run-all.mjs          # every test: about a minute, prints PASS or FAIL
node sysrouter/tools/serve.mjs           # then open http://localhost:8765/sysrouter/demo/
```

The demo page lets you type what a person might say and shows what each route decided, which engine decided it, how sure it was, how long it took and the journal row the app would write. The readers it uses are read live from `app/v3/next.html`.

## Read in this order

| File | What it is |
|---|---|
| [RESULTS.md](RESULTS.md) | **Start here.** What was measured, what it shows, what it cannot show |
| [INTEGRATION.md](INTEGRATION.md) | For Brit: eight small steps, the three lines the page needs, how to undo it |
| [SPEC.md](SPEC.md) | The contract: actions, providers, routes, gates, tiers, the journal row, flags, keys |
| [THREAT-MODEL.md](THREAT-MODEL.md) | What can go wrong, what stops it, what remains |
| [MISSION.md](MISSION.md) · [REQUIREMENTS.md](REQUIREMENTS.md) | What was asked for, and each requirement's status with its evidence |
| [data/DATASHEET.md](data/DATASHEET.md) | The dataset: sources, licences, splits, limits |
| [research/](research/) | How GrowBot works today (`CODEMAP.md`), vendor facts (`VENDORS.md`), earlier claims checked (`CLAIMS-LEDGER.md`) |
| [GATHER.md](GATHER.md) | What is still open |

## What is where

```
src/           the shipped path: nine browser ES modules, zero dependencies, 785 lines
  sysrouter.js     the router (255 lines)
  s1-readers.js    Brit's readers as a provider        s1-ngram.js   on-device linear model
  s1-embed.js      on-device MiniLM (ONNX Runtime Web)  s1-http.js    Jev / Clef / OpenRouter
  s1-chat.js       a small chat model as an engine      keys.js       one key resolver, Node and browser
  wakeword.js  expressive.js  soft-reflex.js           the registrations (data)
  boot.js          wires it into the page, off until ?sysrouter=1
models/        the trained on-device models and the fitted gates (small JSON files)
integration/   apply.mjs: the three-line page change, anchored and checked, applied only to a copy
test/          plain Node scripts that print PASS or FAIL (run-all.mjs runs them)
bench/         the benchmark: slice Brit's readers, train, ask every engine, report
data/          the dataset builder, the authored lines, the public samples, v1/
tools/         serve (demo), proxy (keys stay on your machine), keyscan, get-models, stt_roundtrip.py
demo/          the bench page
results/       results.json, TABLES.md, browser.json, and raw/ : every engine's raw answer to every line
```

## Re-run the benchmark

```bash
cp env.example .env                       # then put your OpenRouter key in it (one key reaches every engine)
cd sysrouter && npm install               # onnxruntime-node, for the embedding arm only
node bench/run.mjs                        # everything; resumable. --local runs the no-key arms only
node bench/browser.mjs                    # the in-browser measurements (needs Playwright's Chromium)
```

`results/raw/` holds every reply already collected, so `node bench/report.mjs` alone rebuilds every table from them with no network. Delete `results/raw/` to measure from nothing. Add an engine by adding a line to `bench/arms.json`.

After a new snapshot of `app/`: `node sysrouter/integration/apply.mjs --check` and `node sysrouter/test/test_readers_regression.mjs` say at once whether anything moved.

## Rules for these documents

- **Evidence labels** in `research/`: **V** verified by reading the code (file:line), **B** Brit's own field measurement quoted from a comment, **I** our inference.
- **No unmeasured numbers.** A figure is measured by us (and reproducible from `results/raw/`), cited from a primary source, or marked to be measured.
- **Line numbers** are for the `app/` snapshot named at the top of `research/CODEMAP.md`.
- **Plain language.**

## Licence

Same as the repository: PolyForm Noncommercial 1.0.0 for code, CC BY-NC 4.0 for documents. Third-party data keeps its own licence (`data/DATASHEET.md`). Contributed under the licence grant in `CONTRIBUTING.md`.
