import { exampleValue, FIELDS, requiredFields, type FieldDef } from "../fields.ts";
import { stringifyProfile } from "../profile.ts";
import type { Profile } from "../types.ts";
import type { IntakeSection } from "./apply.ts";

export interface SectionInfo {
  id: IntakeSection;
  title: string;
  what: string;
  documents: string;
  /** Things to look for in connected drives and mail. */
  search: string;
  /** Answers the user can give in one word that resolve a required item. */
  shortcuts?: string[];
}

export const INTAKE_SECTIONS: SectionInfo[] = [
  { id: "basics", title: "Filing basics", what: "Filing status, state and first plan year. Answered in the app; only ask for these if you want them read off the last return.", documents: "last return's header", search: "the last return's first page" },
  { id: "pay", title: "Pay and household", what: "Base salary, expected bonus, pre-tax contributions and withholding so far, per earner; dependents claimed.", documents: "latest pay stub, offer letter, W-2 box 12, the last return's header", search: "pay stub, \"earnings statement\", offer letter, W-2, the last return's first page", shortcuts: ["\"no bonus\" sets expectedBonus to 0", "\"no 401k\" sets pretaxContributions to 0"] },
  { id: "prior_return", title: "Last filed return", what: "The figures the model must reproduce, plus the carryforwards that enter this year: AMT credit, capital losses, unused charitable gifts.", documents: "Form 1040, Form 6251, Form 8801, Schedule D, Schedule A", search: "\"Form 1040\" and the tax year, \"tax return\", TurboTax or accountant PDFs, \"Form 8801\", \"Form 6251\"", shortcuts: ["\"no AMT\" means no Form 6251 or 8801 was filed: the AMT block is omitted and the credit carryforward is 0", "\"standard deduction\" means no Schedule A: itemized is omitted", "\"no capital losses\" sets both carryforwards to 0"] },
  { id: "income", title: "Investment and other income", what: "Interest, dividends (total and qualified), gains realized so far, K-1 or side income.", documents: "1099-INT, 1099-DIV, 1099-B or brokerage year-to-date", search: "1099-INT, 1099-DIV, 1099-B, \"consolidated 1099\", brokerage statements" },
  { id: "equity", title: "Equity", what: "Every grant with its type, strike, vesting and how much is vested, exercised and unexercised; the current share value; shares already owned with cost and AMT basis.", documents: "Shareworks, Carta, E*Trade, Schwab or Fidelity grant pages; the latest 409A notice; Form 3921 for ISO exercises", search: "Shareworks, Carta, E*Trade, \"stock option agreement\", \"grant notice\", 409A, \"Form 3921\", \"exercise confirmation\"", shortcuts: ["\"never exercised\" sets exercised to 0 for every option grant", "\"nothing owned\" means holdings is an empty list"] },
  { id: "home", title: "Home and deductions", what: "The mortgage as a loan, property tax, state income tax, charitable giving by kind, medical.", documents: "Form 1098, county tax bill, donation receipts", search: "\"Form 1098\", mortgage statement, property tax bill, donation receipts", shortcuts: ["\"no mortgage\" omits the mortgage block", "\"rent\" omits home entirely"] },
  { id: "assumptions", title: "Assumptions", what: "Growth rates you already use elsewhere. Skip if none.", documents: "none; these are yours", search: "nothing; ask me" },
];

/** Render the scalar fields of a section as a YAML tree with a comment per line, from the registry. */
function scalarTemplate(section: IntakeSection): string {
  type Node = { children: Map<string, Node>; field?: FieldDef };
  const root: Node = { children: new Map() };
  for (const f of FIELDS.filter((f) => f.section === section && f.intake)) {
    let node = root;
    for (const seg of f.intake!.split(".")) {
      if (!node.children.has(seg)) node.children.set(seg, { children: new Map() });
      node = node.children.get(seg)!;
    }
    node.field = f;
  }
  const lines: string[] = [];
  const walk = (node: Node, indent: number) => {
    for (const [key, child] of node.children) {
      const pad = "  ".repeat(indent);
      if (child.field) {
        const text = `${pad}${key}: ${exampleValue(child.field)}`;
        lines.push(child.field.hint ? `${text.padEnd(32)} # ${child.field.hint}` : text);
      } else {
        lines.push(`${pad}${key}:`);
        walk(child, indent + 1);
      }
    }
  };
  walk(root, 0);
  return lines.join("\n");
}

const STRUCTURED: Partial<Record<IntakeSection, string>> = {
  equity: `  grants:
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
      vested: 0                # vested to date, including anything since exercised
      exercised: 0             # options only, to date
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
};

const REQUIRED_STRUCTURED: Partial<Record<IntakeSection, string[]>> = {
  equity: ["every grant: name, type, granted, strike (options), and either a vesting schedule or vested/exercised/unexercised counts", "for shares already owned: quantity, acquisition date, cost basis (and AMT basis for ISO shares, from Form 3921)"],
  home: ["if there is a mortgage: balance, rate and origination date"],
};

function requiredList(section: IntakeSection): string[] {
  return [...requiredFields(section).map((f) => `${f.intake ?? f.path}${f.hint ? ` (${f.hint})` : ""}`), ...(REQUIRED_STRUCTURED[section] ?? [])];
}

function template(section: IntakeSection): string {
  const scalars = scalarTemplate(section);
  const extra = STRUCTURED[section];
  return extra ? `${scalars}\n${extra}` : scalars;
}

/** Sections whose answers live in documents rather than in the user's head; the request asks for these by default. */
export const DOCUMENT_SECTIONS: IntakeSection[] = ["pay", "prior_return", "income", "equity", "home"];

export interface PromptOptions {
  sections: IntakeSection[];
  /** When present, the agent sees the current values and reports the full current state (the app diffs). */
  profile?: Profile;
  /** Ask only about these paths (a follow-up for gaps). */
  onlyPaths?: string[];
}

/** The request the user hands to their agent. Agent-agnostic: instructions, the schema for the chosen sections, the current profile, and the output rules. */
/** The values the profile already holds for the requested sections, as a short YAML the agent can read at a glance. */
export function knownFacts(profile: Profile, sections: IntakeSection[]): string {
  const facts: Record<string, unknown> = {
    filer: { filingStatus: profile.filer.filingStatus, state: profile.filer.state, spouse: profile.people.spouse ? "yes" : "no" },
    planStartYear: profile.plan.startYear,
  };
  if (sections.includes("pay")) facts.pay = { dependents: (profile.filer.dependents ?? []).length, people: { self: { salary: profile.people.self.salary, bonus: profile.people.self.bonus }, spouse: profile.people.spouse ? { salary: profile.people.spouse.salary } : undefined } };
  if (sections.includes("prior_return")) {
    const r = [...(profile.returns ?? [])].sort((a, b) => b.year - a.year)[0];
    facts.carryforwards = profile.carryforwards;
    if (r) facts.lastReturnOnFile = { year: r.year, agi: r.reported.agi, totalTax: r.reported.totalTax };
  }
  if (sections.includes("income")) facts.income = profile.income;
  if (sections.includes("equity")) facts.equity = {
    companies: profile.equity.companies.map((c) => ({ name: c.name, sharePrice: c.sharePrice, asOf: c.sharePriceAsOf })),
    grants: profile.equity.grants.map((g) => ({ name: g.name, type: g.type, granted: g.granted, vestedToDate: g.vestedToDate, exercisedToDate: g.exercisedToDate, strike: g.strike })),
    holdings: (profile.equity.holdings ?? []).length,
  };
  if (sections.includes("home")) facts.home = { mortgage: profile.home?.mortgage, propertyTax: profile.home?.propertyTax, charitable: profile.deductions?.charitable };
  if (sections.includes("assumptions")) facts.assumptions = profile.assumptions;
  return stringifyProfile(facts as unknown as Profile).replace(/^#.*\n/gm, "").trim();
}

/** The request the user hands to their agent. Agent-agnostic: a working agreement first, the schema last. */
export function intakePrompt(opts: PromptOptions): string {
  const sections = INTAKE_SECTIONS.filter((s) => opts.sections.includes(s.id));
  const required = sections.map((s) => ({ s, items: requiredList(s.id) })).filter((x) => x.items.length);
  const shortcuts = sections.flatMap((s) => s.shortcuts ?? []);
  const parts: string[] = [];
  parts.push(`Help me set up Taxonomy, a personal tax-planning tool. It needs numbers from my documents. Read this whole message first.

## How we'll work

1. **Look.** Search what you can reach (Drive, mail, my uploads, this chat) for: ${sections.map((s) => s.search).join("; ")}.
2. **Report back, briefly.** What you found in a few lines, then a numbered list of what's missing. For each: the form and line, the portal page, or the number I should type. Suggest a document when that's faster than a question. Never guess a required item.${shortcuts.length ? `\n   One-word answers you should accept: ${shortcuts.map((x) => x.replace(/^"/, "").replace(/" means/, " means").replace(/" sets/, " sets").replace(/" omits/, " omits")).join("; ")}.` : ""}
3. **Repeat** until nothing required is missing, or I say I can't provide it.
4. **Finish** with a two-line summary and the YAML in one \`\`\`yaml block, nothing after it. The tool shows me each number with its source before saving.

## What I need${opts.profile ? " (skip what the tool already has, listed at the bottom)" : ""}

${sections.map((s) => `- **${s.title}**: ${s.what}\n  Documents: ${s.documents}.`).join("\n")}

Required before you finish:

${required.map(({ s, items }) => `**${s.title}**\n${items.map((i) => `- ${i}`).join("\n")}`).join("\n\n")}

Everything else is optional: fill it when a document shows it, leave it out otherwise.

## Rules

- Copy from documents or my answers. Never estimate.
- Every number gets a \`sources\` entry: its path, then the document and line, box or page, or "answered by user". Example: \`prior_return.agi: "2025 Form 1040 line 11 (2025-return.pdf)"\`.
- Filed return beats portal beats pay stub beats memory. If sources disagree, ask me; if I can't settle it, use the stronger source and note the other in \`questions\`.
- Whole dollars. Prices per share. Dates YYYY-MM-DD. Rates as fractions (0.0575).
- Base salary is base pay only; the tool adds RSU and option income from the grants.
- Options: granted, vested, exercised and unexercised as separate counts, as the portal shows them. NQSO is \`nso\`. No spouse, no \`spouse\` block.
- Optional items you couldn't find go under \`unknown\`.
- \`questions\` is for judgment calls I should double-check later: a derived value, disagreeing sources, something hinted but not shown. One sentence each, with \`about\` (the path) and \`proposed\` (the value you used).${opts.onlyPaths?.length ? `\n- Follow-up: report only these paths: ${opts.onlyPaths.join(", ")}.` : ""}

## The shape

Exactly these keys. Omit what you can't fill; never write 0 for unknown.

\`\`\`yaml
taxonomy_intake: 1
as_of: ${new Date().toISOString().slice(0, 10)}
${sections.map((s) => template(s.id)).join("\n")}
sources:
  prior_return.agi: "2025 Form 1040 line 11 (file name)"
unknown:
  - people.self.expectedBonus
questions:
  - { about: prior_return.amtCreditCarryforward, proposed: 0, question: "No Form 8801 in the return package; used 0. Confirm no AMT credit was carried." }
\`\`\``);

  if (opts.profile) {
    parts.push(`## What the tool already has

Filing status and state are mine; do not ask about those. The rest is from an earlier pass or a placeholder (a 0 salary is a placeholder, not a fact). For the sections above, report the full current state (not a diff); the tool works out what changed.

\`\`\`yaml
${knownFacts(opts.profile, opts.sections)}
\`\`\``);
  }

  return parts.join("\n\n");
}
