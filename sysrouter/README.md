# sysrouter/ — GrowBot System Router research and development

Everything this effort produces lives in this folder. The rest of the repository is a copy of Brit Cruise's GrowBot and stays untouched. `app/` in particular is his read-only mirror of growbot.dev.

## Read in this order

| File | What it is |
|---|---|
| [MISSION.md](MISSION.md) | What we are building, why GrowBot needs it, goals, non-goals, what "done" means |
| [REQUIREMENTS.md](REQUIREMENTS.md) | Requirements with stable IDs (routing, registration, safety, secrets, observability, performance, compatibility, evidence) |
| [GATHER.md](GATHER.md) | What we still need, the workstream order, decisions waiting on B |
| [research/CODEMAP.md](research/CODEMAP.md) | How GrowBot works today, traced to file and line, and the candidate seams for SysRouter |
| [research/VENDORS.md](research/VENDORS.md) | Verified facts about Jev, Clef, OpenRouter and Vercel routes, with sources |
| [research/CLAIMS-LEDGER.md](research/CLAIMS-LEDGER.md) | Every load-bearing claim from the earlier documents, checked: true, false, open or dropped |

## Rules for these documents

- **Evidence labels:**
  - **V:** verified by reading the code, with file:line
  - **B:** Brit's own field measurement, quoted from a code comment
  - **I:** our inference, still to be confirmed
  - vendor facts carry their source URL and the date read
- **No unmeasured numbers.** A figure is either measured by us, cited from a primary source, or marked TBM (to be measured).
- **Line numbers are for the `app/` snapshot** described at the top of `CODEMAP.md`. When Brit publishes a new snapshot, re-pin.
- **Plain language.** State things directly.
