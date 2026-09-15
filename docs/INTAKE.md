# Intake by prompt

Taxonomy's intake is a document, not a form. The app writes a precise request for the data it
needs; you hand that request to whatever agent already has your documents and connectors; the
agent returns a single structured document; the app validates it, shows you exactly what would
change and where each number came from, and you accept it line by line.

## Why this shape

- **The agent you already trust has the access.** Gmail, Drive, a folder of PDFs, a Shareworks
  export: your agent can read them today. Taxonomy never needs credentials, never sees your
  inbox, and never ships screenshots anywhere.
- **Tax documents are the ground truth.** Portals and pay stubs are approximations; the
  return you filed is the real answer for last year. Form 8801 *is* the AMT credit carryforward.
  Form 3921 *is* the ISO exercise record with the FMV the IRS was told. Reading these once
  beats re-typing them from memory.
- **Structured data is checkable.** A pasted document can be validated against a schema,
  diffed against the current profile, and carry a source for every number. A chat cannot.
- **Calibration.** If the intake includes last year's return, the engine can recompute that
  year and show how close it gets. That is the moment the tool earns trust, and it also
  surfaces which simplifications matter for you specifically.

## What we ask for

The intake document is organized by *where the number lives*, because that is how the agent
will find it. Each section says what it is for and which document carries it. Everything is
optional; unknowns are reported, not guessed.

### 1. Basics

| Field | Why the engine needs it | Where it comes from |
|---|---|---|
| filing status, state, dependents | brackets, exemptions, credits later | last return (1040 header), you |
| a planned move or status change and its year | multi-year plan | you |
| plan start year and horizon | the strip of years | defaults: this year, 6 years |

### 2. Last filed return (baseline and carryforwards)

| Field | Why | Source |
|---|---|---|
| AGI, taxable income, total tax, regular tax | calibration target | 1040 lines 11, 15, 16, 24 |
| AMTI, exemption, tentative minimum tax, AMT | calibration of the AMT model | Form 6251 lines 4, 5, 7, 11 |
| minimum tax credit carryforward | `equity.amtCreditCarryforward`, exactly | Form 8801 line 26 (carry to next year) |
| capital loss carryforward (ST and LT) | future gains lever | Schedule D worksheet, or 1040 Sch D lines 6 and 14 |
| itemized amounts if itemized | deductions baseline | Schedule A lines 5, 8, 11-14 |
| charitable contribution carryforward | charitable lever | Schedule A worksheet / prior 8283 |
| state return summary where relevant | state model | state return; for WA, the capital gains excise return if filed |

### 3. Income, this year and expected

| Field | Why | Source |
|---|---|---|
| base salary, and the bonus you expect | wages | offer letter, pay stub, or you |
| equity income already inside W-2 Box 1 last year (RSU vests, NSO exercises) | avoid double counting: the engine adds RSU vests itself, so wages must be *base* pay | W-2 Box 12 code V, pay stub "supplemental" lines |
| pre-tax 401(k), HSA, other pre-tax deductions | they reduce Box 1 | pay stub, W-2 Box 12 codes D, W |
| interest, dividends (ordinary and qualified) | NIIT, preferential income | 1099-INT, 1099-DIV boxes 1a and 1b |
| realized gains so far, short and long | gains lever baseline | 1099-B, brokerage YTD |
| other income (K-1, rental, side income) | ordinary income | you |
| withholding to date and estimated payments | cash-flow view, safe harbor (later) | pay stub YTD federal withholding, 1040-ES receipts |

### 4. Equity

Per grant, from Shareworks, Carta, E*Trade, Schwab, Fidelity, or the grant notice:

| Field | Why | Notes |
|---|---|---|
| name, company, type (iso, nso, rsu, espp) | tax treatment | NQSO and NSO are the same |
| grant date, total granted | history | |
| vesting: start, length, cliff, cadence, or explicit dates and counts | per-year vests and what is exercisable | required whenever shares are unvested; counts alone leave the future empty |
| single- or double-trigger (RSUs) | when units become income | double-trigger units settle at the company's liquidity event, a year you set in the app |
| strike (options) | spread | per share |
| vested, exercised, and unexercised counts today | what the sliders may move | for options: unexercised = shares still available |
| expiration date | later: forced exercise | |

Company-level:

| Field | Why | Source |
|---|---|---|
| current share value (409A or market) and its date | spread and RSU income | latest 409A notice, portal, or public price |
| expected liquidity event and price, if any | sales lever later | you |

Holdings, for the sales lever that comes next:

| Field | Why | Source |
|---|---|---|
| lots of shares already owned: quantity, acquisition date, how acquired (ISO exercise, NSO exercise, RSU vest, ESPP, purchase) | holding periods, qualifying vs disqualifying dispositions | portal holdings page, 1099-B supplemental |
| regular cost basis and AMT basis per lot | dual-basis gain on ISO shares | Form 3921 (exercise price, FMV at exercise), 1099-B |
| ISO exercises during the current year | AMT preference already incurred | Form 3921 for the year |

### 5. Home and deductions

| Field | Why | Source |
|---|---|---|
| mortgage balance, rate, origination date, original loan amount | interest deduction with the $750k acquisition-debt cap; the mortgage lever | Form 1098 boxes 1-3, loan statement |
| property tax | SALT cap | Form 1098 box 10 or county bill |
| charitable giving: cash, appreciated stock, DAF; planned amounts | charitable lever, AGI limits | receipts, you |
| state income tax paid, if any | SALT | state return |
| medical, other itemized | rarely matters, kept for completeness | Schedule A |

### 6. Assumptions

Share value growth, wage growth, inflation for indexing, a future tax-rate assumption.
These are yours, not a document's; the intake asks for them only so the agent can carry over
what you have said elsewhere.

## The intake document

One YAML document, versioned, human-readable, with a source on every number the agent found.
Values are plain; provenance sits beside them so the file stays easy to edit by hand.

```yaml
taxonomy_intake: 1
as_of: 2026-09-14
basics:
  filingStatus: mfj
  state: WA
  dependents: 0
  changes: []                 # e.g. [{ year: 2027, filingStatus: mfj }]
prior_return:
  year: 2025
  agi: 402113
  taxableIncome: 369913
  totalTax: 87201
  amt: { amti: 471300, exemption: 126500, tentativeMinimumTax: 89648, amt: 2447 }
  amtCreditCarryforward: 18960
  capitalLossCarryforward: { shortTerm: 0, longTerm: 3200 }
  itemized: { salt: 10000, mortgageInterest: 24100, charitable: 5000 }
income:
  baseSalary: 620000
  expectedBonus: 60000
  pretaxContributions: 23500
  interest: 6100
  dividends: { ordinary: 4200, qualified: 3900 }
  realizedGains: { shortTerm: 0, longTerm: 0 }
  withholdingToDate: 141000
equity:
  company: Example Inc.
  sharePrice: { value: 21.00, asOf: 2026-06-30, basis: 409A }
  grants:
    - name: 2023 ISO grant
      type: iso
      grantDate: 2023-02-01
      granted: 60000
      strike: 2.00
      vesting: { start: 2023-02-01, years: 4, cliffMonths: 12, cadence: monthly }
      vested: 52500
      exercised: 12500
      unexercised: 47500
      expires: 2033-02-01
    - name: 2025 RSU refresh
      type: rsu
      grantDate: 2025-03-15
      granted: 8000
      vesting: { start: 2025-03-15, years: 4, cliffMonths: 12, cadence: quarterly }
      vested: 3500
  holdings:
    - lot: ISO exercise 2025-04-10
      quantity: 12500
      acquired: 2025-04-10
      via: iso_exercise
      costBasis: 2.00
      amtBasis: 16.50           # FMV at exercise, from Form 3921
  isoExercisesThisYear: []
home:
  mortgage: { balance: 812000, rate: 0.0575, originated: 2022-08-01, originalAmount: 900000 }
  propertyTax: 11800
  charitable: { cash: 5000, appreciatedStock: 0, daf: 0 }
assumptions:
  fmvGrowth: 0.15
  wageGrowth: 0.03
  inflation: 0.025
sources:
  prior_return.agi: "2025 Form 1040 line 11 (2025 return.pdf)"
  prior_return.amtCreditCarryforward: "2025 Form 8801 line 26"
  income.baseSalary: "pay stub 2026-08-31, annualized base"
  equity.grants[0].vested: "Shareworks grant detail, 2026-09-10"
  equity.holdings[0].amtBasis: "Form 3921 for 2025, box 4"
unknown:
  - income.expectedBonus
  - equity.grants[1].vested
questions:
  - "Shareworks shows 12,500 ISO shares exercised in 2025 but no Form 3921 was found. Was the FMV at exercise $16.50?"
```

Only filing status, state and the first plan year are asked in the app (a three-field form at
the top of the new-profile dialog). Pay and household (salary, bonus, pre-tax contributions,
withholding, dependents) come from pay stubs, W-2s and the return header, so they are a
document section like the rest. The request defaults to the five document-backed sections and
tells the agent not to re-ask filing status and state.

On the agent's side the request reads as a working agreement, not a spec: search connected
drives and mail for named documents first, report what was found and list what is still
needed in one message (with the form and line, or the document to upload, per item), accept
one-word shortcut answers ("no AMT", "never exercised", "rent"), and finish with a two-line
summary above a single YAML block. The tool accepts the whole reply pasted, not just the
block. What the profile already holds is sent as a compact summary of the requested sections,
never the raw file.

The request is two-phase. The agent first reads what it can, then asks the user, in one
batched message, for anything *required* it could not find: naming the form and line, the
portal page, or the number to type, and suggesting which document to upload. Only when every
required item is resolved (or the user says they cannot provide it) does it produce the
document. Required items come from the field registry (`required: true`) plus the structured
essentials (a grant's counts and strike, a mortgage's balance, rate and origination). Optional
items are simply left out and listed under `unknown`; `questions` holds only what stayed open.

Rules the agent is given:

- Copy numbers from documents; never estimate. Anything not found goes in `unknown`.
- Every found number gets a `sources` entry naming the document and the line, box, or page.
- Prefer the filed return over portals, the portal over pay stubs, pay stubs over memory.
- Money is dollars, prices are per share, dates are `YYYY-MM-DD`, percentages are fractions.
- Return exactly one fenced YAML block and nothing else; questions go in `questions`.
- When a current profile is included in the request, report values as they are now, not as
  a diff; the app computes the diff.

## Mapping to the profile

The intake is not the profile. The app derives the profile from it, which is where the tax
knowledge lives:

- `equity.amtCreditCarryforward` comes from Form 8801, or from `prior_return.amt` if 8801 is
  missing (the credit generated equals AMT from deferral items; the app flags the assumption).
- `income.wages` becomes base salary plus expected bonus, minus nothing: pre-tax contributions
  are kept as their own line so the engine can subtract them and show why.
- Grant `shares` in the profile means unexercised shares; `vested` in the profile means vested
  and unexercised. Both are computed from the intake's granted/vested/exercised triple, and the
  triple is preserved so nothing is lost.
- Holdings become lots with regular and AMT basis, ready for the sales lever.
- Mortgage balance, rate and origination become inputs; interest is computed, and the $750k
  acquisition-debt cap applies from the original loan amount and date.
- `sources` is kept as a `sources:` block in the profile file, and the Explain panel shows it
  for input lines ("Wages: from pay stub 2026-08-31").

This means the profile schema grows: pre-tax contributions, capital loss carryforward,
holdings, mortgage as a loan, charitable by kind, prior-return figures for calibration. Each
of those is also a lever we planned anyway.

## UX

One modal, three panels that read left to right, opened from a "Fill from documents" button
in the top bar and in the empty state of any sidebar section.

**1. What to gather, and the request.** One screen: a checklist of the six sections on the
left, the generated request on the right, updating as sections are toggled. A checklist of the six sections above, each with a one-line description
and the documents it needs, with the ones that matter most for this profile pre-selected
(everything on first run; only the gaps on a re-run). A short note under the list: "Have these
handy or give your agent access: last year's return (1040, 6251, 8801), W-2 and 1099s, a
Shareworks or Carta grant export, Form 3921 if you exercised ISOs, Form 1098."

The request is the generated prompt in a read-only box: the instructions, the schema for
the selected sections with field descriptions, the current profile (so re-runs come back
complete), and the rules above. Buttons: Copy, Download as `.md` (for agents that take files),
and a smaller "Copy schema only" for people who want to write the YAML themselves. The prompt
is around two thousand words for the full set; each section can be copied on its own if the
user wants to gather piecemeal.

**2. The result.** A paste box that validates as you paste: a green check with a count of
fields found, or the specific problems (with the offending line quoted) if the document does
not parse. Below it, the review table, grouped by section:

| field | now | proposed | source | |
|---|---|---|---|---|
| Wages | $620,000 | $680,000 | pay stub 2026-08-31 + expected bonus (you) | accept ☑ |
| AMT credit carryforward | $0 | $18,960 | 2025 Form 8801 line 26 | accept ☑ |
| 2023 ISO grant · vested | 40,000 | 47,500 unexercised | Shareworks 2026-09-10 | accept ☑ |
| Expected bonus | | unknown | | ask me |

Rows are new, changed, unchanged (collapsed by default), or unknown. Unknown rows offer an
inline field so you can type the number yourself. Questions from the agent appear above the
table. "Apply selected" writes the accepted rows through the normal edit path; "Ask again for
the gaps" regenerates a smaller prompt for just the unknowns.

**After applying.** If the intake carried a prior-year return, a calibration card appears in
the main column: "Your 2025 return: total tax $87,201. Taxonomy recomputes $86,940 (−0.3%).
AMT within $120." Each line links to the ledger for that year so you can see where the model
diverges; large gaps name the simplification responsible when the engine can tell (for
example, a 25% gain rate it does not model).

**Provenance everywhere.** Input lines in the ledger and sidebar fields show a small source
chip when one exists. Hover reads the full source string. This is what makes a number on the
screen trustworthy six months later.

## Status

Built as of 2026-09-14 (schema version 3; see DATA-MODEL.md): the schema and parser (`intake/schema.ts`), the prompt
(`intake/prompt.ts`), the review and apply mapping (`intake/apply.ts`), the modal, source chips,
and the calibration card. The profile schema is at version 2 with people, carryforwards, prior
return, holdings, mortgage-as-loan and charitable by kind. Not yet: the sales lever that
holdings exist for, ESPP, withholding-based cash view, and a "future" section (deliberately: the
future is what the levers are for).

## Build plan

1. **Schema and mapping in the engine.** `intake/schema.ts` (types, validation with clear
   messages), `intake/prompt.ts` (prompt generation by section, with the current profile),
   `intake/apply.ts` (intake to profile edits, with the derivations above). Pure, tested with
   fixture documents, including deliberately messy ones.
2. **Profile schema growth.** Pre-tax contributions, capital loss carryforward, holdings, the
   mortgage as a loan, charitable by kind, `sources`, `priorReturn`. Engine lines for each.
3. **The modal.** Checklist, prompt, paste and review, apply. Source chips in the sidebar and
   ledger.
4. **Calibration.** Parameters for the prior year (2025), a `calibrate(profile)` that
   recomputes it and diffs against the return, and the card.
5. (The built-in screenshot assistant was removed once this landed; one intake path.)

Step 1 and 2 are the substance; 3 is a day; 4 is what makes it convincing.
