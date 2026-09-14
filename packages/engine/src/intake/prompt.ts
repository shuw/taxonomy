import { stringifyProfile } from "../profile.ts";
import type { Profile } from "../types.ts";
import type { IntakeSection } from "./apply.ts";

export interface SectionInfo {
  id: IntakeSection;
  title: string;
  what: string;
  documents: string;
}

export const INTAKE_SECTIONS: SectionInfo[] = [
  { id: "basics", title: "Basics and pay", what: "Filing status, state, dependents, base salary and bonus per earner, pre-tax contributions, withholding so far.", documents: "last return's header, a recent pay stub or offer letter, W-2 box 12" },
  { id: "prior_return", title: "Last filed return", what: "The figures the model must reproduce, plus the carryforwards that enter this year: AMT credit, capital losses, unused charitable gifts.", documents: "Form 1040, Form 6251, Form 8801, Schedule D, Schedule A" },
  { id: "income", title: "Investment and other income", what: "Interest, dividends (total and qualified), gains realized so far, K-1 or side income.", documents: "1099-INT, 1099-DIV, 1099-B or brokerage year-to-date" },
  { id: "equity", title: "Equity", what: "Every grant with its type, strike, vesting and how much is vested, exercised and unexercised; the current share value; shares already owned with cost and AMT basis.", documents: "Shareworks, Carta, E*Trade, Schwab or Fidelity grant pages; the latest 409A notice; Form 3921 for ISO exercises" },
  { id: "home", title: "Home and deductions", what: "The mortgage as a loan, property tax, state income tax, charitable giving by kind, medical.", documents: "Form 1098, county tax bill, donation receipts" },
  { id: "assumptions", title: "Assumptions", what: "Growth rates you already use elsewhere. Skip if none.", documents: "none; these are yours" },
];

const TEMPLATES: Record<IntakeSection, string> = {
  basics: `basics:
  filingStatus: mfj            # single | mfj | mfs | hoh
  state: WA                    # two-letter code
  dependents: 0
  planStartYear: 2026          # first year on screen; usually the current year
people:
  self:
    name: ""
    baseSalary: 0              # annual base pay only; RSU vests and option exercises are added by the tool
    expectedBonus: 0
    pretaxContributions: 0     # 401(k), HSA and similar for the year
    withholdingToDate: 0       # federal income tax withheld so far this year
  spouse:                      # omit entirely if none
    name: ""
    baseSalary: 0
    expectedBonus: 0
    pretaxContributions: 0
    withholdingToDate: 0`,
  prior_return: `prior_return:
  year: 2025
  filingStatus: mfj
  agi: 0                       # 1040 line 11
  taxableIncome: 0             # 1040 line 15
  regularTax: 0                # 1040 line 16
  totalTax: 0                  # 1040 line 24
  niit: 0                      # Form 8960 line 17, if any
  amt:                         # Form 6251; omit if no AMT form was filed
    amti: 0                    # line 4
    exemption: 0               # line 5
    tentativeMinimumTax: 0     # line 9
    amt: 0                     # line 11
    creditUsed: 0              # Form 8801 line 25 (credit used that year)
  amtCreditCarryforward: 0     # Form 8801 line 26: credit available for the next year
  capitalLossCarryforward:     # Schedule D carryover worksheet
    shortTerm: 0
    longTerm: 0
  charitableCarryforward: 0    # gifts not yet deducted because of AGI limits
  itemized:                    # Schedule A, if itemized
    salt: 0                    # line 5e
    mortgageInterest: 0        # line 8a
    charitable: 0              # line 14
    other: 0
  inputs:                      # what went into that return, so the tool can recompute it
    wages: 0                   # 1040 line 1a
    interest: 0                # line 2b
    ordinaryDividends: 0       # line 3b
    qualifiedDividends: 0      # line 3a
    shortTermGains: 0          # Schedule D line 7
    longTermGains: 0           # Schedule D line 15
    otherIncome: 0             # Schedule 1 total
    isoBargainElement: 0       # Form 6251 line 2i
    amtCreditCarriedIn: 0      # Form 8801 line 1 (credit available at the start of that year)`,
  income: `income:
  interest: 0                  # 1099-INT box 1, expected for the year
  dividends:
    ordinary: 0                # 1099-DIV box 1a (total)
    qualified: 0               # 1099-DIV box 1b
  realizedGains:
    shortTerm: 0               # year to date
    longTerm: 0
  other: 0                     # K-1, rental, side income`,
  equity: `equity:
  company: ""
  sharePrice: { value: 0, asOf: 2026-01-01, basis: 409A }   # per share; 409A for private companies, market price otherwise
  grants:
    - name: ""                 # short label, e.g. "2023 ISO grant"
      type: iso                # iso | nso | rsu   (NQSO means nso)
      owner: self              # self | spouse
      grantDate: 2023-02-01
      granted: 0               # shares or units originally granted
      strike: 0                # per share; omit for RSUs
      vesting:                 # a schedule...
        start: 2023-02-01
        years: 4
        cliffMonths: 12
        cadence: monthly       # monthly | quarterly | annual
      # ...or explicit vest events when the portal shows a table:
      # vesting:
      #   - { date: 2026-03-15, shares: 500 }
      vested: 0                # vested to date
      exercised: 0             # options only
      unexercised: 0           # options only: vested-unexercised + unvested
      expires: 2033-02-01
  holdings:                    # shares already owned, one lot per acquisition
    - lot: ""
      owner: self
      quantity: 0
      acquired: 2025-04-10
      via: iso_exercise        # iso_exercise | nso_exercise | rsu_vest | espp | purchase | other
      costBasis: 0             # per share, regular basis
      amtBasis: 0              # per share, FMV at exercise for ISO shares (Form 3921 box 4)`,
  home: `home:
  mortgage:                    # omit if none
    balance: 0                 # outstanding principal now (Form 1098 box 2 is the balance at Jan 1)
    rate: 0.0575               # annual, as a fraction
    originated: 2022-08-01     # Form 1098 box 3
    originalAmount: 0
    termYears: 30
  propertyTax: 0               # Form 1098 box 10 or the county bill
deductions:
  stateIncomeTax: 0            # 0 in states without one
  charitable:
    cash: 0                    # expected for the year
    appreciatedStock: 0        # fair market value of securities given
    daf: 0                     # donor-advised fund contributions
  medical: 0`,
  assumptions: `assumptions:
  fmvGrowth: 0.15              # annual share value growth, as a fraction
  wageGrowth: 0.03
  inflation: 0.025`,
};

export interface PromptOptions {
  sections: IntakeSection[];
  /** When present, the agent sees the current values and reports the full current state (the app diffs). */
  profile?: Profile;
  /** Ask only about these paths (a follow-up for gaps). */
  onlyPaths?: string[];
}

/** The request the user hands to their agent. Agent-agnostic: instructions, the schema for the chosen sections, the current profile, and the output rules. */
export function intakePrompt(opts: PromptOptions): string {
  const sections = INTAKE_SECTIONS.filter((s) => opts.sections.includes(s.id));
  const parts: string[] = [];
  parts.push(`# Taxonomy intake request

I use Taxonomy, a personal tax-planning tool. It needs a structured snapshot of my situation, assembled from my documents. Please gather the data below and return ONE YAML document in the exact shape shown. Read carefully: the tool validates the result and shows me every number with its source before anything is saved.

## What to gather

${sections.map((s) => `- **${s.title}**: ${s.what}\n  Documents: ${s.documents}.`).join("\n")}

## Rules

1. Copy numbers from documents. Never estimate or fill from general knowledge. If a value is not in anything you can read, leave the key out and list its path under \`unknown\`.
2. For every number you do report, add a \`sources\` entry keyed by its path naming the document and the line, box or page, e.g. \`prior_return.agi: "2025 Form 1040 line 11 (2025-return.pdf)"\`.
3. Prefer the filed return over a portal, the portal over a pay stub, and a pay stub over memory. When two documents disagree, report the more authoritative one and mention the other in \`questions\`.
4. Money in whole dollars; prices per share; dates as YYYY-MM-DD; rates as fractions (0.0575, not 5.75%).
5. Base salary means base pay only. Do not add RSU vests or option exercises to it; the tool adds those from the grants.
6. For options, report granted, vested, exercised and unexercised as separate counts as the portal shows them. NQSO and NSO are the same type: use \`nso\`.
7. Put any question for me in \`questions\`, not in prose. Return only the YAML document, inside one \`\`\`yaml fence, and nothing else.${opts.onlyPaths?.length ? `\n8. This is a follow-up. Only report these paths: ${opts.onlyPaths.join(", ")}. Leave everything else out.` : ""}

## Document shape

Use exactly these keys. Omit any key you cannot fill; do not write 0 for unknown.

\`\`\`yaml
taxonomy_intake: 1
as_of: ${new Date().toISOString().slice(0, 10)}
${sections.map((s) => TEMPLATES[s.id]).join("\n")}
sources:
  prior_return.agi: "2025 Form 1040 line 11 (file name)"
unknown:
  - people.self.expectedBonus
questions:
  - ""
\`\`\``);

  if (opts.profile) {
    parts.push(`## What the tool has now

Below is my current profile. Report the full current state for the sections above (not a diff); the tool will show me what changed. Values here that no document contradicts can be repeated as-is, with their source if you know it, or left out.

\`\`\`yaml
${stringifyProfile(opts.profile).replace(/^# .*\n/gm, "").trim()}
\`\`\``);
  }

  return parts.join("\n\n");
}
