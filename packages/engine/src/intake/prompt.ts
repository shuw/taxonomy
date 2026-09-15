import { exampleValue, FIELDS, requiredFields, type FieldDef } from "../fields.ts";
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
  const required = sections.map((s) => ({ s, items: requiredList(s.id) })).filter((x) => x.items.length);
  parts.push(`# Taxonomy intake request

I use Taxonomy, a personal tax-planning tool. It needs a structured snapshot of my situation, assembled from my documents. Work with me in two phases and return ONE YAML document at the end, in the exact shape shown below. The tool validates the result and shows me every number with its source before anything is saved.

## Phase 1: gather, then ask me

1. Read everything you have access to that is relevant: my filed returns, W-2s and 1099s, pay stubs, equity portal pages or exports, Form 3921, Form 1098, 409A notices.
2. Compare what you found against the required items below. For anything required that you could not find or could not read with confidence, ASK ME before producing the document. Batch your questions in one message. Be specific about what would resolve each one: name the form and line, the portal page, or the number you need me to type. Suggest which document I should upload when that is the quickest path.
3. Keep asking until every required item is resolved, or I tell you I cannot provide it. Optional items you could not find are simply left out; do not ask about those unless one question covers several.
4. Only then produce the document.

## What to gather

${sections.map((s) => `- **${s.title}**: ${s.what}\n  Documents: ${s.documents}.`).join("\n")}

## Required before you answer

${required.map(({ s, items }) => `**${s.title}**\n${items.map((i) => `- ${i}`).join("\n")}`).join("\n\n")}

Everything else in the document shape is optional: fill it when a document shows it, leave it out when none does.

## Rules for the document

1. Copy numbers from documents or from my answers. Never estimate or fill from general knowledge. Optional values you could not find are left out and listed under \`unknown\`; required values must be resolved with me first, so \`unknown\` never holds a required item.
2. For every number you report, add a \`sources\` entry keyed by its path naming the document and the line, box or page, or "answered by user" when I typed it, e.g. \`prior_return.agi: "2025 Form 1040 line 11 (2025-return.pdf)"\`.
3. Prefer the filed return over a portal, the portal over a pay stub, and a pay stub over memory. When two documents disagree, ask me in phase 1; if I cannot resolve it, report the more authoritative one and note the other in \`questions\`.
4. Money in whole dollars; prices per share; dates as YYYY-MM-DD; rates as fractions (0.0575, not 5.75%).
5. Base salary means base pay only. Do not add RSU vests or option exercises to it; the tool adds those from the grants.
6. For options, report granted, vested, exercised and unexercised as separate counts as the portal shows them. NQSO and NSO are the same type: use \`nso\`. Omit the whole \`spouse\` block when there is no spouse.
7. \`questions\` is only for things that stayed open after we talked. Return the YAML document inside one \`\`\`yaml fence, and nothing else in that final message.${opts.onlyPaths?.length ? `\n8. This is a follow-up. Only report these paths: ${opts.onlyPaths.join(", ")}. Leave everything else out.` : ""}

## Document shape

Use exactly these keys. Omit any key you cannot fill; do not write 0 for unknown.

\`\`\`yaml
taxonomy_intake: 1
as_of: ${new Date().toISOString().slice(0, 10)}
${sections.map((s) => template(s.id)).join("\n")}
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
