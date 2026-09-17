# Architecture

Taxonomy is a local tool for understanding, not filing: a person's facts and a list of decisions
go in, a multi-year picture of tax and cash comes out, and every number carries the reason it is
what it is. This document is the map. `DATA-MODEL.md` describes the profile file, `INTAKE.md` the
agent-driven intake, `PROPOSAL.md` the original brief.

## Shape

```
packages/engine      pure TypeScript, no React, no I/O; unit-tested with bun test
packages/app         React UI (Bun serves it; no bundler beyond Bun's) + a small file server
packages/mcp         the engine's tool layer for an outside agent: taxonomy.ts (tools),
                     server.ts (stdio: Claude Desktop, Claude Code), http.ts (claude.ai via a tunnel),
                     store.ts (the data directory as both servers see it: paths, ids, history,
                     attachments, the remote secret; the app server imports it too)
data/profiles/*.yaml one file per person or what-if (gitignored); data/profile.example.yaml
data/attachments/<id>/ the pages and statements behind a profile's numbers (gitignored)
docs/                this file, the data model, the intake contract, the proposal
```

The engine is the product. The app is a view over engine results plus an editor for the file.
Nothing in the app computes tax.

## The three kinds of thing in a profile

| Kind | Where | Changes when | Examples |
|---|---|---|---|
| Facts | everything in the profile except `scenarios` | the world changes | salary, grants, holdings, mortgage, last return |
| Dated changes | `timeline: [{ year, path, value }]` | a fact will change on a known date | a raise in 2027, a move to CA |
| Decisions | `scenarios.<name>.events` | you change your mind | exercise, sell, liquidity event |

Facts and dated changes apply to every scenario; decisions belong to one. The UI keeps the
split: facts live in the "Edit my information" dialog, dated changes and decisions live on the
timeline strip, and the sidebar holds what-if knobs (share price, growth, assumptions, the
state-tax switches).

## Engine pipeline

```
Profile ──parseProfile──▶ Profile (v3, normalized)
                                 │
   scenario events ──leversOf──▶ Levers   (per-year table: exercises by type and company,
                                 │         exercise dates, sales, liquidity events)
                                 ▼
 runPlan = for each plan year: stepYear(profile, base, levers, year, state)
      profileInYear      apply dated changes ≤ year
      yearInputs         growth, vesting, exercises drawn from grants, RSU settlements, carries
      lots               + lots from this year's exercises and settlements; − lots sold
      computeYear        computeFederal → state module → SALT second pass → totals → cash lines
      state out          carryforwards (AMT credit, capital losses, charitable) + lots + mortgage
```

- `Levers` is derived, never stored. The file stores events; `leversOf` collapses them. Older files
  that stored the table directly are read and mapped (`profile.ts`).
- `stepYear` is resumable: `stateBefore(year)` runs the earlier years once, and `yearFrom` probes
  one year from that state. The AMT crossover search and the exercise sweep use this so a slider
  move costs one year of work per probe, not the whole plan. `runPlanFrom` continues to the end
  when plan totals are needed.
- `computeYear` runs the federal computation twice when a state models an income tax, so the
  modeled state tax can feed the SALT deduction.
- Every intermediate is a `Line` on a `Ledger` with an id, a label, a value, a unit, a
  plain-English `why`, and the ids it depends on. The UI's explain panel walks `deps`.

### Federal (`federal.ts`)

Regular tax with the OBBBA-era parameters in `params.ts` (2025 published, 2026 published, later
years indexed by the inflation assumption), the deduction choice made on regular tax plus AMT
together, AMT with the 50% exemption phaseout, the minimum tax credit split into deferral
(creditable: ISO spread, ISO basis adjustments) and exclusion (not creditable: SALT and standard
deduction addbacks), NIIT, and the additional Medicare tax. Simplifications are listed in the file
header and repeated in the relevant `why` texts.

### Equity (`equity.ts`, `lots.ts`)

Grants carry the three counts every portal shows (granted, vested to date, exercised to date) plus
a schedule or per-year vest counts. `vestingOf` turns that into what vested before the plan and
what vests in each plan year, honoring `countsAsOf` so numbers read mid-year do not double count.

Exercises are per company: `exerciseDraws` takes each company's shares for the year from that
company's grants in file order, capped by what is vested and not yet exercised. `lotsFromExercise`
turns draws into lots (ISO: basis = strike, AMT basis = value at exercise; NSO: basis = value at
exercise). RSU settlements become a lot at their settlement value. Sales consume lots lowest tax
first (`lowestTaxOrder`) unless the event names lots, and each lot sold yields long- or
short-term gain, ordinary income for a disqualifying ISO disposition, and a negative AMT basis
adjustment for ISO shares. Dates: exercises default to January 1 of their year, RSU settlements to
January 1, sales to December 31; events can carry an explicit date.

### Analyses (`thresholds.ts`)

Built on the resumable runner: `amtCrossover` (largest AMT-free exercise for a year and company),
`sweepIsoExercise` (AMT and tax across the exercise range), `sharesToCover` (smallest sale whose
proceeds pay the year's tax), `creditRecovery` (how one exercise's credit comes back, by
comparing the plan with and without it), `holdOrSell` (the same exercise sold next year versus
the same day, each laid over the existing timeline).

### States (`state/`)

A `StateModule` writes its lines given the year's inputs and federal AGI. Washington models the
capital gains excise tax (7% + 2.9% over $1M) and the 2028 millionaires' tax as switches;
California is an approximate income tax with its own AMT; Texas, Florida and Nevada are zero. A
modeled state income tax flows into the federal SALT deduction through the second pass.

### History (`history.ts`)

`describeChanges(before, after)` turns two profiles into plain lines: decisions by event id,
dated changes, agent proposals and documents, equity items by id, then every other scalar with
the field registry's label and format. Both servers append one entry per save (time, actor,
lines, the previous text) to `data/history/<id>.jsonl`; the app's History tab reads it and can
restore any earlier version.

### Attachments

The documents behind the numbers live beside the profile in `data/attachments/<id>/`
(images, PDFs and text, owner-only modes). The app's Last return tab lists, adds and removes
them, and an agent that holds the file stores it with `intake(attach)`. A `sources` entry that
names a stored file ("2025 Form 8801 line 26 (2025-return-p1.png)") turns that field's source
chip into a link to the page, so a value can be checked against what it came from.

### Stores and accounts

`packages/mcp/store.ts` builds a `Store` from a directory: profile files, history, attachments,
the `.current` and `.agent` markers and the remote-access secret, all under that directory.
Without accounts there is one store, `data/` itself, and both servers use it. With accounts
(`packages/app/auth.ts`: `TAXONOMY_AUTH=1`, or any non-loopback `HOST`) every request to the
app server passes a guard that turns the session cookie into a user and the user into
`data/users/<id>/`; handlers only ever touch the store attached to the request, so a profile
id from one account cannot address another's files. Accounts and sessions live in
`data/auth.sqlite`: argon2id password hashes, sessions stored as the SHA-256 of a random id,
30 days sliding. Sign-in is rate-limited per client and email. The HTTP MCP server picks its
store by the secret in the request (path or bearer header) with a constant-time compare, and
the stdio server stays local and uses the root store.

### Tool layer (`tools.ts`)

Pure functions an agent calls through `packages/mcp/server.ts`: orient (`context`, `plan`),
explain (`explain`, `compareYears`, `amtHeadroom`, `recovery`, `holdVersusSell`, `lots`,
`sellToCover`), try (`whatIf`, `proposeScenario`, `setActiveScenario`, `deleteScenario`) and
intake (`intakeRequest`; `applyIntake` writes a submitted document at once, while `submitIntake` parks one as `pendingIntake` for the app's own paste-a-reply review) and facts (`updateFacts` builds the changes; the MCP server accepts them in the same write; `pendingReview`
and `resolvePending` back the review card). Mutations return `ProfileEdit[]`; the MCP server applies
them to the file with `editProfileText` and validates before writing, the same path the app uses.
The app reads `pendingReview` for the review card and the history log for what Claude changed.
See `LLM-INTERFACE.md`.

## App

```
App.tsx           profile list and selection, hash-driven dialogs, Workspace
  Workspace       runs the engine (memoized on profile + levers), owns focus year, selection,
                  pinned scenario, plan view; wires Sidebar, the plan card, analyses, ledger
components/
  EventTimeline   the strip under the chart: + at the top of each year, chips (exercise, sell,
                  liquidity, give), fact markers, drag between years, one floating inspector under
                  the selection (timeline/*: AddMenu with hover flyouts, one inspector per kind)
  Strips          ColumnStrip (stacked columns with pinned ghosts; Tax, Combined, credit) and
                  CashStrip (in vs out)
  SweepChart      AMT versus ISO shares for one year and company
  CreditRecovery, HoldOrSell, CalibrationCard, FollowUps, LedgerTable, ExplainPanel
  Sidebar         quick basics, EquityKnobs (price and growth per company), assumptions
  FactsModal      "Edit my information": every recorded fact, one tab per section, plus
                  ConnectAgent (MCP config for Claude Desktop and Claude Code)
  ProposalBanner  the first-run nudge and the review table for a pasted intake reply
  IntakeModal     the new-profile wizard (name, then connect Claude or copy the request; ends
                  when Claude connects) and the paste-a-reply review (see INTAKE.md)
  ClaudePanel     top-bar Claude button and panel: connection state, what arrived, prompts to try
  HistoryModal    every save with who made it and what changed; Restore (HistoryTab)
  Documents       pages behind the numbers (data/attachments); SourceChip links a value to one
  Picker          the app's own menu for the profile and scenario pills (rename, save as, delete)
  Info            the ⓘ popover that carries a card's explanation
  LogRange        the logarithmic shares slider; LeverRow adds the clickable AMT notch
  ShortcutsHelp   the ? sheet; hooks/useShortcuts owns the keys
  Mark            the rolling-coin logo
series.ts         one table of which color each series, chip and badge uses
persist.ts        usePersisted: UI state remembered per profile in localStorage
useProfile.ts     load, poll the file for outside edits, debounce PUTs
server.ts         GET/PUT/DELETE profiles as YAML text; same-origin guard; migrate on read;
                  GET /api/agent tells the app how an MCP client starts packages/mcp
```

Edits from the UI are `ProfileEdit[]` (a path and a value) applied to the YAML *text* with
`editProfileText`, so comments in the file survive. The server validates before writing.

### UI state

`usePersisted(key, initial, validate)` namespaces keys by profile id. Remembered: focused year,
selected timeline item, open sections and cards, dismissed suggestions, plan view, information
dialog tab. "Reset view" in the sidebar clears all of it; the theme and the remembered profile
stay. Dialog state lives in the URL hash (`#facts/<tab>`, `#intake`, `#new`) so a refresh lands in
the same place.

## Adding things

- **A scalar fact**: one entry in `fields.ts`. The intake request, review table, unknown-path
  mapping and the timeline's + menu all read the registry. The information dialog still lays
  fields out by hand, so add the input there too.
- **A decision kind**: a member of `ScenarioEvent`, a branch in `leversOf`, a consumer in
  `stepYear` or `yearInputs`, a chip label and an inspector in `EventTimeline`, a + menu entry.
- **A state**: a `StateModule` in `state/`, registered in `state/index.ts`; if it has an income
  tax, write `stateIncomeTax` so SALT picks it up.
- **A ledger line**: `ledger.put` with a reason and deps; add it to a group in `LedgerTable` if it
  should show in the table.

## Testing

`bun test packages/engine` covers federal math against hand-checked cases, the plan loop, states,
lots and sales, events and profile migration, and the intake parser. `bun test packages/app/test`
starts the server with accounts on against a throwaway directory and checks sign-up, sign-in,
throttling, cookies, per-user isolation, password change and the secret-to-store matching
(`bun run test` runs both). UI behavior is exercised
with headless Chrome scripts during development (not checked in) against throwaway profiles.
Calibration against the user's last filed return runs in the app and reports every line's
difference.

## Known limits

Listed in `DATA-MODEL.md` under "What the schema does not yet hold": ESPP, 83(b), QSBS, Roth
levers, estimated payments. California is approximate. Within-year dates are explicit on events
but the plan is computed by year, so mid-year facts (a raise in June) are still whole-year.
