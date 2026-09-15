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
| `equity.holdings` | lots owned: id, quantity, acquisition date, how acquired, cost basis, AMT basis | for the sales lever; not in the tax math yet |
| `home` | the mortgage as a loan (balance, rate, origination, original amount, term), property tax, or a direct interest figure when there is no loan | interest is amortized month by month; the $750k acquisition-debt cap applies by average balance |
| `deductions` | charitable by kind (cash, appreciated stock, DAF), state income tax, medical | cash and DAF up to 60% of AGI, stock up to 30%, excess carried forward |
| `timeline` | `{ year, path, value, note? }` | applied cumulatively before each year is computed; growth assumptions still compound from the plan start |
| `scenarios`, `activeScenario` | named lever settings | exercises per year by grant type today; every future lever lands here |
| `sources` | provenance keyed by path; grants and holdings by id (`grants.g1`), companies by id | a string, or `{ doc, asOf, note }` |

## Identity

Grants, holdings and companies carry ids (`g1`, `h1`, `c1`) assigned on creation or migration.
Sources and levers key on ids, so reordering or renaming never orphans anything. Names are
labels.

## The field registry

`packages/engine/src/fields.ts` lists every scalar the profile stores and the intake asks for:
profile path, intake path, label, type, section, and the form and line it comes from. The
intake prompt, the review table, the unknown-path mapping, the assistant's tool description,
and the timeline's field picker all read from it. Adding a scalar means adding one entry.
Structured things (grants, holdings, the mortgage, a return) have hand-written templates and
review rows.

## How a year is computed

1. `profileInYear(profile, year)` applies timeline entries dated that year or earlier.
2. `yearInputs` resolves growth, vesting, the active scenario's exercises, and the mortgage
   year, and takes the carryforwards from the previous year.
3. `computeFederal` writes every intermediate to the ledger with a reason; the state module
   adds its line; totals follow.
4. Carryforwards out become carryforwards in for the next year.

## What the schema does not yet hold

- Sales of shares (the holdings exist for it), ESPP, 83(b) and early-exercise flags, QSBS.
- Estimated payments and a cash view built on withholding.
- Per-state parameters beyond Washington.
- Retirement levers (Roth conversions, contribution changes) beyond pre-tax contributions.

Each is additive: a new section or a new lever type in `scenarios`, plus registry entries.
