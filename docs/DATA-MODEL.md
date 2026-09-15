# Data model

The profile is a YAML file, one per person, household or what-if, at `data/profiles/<id>.yaml`.
It is version 3. Older files are rewritten on first read (`migrateProfileText`); comments do not
survive a version bump, so each top-level section gets a fresh explanatory comment instead.

The engine reads the file into `Profile` (`packages/engine/src/types.ts`). Everything below that
type's shape is a fact about the world; everything the user *decides* lives in `scenarios`, and
everything that *changes on a date* lives in `timeline`.

## Sections

| Section | What it holds | Notes |
|---|---|---|
| `filer` | filing status, state, dependents (by birth year) | dependents are an array so credits can use ages later |
| `plan` | first year, number of years | |
| `assumptions` | inflation (indexes brackets after 2026), wage growth, default share value growth, `bracketRateDelta` | the delta is added to every ordinary bracket rate; put it on the timeline to model a future law change |
| `people` | `self`, optional `spouse`: base salary, bonus, pre-tax contributions, withholding to date | salary is base pay only; RSU vests and option exercises are added by the engine |
| `income` | household interest, total and qualified dividends, realized gains, other ordinary | |
| `carryforwards` | AMT credit (Form 8801), capital losses by term, unused charitable gifts | balances entering the first plan year; the plan loop threads them forward |
| `returns` | filed returns: the inputs as reported and the figures to reproduce | newest is used for calibration |
| `equity.companies` | id, name, share price and its date, optional growth override, optional `pricePath`, optional `liquidityYear` | a price path pins known or assumed prices in specific years (an IPO); growth resumes from the last point; the liquidity year settles double-trigger RSUs |
| `equity.grants` | id, name, type (`iso`, `nso`, `rsu`), company, owner, granted, vestedToDate, exercisedToDate, strike, vesting schedule or per-year counts, expiry, `settlement` for RSUs | the three counts are what every portal shows; outstanding and exercisable shares are derived. A grant with unvested shares and no schedule vests nothing in the plan, and the app says so |
| `equity.holdings` | lots owned: id, quantity, acquisition date, how acquired, cost basis, AMT basis, grant date for ISO shares | the opening lots; exercises and RSU settlements in the plan add lots, sales consume them |
| `home` | the mortgage as a loan (balance, rate, origination, original amount, term), property tax, or a direct interest figure when there is no loan | interest is amortized month by month; the $750k acquisition-debt cap applies by average balance |
| `deductions` | charitable by kind (cash, appreciated stock, DAF), state income tax, medical | cash and DAF up to 60% of AGI, stock up to 30%, excess carried forward |
| `timeline` | `{ year, path, value, note? }` | applied cumulatively before each year is computed; growth assumptions still compound from the plan start |
| `scenarios`, `activeScenario` | named lists of decisions: `{ events: [...] }` | an event has an id, a kind (`exercise`, `sell`, `liquidity`), a year, an optional date, and its own fields: shares, option type and company for an exercise (the engine draws only from that company's grants); shares, an optional price and optional lot picks for a sale; an optional company and price for a liquidity event, which settles double-trigger RSUs that year and pins the share price. The engine collapses events into a per-year lever table. Files that stored the table directly are read and mapped |
| `sources` | provenance keyed by path; grants and holdings by id (`grants.g1`), companies by id | a string, or `{ doc, asOf, note }` |

## Identity

Grants, holdings and companies carry ids (`g1`, `h1`, `c1`) assigned on creation or migration.
Sources key on ids, so reordering or renaming never orphans anything. Events carry ids too
(`e1`), so the app can select and move them. Names are labels.

## The field registry

`packages/engine/src/fields.ts` lists every scalar the profile stores and the intake asks for:
profile path, intake path, label, type, section, and the form and line it comes from. The
intake prompt template, the intake parser, the review table, the unknown-path mapping and the
timeline's + menu all read from it, so a new scalar costs a registry entry, a key in the
`Intake*` type, and an input in the information dialog. Structured things (grants, holdings,
the mortgage, a return's shape) and the few special scalars (dependents as birth years, the
share price as a bare number) are hand-written in the parser and in `intake/apply.ts`.

## How a year is computed

1. `profileInYear(profile, year)` applies timeline entries dated that year or earlier.
2. `yearInputs` resolves growth, vesting, the active scenario's exercises, and the mortgage
   year, and takes the carryforwards from the previous year.
3. Shares acquired that year (exercises on their event date, January 1 by default; RSU
   settlements on January 1) join the lots held. Sales dated that year (December 31 by default)
   consume lots, lowest tax first unless the event names lots: qualifying ISO and long-term lots
   with the highest basis go first. Each lot sold yields long- or short-term gain, ordinary
   income for a disqualifying ISO disposition, and a negative AMT adjustment for ISO shares.
4. `computeFederal` writes every intermediate to the ledger with a reason; the state module
   adds its line; totals follow.
5. Carryforwards out become carryforwards in for the next year; lots left over carry too.

## What the schema does not yet hold

- ESPP, 83(b) and early-exercise flags, QSBS.
- Estimated payments and a cash view built on withholding.
- States beyond Washington, California, Texas, Florida and Nevada (the California model is approximate: no credits, indexed exemptions).
- Retirement levers (Roth conversions, contribution changes) beyond pre-tax contributions.

Each is additive: a new section or a new lever type in `scenarios`, plus registry entries.
