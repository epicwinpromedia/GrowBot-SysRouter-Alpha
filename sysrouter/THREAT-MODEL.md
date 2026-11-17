# SysRouter — Threat model (R-SAFE-5)

Built from the code as it is (`research/CODEMAP.md` §8, §10), not from an ideal system. Two facts set the frame:

- **The relay has no authentication.** The pairing code works as a password (`PORTING.md`). Anyone who has it can drive the body. SysRouter does not change that, for better or worse.
- **The page is one JavaScript scope.** `agent-gateway.js` says of itself that it is not a security boundary: it guards against a buggy cooperative brain, not a hostile one. The same is true of any check SysRouter makes inside the page.

So the honest claim is narrow: **SysRouter adds no new way to reach the body, and a System One engine can cause nothing worse than one registered, already-clamped action at the wrong moment.** The rest of this page shows why, threat by threat.

## What is being protected

| Asset | Why it matters |
|---|---|
| The body (legs, voice, screen) | physical motion and sound near a person |
| The stop paths | the person's ability to halt it at once |
| The person's words | private speech; today hashed before they reach the journal |
| Keys and credits | the person's own OpenRouter key; house credits |
| The creature's behaviour | the person's trust that it acts as itself |

## Threats

| # | Threat | What stops it | Evidence | What remains |
|---|---|---|---|---|
| T1 | **Prompt injection by speech.** Someone says, or plays audio of, "ignore your instructions and …". | An engine's reply is never executed. It can only select an option the route listed, and that option maps to an action the page registered (SPEC L1). There is no free-form output to hijack. | `test_router` "select, never author"; `fuzz_router` (injection strings in every round) | Speech can still *select* a registered action, as any spoken command can. That is the feature. |
| T2 | **A wrong answer.** The engine is confidently wrong ("let's stop by the store" → halt). | Gates fitted on held-out data bound how often (`RESULTS.md`); a route starts in shadow, where being wrong costs nothing; a wrong *stop* fails safe (the creature pauses). | benchmark, by kind of line | A false trigger rate above zero. `RESULTS.md` gives it per engine. |
| T3 | **A missed stop.** The engine fails to recognise an unusual stop phrase. | No worse than today: the deterministic readers run first, unchanged, and are never blocked or delayed (SPEC L6). An engine can only add stops. | `test_readers_regression` part 3 | Phrasings neither the readers nor the engine recognise. |
| T4 | **A slow or dead engine.** Network loss, vendor outage, rate limit. | Each route has a time budget; past it nothing runs and the words take today's path (SPEC L4). The deterministic layer never waits on the network. | `test_router` "fail to today"; reliability column in `RESULTS.md` (one host returned HTTP 429 on 10% of calls under load) | The fast reaction is absent for that utterance. |
| T5 | **A malicious or buggy extension.** | It receives a frozen facade: its own routes only, over granted actions and providers, rate-capped, no pre-empt, no reserved actions (SPEC §6). Its registration is data, so it need not run code in the page at all. | `test_router` "tiers and grants"; 6 mutants | An extension whose *engine* is hostile can still pick wrongly among its granted actions. Grant narrowly. |
| T6 | **Hostile script in the page** (a compromised dependency, an XSS). | Nothing in SysRouter. In-page script can call `moveLegs` directly today. | — | Out of scope, and unchanged by this work. Stated so nobody assumes otherwise. |
| T7 | **Key theft.** | A key is bound to one host, sent only over https, never logged or echoed, redirects refused (SPEC §10). The `own` lane keeps keys out of the browser entirely. | `test_keys` (21 checks) | A key in `localStorage` is readable by in-page script (T6). Use the `own` lane if that matters to you. |
| T8 | **Spending someone's credits.** A page from another origin calls the local proxy; a route floods a hosted engine. | The proxy allows listed origins only and binds to localhost; hosted engines are asked only when the person named one (`?s1=`); extensions are rate-capped; the on-device engines cost nothing. | proxy smoke test (`RESULTS.md` §7); `test_router` rate cap | A person who enables a hosted engine pays for each decision. Cost per 1,000 is in `RESULTS.md`. |
| T9 | **Leaking private speech.** | The router's rows never contain the words (SPEC L8). The proxy's shadow log holds a hash. A hosted engine does receive the words, exactly as the brain's model does today. | `test_router` "observability"; fuzz invariant | Sending text to a hosted engine is a disclosure to that vendor. The on-device engines disclose nothing. |
| T10 | **A silent change of model.** A vendor updates a model; its confidence shifts. | Gates are keyed by the model id the engine reports. A new id has no gate, so it cannot act until measured (SPEC L3, §9). | `test_router` "gate for this exact model version" | A vendor that changes weights without changing the id. Pin dated ids (`typesafe/jev-1.14-20261014`), not `latest`. |
| T11 | **The router itself breaks.** | Every call into it from the funnel is `typeof`-guarded and inside `try/catch`; the kill switch removes it entirely. | `test_funnel`: identical funnel behaviour with the router absent, null, in shadow, and throwing | — |

## Not claimed

- That the body is secure. The relay is open and the page is one scope.
- That an engine is never wrong. The claim is a measured rate and a bounded consequence.
- That in-page tier checks stop hostile code. They stop mistakes and well-behaved extensions; data-only extensions and Workers (SPEC §9) are what keep third-party code out of the scope.
