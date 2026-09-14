# Taxonomy

A personal tax planning tool for understanding, not filing. Move a lever, watch six years of
federal and state tax respond, and click any number to see why it is what it is.

```sh
bun install
bun run dev            # http://127.0.0.1:5180 — first run asks for the basics and writes data/profiles/<name>.yaml
bun run test           # engine tests
bun run plan           # print the plan for data/profile.yaml in the terminal
```

Profiles are plain YAML files in `data/profiles/`, one per person or what-if. Switch, rename,
duplicate and delete them from the top bar, or edit the files by hand; the app follows.
Money fields accept `620k` and `1.2m`.

Equity grants come in three types, each taxed the way the code treats it: ISO exercises feed AMT,
NSO (NQSO) exercises are ordinary income, RSUs are ordinary income when they vest. Grants take a
vesting schedule (start date, years, cliff, cadence) or explicit per-year counts.

## Filling the profile from documents

The **Fill from documents** button opens a three-step modal. Pick the sections to gather, copy
the generated request into any agent that can see your documents (Claude with connectors, a
CLI agent pointed at a folder of PDFs, ChatGPT with uploads), and paste back the YAML it
returns. The app validates it, shows every proposed change beside the current value with the
source the agent cited, and writes only the rows you accept. Sources stay with each number and
show as chips in the sidebar. If the intake includes last year's return, a calibration card
shows how closely the engine reproduces it.

The document format is in `docs/INTAKE.md`; the parser, prompt and mapping live in
`packages/engine/src/intake/` and are tested against a fixture.

## Assistant

The Assistant button opens a panel for quick edits from a single screenshot or a sentence. It
calls the Anthropic API from the local dev server, so the machine running `bun run dev` needs
credentials: `export ANTHROPIC_API_KEY=...` or `ant auth login`. Proposals appear as cards;
nothing is written until you click Apply. Set `TAXONOMY_MODEL` to change the model (default
`claude-opus-5`).

## Profile schema (version 2)

`people` (self and optional spouse: salary, bonus, pre-tax contributions), household `income`,
`carryforwards` (AMT credit, capital losses, charitable), `priorReturn` for calibration,
`equity` (share price, typed grants with vesting, holdings with cost and AMT basis), `home`
(mortgage as a loan; interest and the $750k cap are computed), `deductions` (charitable by kind,
state tax, medical), `levers`, and `sources`. Version 1 files are migrated on first read.
