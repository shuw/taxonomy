# Taxonomy: approach

## What it is

A local, single-profile tax planning tool for understanding, not filing. It shows the whole
multi-year picture reacting live to one change: exercise more ISOs, watch AMT this year, the
credit that comes back over the next years, and the total across the plan.

## Stack

- **Bun** for everything: dev server (`bun packages/app/server.ts`), bundling React/TSX,
  and tests (`bun test`). Chosen partly by necessity: this machine's endpoint policy blocks
  esbuild's ad-hoc-signed binary, so Vite and Vitest cannot run here. Bun ships its own
  bundler and needs no native postinstall.
- **TypeScript** throughout. `packages/engine` is pure functions with no I/O and no React;
  `packages/app` is a small React 19 SPA that imports the engine. The engine is also runnable
  from a CLI (`bun run plan`) so the math can be inspected without the UI.
- **No chart library.** The year strip and the threshold curve are hand-drawn SVG, which
  keeps the explanations and thresholds under our control and the dependency list tiny.

## Tax engine: own the math, borrow the answers

Evaluated:

- **PolicyEngine US** (Python). Broad and accurate for one year, models federal + every
  state including Washington's capital gains excise tax, and models AMT. But it is single-year
  with no carryforwards (AMT credit, capital losses), it has no notion of ISO exercises or
  dual basis, each simulation takes a large fraction of a second, and the install is heavy.
  A live slider driving six years of simulations would lag, and its rule graph is not
  something you can read a plain-English reason out of.
- **Tax-Calculator (OSPC)** (Python). Federal only, aimed at population microsimulation,
  same single-year and no-ISO limitations.

Neither fits the "move a lever, see six years respond, explain every number" loop, and
both would put a Python service between the UI and the math. So the engine here is a small
readable TypeScript model (a few hundred lines) that computes exactly what the tool needs:

- Regular tax with the 2026 brackets, standard vs itemized, the OBBBA SALT cap and its
  phase-down and 2030 reversion, the 0.5% AGI charitable floor.
- AMT with the 2026 exemption, the 50% phaseout above $500k/$1M, 26/28% rates, capital
  gains preserved at preferential rates, ISO bargain element as a preference.
- The minimum tax credit: generated from deferral items (ISO), carried forward and used
  against regular tax above tentative minimum tax.
- NIIT, additional Medicare tax, Washington capital gains excise tax.
- Parameters for years after 2026 are projected from the published 2026 values using the
  profile's inflation assumption (flagged as projected).

Every intermediate is written to a ledger with a plain-English reason and a list of the
lines it depends on. That ledger is what the UI's "why?" reads.

PolicyEngine remains useful as a **validation oracle**: a later step can run a handful of
fixed scenarios through it and assert the engine matches within tolerance. It would be a
dev-only dependency, never in the loop.

## Profile file

One file per profile in `data/profiles/<id>.yaml` (gitignored; `data/profile.example.yaml`
is committed). A profile is a person, a household, or a what-if version of either; the top bar
switches between them and can create, duplicate, rename and delete. The `name` field is the
display name; the file name is the id.

```yaml
version: 1
name: Me
filer:       { filingStatus: single, state: WA }
plan:        { startYear: 2026, years: 6 }
assumptions: { inflation: 0.025, wageGrowth: 0.03, fmvGrowth: 0.15 }
income:      { wages: 320000, interest: 6000, qualifiedDividends: 4000, longTermGains: 0 }
deductions:  { mortgageInterest: 0, propertyTax: 0, charitable: 0 }
equity:
  isoGrants: [{ name: "2023 grant", strike: 2.00, fmv: 18.00, shares: 40000 }]
  amtCreditCarryforward: 0
levers:
  isoExercises: { 2026: 4000 }
```

Amounts are for the start year; wages grow by `wageGrowth`, ISO value by `fmvGrowth`.
The file is the source of truth in both directions: the sidebar edits it in place (comments
preserved), and the app re-reads it when you edit it by hand. On first run, when the file does
not exist, a one-card intake asks for filing status, state, salary and first plan year, plus an
optional ISO grant, and writes the file.

## First screen

- **Left: you and your levers.** Collapsible sections (You, ISO exercises, Other income,
  Deductions, Assumptions) that shrink to one-line summaries. The ISO section has one slider
  per plan year with the AMT crossover drawn on the track.
- **Top: the headline.** Total tax over the plan, and its delta against the pinned scenario.
- **Year strip.** One stacked column per year: regular tax, AMT, NIIT and Medicare, state.
  A second strip shows the AMT credit bank. When a scenario is pinned, its columns sit
  beside the live ones in gray.
- **Threshold curve.** For the focused year, AMT as a function of shares exercised, with
  the crossover and the current position marked.
- **Ledger table.** The key lines for every year. Click any number and the right panel
  explains it and links to what it was computed from.

## Equity and the assistant

Grants are typed (`iso`, `nso`, `rsu`) with a vesting schedule or explicit per-year counts; the
engine expands schedules into per-year vests, tracks what is exercisable, and routes each type
to the right place (AMT preference, ordinary income at exercise, ordinary income at vest).
Because portals show this information as screenshots and tables rather than fields, the
sidebar's primary path is an assistant: the server forwards the conversation (text and pasted
images) to the Anthropic API with the profile schema and current YAML in the system prompt, and
a single strict tool the model uses to propose edits. The client renders proposals as cards and
only an approved card is written, through the same edit path the sidebar uses.

## Deliberate simplifications (v1)

Listed in `packages/engine/src/federal.ts`. The big ones: no sale of ISO shares yet (so no
dual-basis AMT adjustment, no disqualifying dispositions), no vesting schedule, no loss
carryforward, mortgage interest taken as given, no credits besides the minimum tax credit.

## Next levers, in likely order

1. Sales of ISO, NSO and RSU shares (dual basis, holding periods, disqualifying dispositions).
2. Mortgage as a lever (balance x rate, $750k cap) instead of an interest figure.
3. Charitable giving and realized gains as levers; NIIT interplay.
4. Future rate-change assumption (a "what if rates rise in 2029" lever).
5. Scenario files: save pinned scenarios back to `data/scenarios.yaml`.
6. Income/deduction overrides per year in the profile.
7. PolicyEngine validation suite.
