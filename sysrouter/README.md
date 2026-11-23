# sysrouter/ — the GrowBot System Router

A co-processing router and registry for GrowBot's **mind**. Engines of any kind register the **primitives** they provide: Brit's regex readers, a tiny on-device model, Jev or Clef, a developer's own model, an external API, or a piece of hardware someone attached. Developers compose primitives into **capabilities**, expose them as **commands**, and bind commands to **triggers** that react to **events** in **streams**.

It all runs **alongside** Brit's layer (the body and the creature agent), never in front of it:
- it reads what his layer already produces;
- it reaches his layer only by requesting commands he exposed;
- it never pre-empts anything and never calls `think()`.

It starts in shadow, where it only writes journal rows.

```
an EVENT in a STREAM ─▶ a TRIGGER ─▶ a COMMAND ─▶ a CAPABILITY ─▶ a BEHAVIOR
                                                    │
                                    built from PRIMITIVES provided by ENGINES
```

Two capabilities ship first:
- **fuzzy commands**: a phrasing that means one of Brit's commands, which his readers missed, requests that command through his own command path;
- **emote**: a small sentiment model drives an expression in parallel with the dialogue.

A third, a **siren attachment**, is worked through on paper to test the design (`SPEC.md` §13).

Everything this effort produced lives in this folder. The rest of the repository is a copy of Brit Cruise's GrowBot and is untouched. In particular, `app/` is his read-only mirror of growbot.dev.

## Status

The documents describe the whole design and label each part (`SPEC.md` §0):
- **[built]**: in code and tested;
- **[specified]**: designed, not yet in code;
- **[differs]**: decided, but the code still does otherwise;
- **[proposal to Brit]**;
- **[open]**.

What is built: the router with decision capabilities, five kinds of engine (readers, n-gram, MiniLM, Jev/Clef over HTTP, a small chat model), both shipping capabilities in shadow, keys, the benchmark and its results. `SPEC.md` §16 lists every place the code still differs from the v2 design.

## Try it (no key, no install)

```bash
node sysrouter/test/run-all.mjs          # every test: about a minute, prints PASS or FAIL
node sysrouter/tools/serve.mjs           # then open http://localhost:8765/sysrouter/demo/
```

The demo page lets you type what a person might say. It shows what each capability decided, which engine decided it, how sure it was, how long it took, and the journal row the app would write. The readers it uses are read live from `app/v3/next.html`.

## Read in this order

| File | What it is |
|---|---|
| [RESULTS.md](RESULTS.md) | **Evidence.** Measured accuracy, latency, calibration, host comparison, and in-browser numbers |
| [MISSION.md](MISSION.md) | **Start here.** The intent, the boundary between the router and Brit's layer, the vocabulary, the two lanes, the three use cases |
| [SPEC.md](SPEC.md) | The contract: laws, primitives, engines, streams, triggers, commands, capabilities, lanes, the interface to Brit's layer, and what is built |
| [INTEGRATION.md](INTEGRATION.md) | For Brit: the small steps, what is required of him and what is optional, how to undo it |
| [results/TABLES.md](results/TABLES.md) | Raw benchmark tables: every engine and cascade, for accuracy, latency, cost and calibration |
| [THREAT-MODEL.md](THREAT-MODEL.md) | What can go wrong, what stops it, what remains |
| [REQUIREMENTS.md](REQUIREMENTS.md) | Every requirement, with its status and evidence |
| [data/DATASHEET.md](data/DATASHEET.md) | The dataset: sources, licences, splits, limits |
| [research/](research/) | How GrowBot works today (`CODEMAP.md`), vendor facts (`VENDORS.md`), earlier claims checked (`CLAIMS-LEDGER.md`) |
| [GATHER.md](GATHER.md) | What is still open |

## What is where

```
src/           the shipped path: 13 browser ES modules, zero dependencies, 1512 lines
  sysrouter.js     the router (470 lines)               registry.js   v2 registry, validation & helpers
  s1-readers.js    Brit's readers as an engine          s1-ngram.js   on-device linear model
  s1-embed.js      on-device MiniLM (ONNX Runtime Web)  s1-http.js    Jev / Clef / OpenRouter
  s1-chat.js       a small chat model as a decision engine   keys.js  one key resolver, Node and browser
  fuzzy.js         fuzzy commands                       emote.js      emote (reads both speakers)
  soft-reflex.js   the creature's meaning-triggers      worker-engine.js  Web Worker / thread adapter
  boot.js          wires it into the page, off until ?sysrouter=1
models/        the trained on-device models and the fitted gates (small JSON files)
integration/   apply.mjs: the page change (three insertions), anchored and checked, applied only to a copy
test/          plain Node scripts that print PASS or FAIL (run-all.mjs runs them)
bench/         the benchmark: slice Brit's readers, train, ask every engine, report
data/          the dataset builder, the authored lines, the public samples, v1/
tools/         serve (demo), proxy (keys stay on your machine), keyscan, doccheck, get-models, stt_roundtrip.py
demo/          the bench page
results/       results.json, TABLES.md, browser.json, and raw/: every engine's raw answer to every line
```

`SPEC.md` §2.3 maps the v2 vocabulary to any remaining v1 aliases (`provider` for engine, `action` for command, `grants` for permissions).

## Re-run the benchmark

```bash
cp env.example .env                       # then put your OpenRouter key in it (one key reaches every engine)
cd sysrouter && npm install               # onnxruntime-node, for the embedding arm only
node bench/run.mjs                        # everything; resumable. --local runs the no-key arms only
node bench/browser.mjs                    # the in-browser measurements (needs Playwright's Chromium)
```

`results/raw/` holds every reply already collected, so `node bench/report.mjs` alone rebuilds every table from them with no network. Delete `results/raw/` to measure from nothing. Add an engine by adding a line to `bench/arms.json`.

After a new snapshot of `app/`, two commands say at once whether anything moved: `node sysrouter/integration/apply.mjs --check` and `node sysrouter/test/test_readers_regression.mjs`.

## Rules for these documents

- **Status labels** on every part of the design, as above.
- **Evidence labels** in `research/`: **V** verified by reading the code (file:line), **B** Brit's own field measurement quoted from a comment, **I** our inference.
- **No unmeasured numbers.** A figure is measured by us (and reproducible from `results/raw/`), cited from a primary source, or marked to be measured.
- **Line numbers** are for the `app/` snapshot named at the top of `research/CODEMAP.md`.
- **Plain language.**

## Licence

Same as the repository: PolyForm Noncommercial 1.0.0 for code, CC BY-NC 4.0 for documents. Third-party data keeps its own licence (`data/DATASHEET.md`). Contributed under the licence grant in `CONTRIBUTING.md`.
