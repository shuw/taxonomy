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

The **Fill from documents** button opens a two-step modal. Pick the sections to gather while the
generated request updates beside them, copy it into any agent that can see your documents
(Claude with connectors, a CLI agent pointed at a folder of PDFs, ChatGPT with uploads), and
paste back the YAML it returns. The app validates it, shows every proposed change beside the current value with the
source the agent cited, and writes only the rows you accept. Sources stay with each number and
show as chips in the sidebar. If the intake includes last year's return, a calibration card
shows how closely the engine reproduces it.

The document format is in `docs/INTAKE.md`; the parser, prompt and mapping live in
`packages/engine/src/intake/` and are tested against a fixture.

## Profile schema (version 3)

Facts, choices and dates are separate things. `people`, `income`, `carryforwards`, `returns`,
`equity` (companies with a share price and optional price path; grants by the portal's three
counts; holdings with cost and AMT basis), `home` and `deductions` are facts for the first plan
year. `timeline` holds dated changes to any of them. `scenarios` holds named lever settings and
`activeScenario` picks one; "Save as…" in the top bar snapshots the current levers. `sources`
records provenance by path, with grants, holdings and companies keyed by id. Older files are
migrated on first read. The full description is in `docs/DATA-MODEL.md`; every scalar field is
declared once in `packages/engine/src/fields.ts`, which drives the intake prompt, the review
table, the assistant and the timeline picker.

## Creating a profile

"New profile" in the top bar opens the same intake flow with two start modes: with your agent
and documents (the default), or by hand with a short form. Either way the profile is a file
you can keep editing from the sidebar or in a text editor.
