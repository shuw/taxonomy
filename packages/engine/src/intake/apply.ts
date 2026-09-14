import type { ProfileEdit, ProfilePath } from "../profile.ts";
import type { EquityGrant, Holding, PriorReturn, Profile } from "../types.ts";
import type { IntakeDocument, IntakeGrant } from "./schema.ts";

export type IntakeSection = "basics" | "prior_return" | "income" | "equity" | "home" | "assumptions";

export interface IntakeChange {
  /** Stable id for selection, equal to the profile path joined with dots. */
  id: string;
  section: IntakeSection;
  label: string;
  path: ProfilePath;
  current: unknown;
  proposed: unknown;
  source?: string;
  status: "new" | "changed" | "same";
  format: "usd" | "number" | "pct" | "text" | "shares" | "grant" | "holdings" | "mortgage" | "priorReturn";
  note?: string;
}

export interface IntakeReview {
  changes: IntakeChange[];
  /** Paths the agent reported as not found, with a readable label. */
  unknown: { path: string; label: string }[];
  questions: string[];
  asOf?: string;
}

const same = (a: unknown, b: unknown) => JSON.stringify(strip(a)) === JSON.stringify(strip(b));
const strip = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).map(([k, x]) => [k, strip(x)]));
  return v;
};
const pathId = (path: ProfilePath) => path.join(".");

/** Compare an intake document to the current profile and list what would change. */
export function reviewIntake(doc: IntakeDocument, profile: Profile): IntakeReview {
  const changes: IntakeChange[] = [];
  const src = (key: string) => doc.sources?.[key];
  const add = (section: IntakeSection, label: string, path: ProfilePath, current: unknown, proposed: unknown, format: IntakeChange["format"], sourceKey?: string, note?: string) => {
    if (proposed === undefined) return;
    const status: IntakeChange["status"] = current === undefined || current === null ? "new" : same(current, proposed) ? "same" : "changed";
    changes.push({ id: pathId(path), section, label, path, current, proposed, source: src(sourceKey ?? pathId(path)), status, format, note });
  };

  // Basics and people ---------------------------------------------------------
  const b = doc.basics;
  if (b) {
    add("basics", "Filing status", ["filer", "filingStatus"], profile.filer.filingStatus, b.filingStatus, "text", "basics.filingStatus");
    add("basics", "State", ["filer", "state"], profile.filer.state, b.state, "text", "basics.state");
    add("basics", "Dependents", ["filer", "dependents"], profile.filer.dependents, b.dependents, "number", "basics.dependents");
    add("basics", "First plan year", ["plan", "startYear"], profile.plan.startYear, b.planStartYear, "number", "basics.planStartYear");
  }
  for (const who of ["self", "spouse"] as const) {
    const p = doc.people?.[who];
    if (!p) continue;
    const cur = profile.people[who];
    const label = who === "self" ? "Your" : "Spouse";
    add("basics", `${label} name`, ["people", who, "name"], cur?.name, p.name, "text", `people.${who}.name`);
    add("basics", `${label} base salary`, ["people", who, "salary"], cur?.salary, p.baseSalary, "usd", `people.${who}.baseSalary`);
    add("basics", `${label} expected bonus`, ["people", who, "bonus"], cur?.bonus, p.expectedBonus, "usd", `people.${who}.expectedBonus`);
    add("basics", `${label} pre-tax contributions`, ["people", who, "pretaxContributions"], cur?.pretaxContributions, p.pretaxContributions, "usd", `people.${who}.pretaxContributions`);
    add("basics", `${label} withholding to date`, ["people", who, "withholdingToDate"], cur?.withholdingToDate, p.withholdingToDate, "usd", `people.${who}.withholdingToDate`);
  }

  // Prior return and carryforwards ---------------------------------------------------
  const pr = doc.prior_return;
  if (pr) {
    add("prior_return", "AMT credit carryforward", ["carryforwards", "amtCredit"], profile.carryforwards?.amtCredit, pr.amtCreditCarryforward, "usd", "prior_return.amtCreditCarryforward");
    if (pr.capitalLossCarryforward) {
      add("prior_return", "Short-term capital loss carryforward", ["carryforwards", "capitalLoss", "shortTerm"], profile.carryforwards?.capitalLoss?.shortTerm, pr.capitalLossCarryforward.shortTerm, "usd", "prior_return.capitalLossCarryforward.shortTerm");
      add("prior_return", "Long-term capital loss carryforward", ["carryforwards", "capitalLoss", "longTerm"], profile.carryforwards?.capitalLoss?.longTerm, pr.capitalLossCarryforward.longTerm, "usd", "prior_return.capitalLossCarryforward.longTerm");
    }
    add("prior_return", "Charitable carryforward", ["carryforwards", "charitable"], profile.carryforwards?.charitable, pr.charitableCarryforward, "usd", "prior_return.charitableCarryforward");
    const proposed: PriorReturn = {
      year: pr.year,
      filingStatus: pr.filingStatus,
      inputs: {
        wages: pr.inputs?.wages, interest: pr.inputs?.interest, ordinaryDividends: pr.inputs?.ordinaryDividends, qualifiedDividends: pr.inputs?.qualifiedDividends,
        shortTermGains: pr.inputs?.shortTermGains, longTermGains: pr.inputs?.longTermGains, otherIncome: pr.inputs?.otherIncome,
        itemized: pr.itemized, isoBargainElement: pr.inputs?.isoBargainElement, amtCreditCarriedIn: pr.inputs?.amtCreditCarriedIn,
      },
      reported: {
        agi: pr.agi, taxableIncome: pr.taxableIncome, regularTax: pr.regularTax, amti: pr.amt?.amti, amtExemption: pr.amt?.exemption,
        tentativeMinimumTax: pr.amt?.tentativeMinimumTax, amt: pr.amt?.amt, amtCreditUsed: pr.amt?.creditUsed, niit: pr.niit, totalTax: pr.totalTax,
      },
    };
    add("prior_return", `${pr.year} return, for calibration`, ["priorReturn"], profile.priorReturn, strip(proposed), "priorReturn", "prior_return");
  }

  // Income -----------------------------------------------------------------------
  const inc = doc.income;
  if (inc) {
    add("income", "Interest", ["income", "interest"], profile.income.interest, inc.interest, "usd");
    add("income", "Total dividends", ["income", "ordinaryDividends"], profile.income.ordinaryDividends, inc.dividends?.ordinary, "usd", "income.dividends.ordinary");
    add("income", "Qualified dividends", ["income", "qualifiedDividends"], profile.income.qualifiedDividends, inc.dividends?.qualified, "usd", "income.dividends.qualified");
    add("income", "Short-term gains realized", ["income", "shortTermGains"], profile.income.shortTermGains, inc.realizedGains?.shortTerm, "usd", "income.realizedGains.shortTerm");
    add("income", "Long-term gains realized", ["income", "longTermGains"], profile.income.longTermGains, inc.realizedGains?.longTerm, "usd", "income.realizedGains.longTerm");
    add("income", "Other ordinary income", ["income", "otherOrdinary"], profile.income.otherOrdinary, inc.other, "usd", "income.other");
  }

  // Equity -----------------------------------------------------------------------
  const eq = doc.equity;
  if (eq) {
    add("equity", "Company", ["equity", "company"], profile.equity.company, eq.company, "text");
    const sp = typeof eq.sharePrice === "number" ? eq.sharePrice : eq.sharePrice?.value;
    add("equity", "Share value now", ["equity", "sharePrice"], profile.equity.sharePrice, sp, "usd", "equity.sharePrice", typeof eq.sharePrice === "object" && eq.sharePrice?.asOf ? `as of ${eq.sharePrice.asOf}${eq.sharePrice.basis ? `, ${eq.sharePrice.basis}` : ""}` : undefined);
    if (typeof eq.sharePrice === "object" && eq.sharePrice?.asOf) add("equity", "Share value date", ["equity", "sharePriceAsOf"], profile.equity.sharePriceAsOf, eq.sharePrice.asOf, "text", "equity.sharePrice.asOf");
    if (eq.grants) {
      const existing = new Map(profile.equity.grants.map((g, i) => [g.name, { grant: g, index: i }]));
      let added = 0;
      eq.grants.forEach((g, i) => {
        const proposed = toGrant(g);
        const hit = existing.get(g.name);
        const index = hit ? hit.index : profile.equity.grants.length + added++;
        add("equity", `Grant: ${g.name}`, ["equity", "grants", index], hit?.grant, proposed, "grant", `equity.grants[${i}]`);
      });
    }
    if (eq.holdings) {
      const proposed: Holding[] = eq.holdings.map((h) => strip({ lot: h.lot, owner: h.owner, quantity: h.quantity, acquired: h.acquired, via: h.via, costBasis: h.costBasis, amtBasis: h.amtBasis }) as Holding);
      add("equity", `Holdings (${proposed.length} lot${proposed.length === 1 ? "" : "s"})`, ["equity", "holdings"], profile.equity.holdings?.length ? profile.equity.holdings : undefined, proposed, "holdings");
    }
  }

  // Home and deductions --------------------------------------------------------------
  const home = doc.home;
  if (home) {
    if (home.mortgage) add("home", "Mortgage", ["home", "mortgage"], profile.home?.mortgage, strip(home.mortgage), "mortgage");
    add("home", "Property tax", ["home", "propertyTax"], profile.home?.propertyTax, home.propertyTax, "usd");
  }
  const ded = doc.deductions;
  if (ded) {
    add("home", "State income tax", ["deductions", "stateIncomeTax"], profile.deductions?.stateIncomeTax, ded.stateIncomeTax, "usd");
    if (ded.charitable) {
      add("home", "Charitable: cash", ["deductions", "charitable", "cash"], profile.deductions?.charitable?.cash, ded.charitable.cash, "usd");
      add("home", "Charitable: appreciated stock", ["deductions", "charitable", "appreciatedStock"], profile.deductions?.charitable?.appreciatedStock, ded.charitable.appreciatedStock, "usd");
      add("home", "Charitable: donor-advised fund", ["deductions", "charitable", "daf"], profile.deductions?.charitable?.daf, ded.charitable.daf, "usd");
    }
    add("home", "Medical expenses", ["deductions", "medical"], profile.deductions?.medical, ded.medical, "usd");
  }

  // Assumptions ------------------------------------------------------------------------
  const as = doc.assumptions;
  if (as) {
    add("assumptions", "Share value growth", ["assumptions", "fmvGrowth"], profile.assumptions.fmvGrowth, as.fmvGrowth, "pct");
    add("assumptions", "Wage growth", ["assumptions", "wageGrowth"], profile.assumptions.wageGrowth, as.wageGrowth, "pct");
    add("assumptions", "Inflation", ["assumptions", "inflation"], profile.assumptions.inflation, as.inflation, "pct");
  }

  const unknown = (doc.unknown ?? []).map((p) => ({ path: p, label: labelFor(p) }));
  return { changes, unknown, questions: doc.questions ?? [], asOf: doc.as_of };
}

/** An intake grant as the profile stores it. */
export function toGrant(g: IntakeGrant): EquityGrant {
  const type = g.type === "nqso" ? "nso" : g.type;
  const exercised = g.exercised ?? 0;
  const shares = type === "rsu"
    ? (g.granted ?? g.unexercised ?? 0)
    : (g.unexercised ?? Math.max(0, (g.granted ?? 0) - exercised));
  const vested = g.vested === undefined ? undefined : type === "rsu" ? g.vested : Math.max(0, g.vested - exercised);
  const out: EquityGrant = { name: g.name, type, owner: g.owner, grantDate: g.grantDate, granted: g.granted, shares, strike: type === "rsu" ? undefined : g.strike, vested, expires: g.expires };
  if (Array.isArray(g.vesting)) {
    const byYear: Record<number, number> = {};
    for (const ev of g.vesting) {
      const year = ev.year ?? (ev.date ? Number(ev.date.slice(0, 4)) : undefined);
      if (year !== undefined) byYear[year] = (byYear[year] ?? 0) + ev.shares;
    }
    out.vesting = byYear;
  } else if (g.vesting) {
    out.schedule = { start: g.vesting.start, years: g.vesting.years, cliffMonths: g.vesting.cliffMonths, cadence: g.vesting.cadence };
  }
  return strip(out) as EquityGrant;
}

/** Turn accepted changes into profile edits, recording provenance alongside. */
export function changesToEdits(changes: IntakeChange[], profile: Profile): ProfileEdit[] {
  const edits: ProfileEdit[] = [];
  // Grants are written as a whole list so indices stay consistent.
  const grantChanges = changes.filter((c) => c.format === "grant");
  if (grantChanges.length) {
    const grants = [...profile.equity.grants];
    for (const c of grantChanges) {
      const idx = c.path[2] as number;
      if (idx < grants.length) grants[idx] = c.proposed as EquityGrant;
      else grants.push(c.proposed as EquityGrant);
    }
    edits.push({ path: ["equity", "grants"], value: grants });
  }
  for (const c of changes) {
    if (c.format !== "grant") edits.push({ path: c.path, value: c.proposed });
    if (c.source) edits.push({ path: ["sources", c.id], value: c.source });
  }
  // A spouse needs a salary to exist; create the object when any spouse field arrives.
  if (!profile.people.spouse && changes.some((c) => c.path[0] === "people" && c.path[1] === "spouse") && !changes.some((c) => c.id === "people.spouse.salary")) {
    edits.unshift({ path: ["people", "spouse", "salary"], value: 0 });
  }
  return edits;
}

const LABELS: Record<string, string> = {
  "people.self.expectedBonus": "Your expected bonus",
  "people.spouse.expectedBonus": "Spouse expected bonus",
  "people.self.baseSalary": "Your base salary",
  "people.self.pretaxContributions": "Your pre-tax contributions",
  "equity.sharePrice": "Share value now",
  "prior_return.amtCreditCarryforward": "AMT credit carryforward",
  "home.mortgage": "Mortgage",
};

function labelFor(path: string): string {
  return LABELS[path] ?? path.replace(/\[(\d+)\]/g, " #$1").replace(/\./g, " › ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

/** Where an intake path lands in the profile, for values the user types in by hand. */
export function profilePathForIntake(path: string): ProfilePath | null {
  const direct: Record<string, ProfilePath> = {
    "basics.filingStatus": ["filer", "filingStatus"], "basics.state": ["filer", "state"], "basics.dependents": ["filer", "dependents"], "basics.planStartYear": ["plan", "startYear"],
    "income.interest": ["income", "interest"], "income.dividends.ordinary": ["income", "ordinaryDividends"], "income.dividends.qualified": ["income", "qualifiedDividends"],
    "income.realizedGains.shortTerm": ["income", "shortTermGains"], "income.realizedGains.longTerm": ["income", "longTermGains"], "income.other": ["income", "otherOrdinary"],
    "equity.sharePrice": ["equity", "sharePrice"], "equity.company": ["equity", "company"],
    "home.propertyTax": ["home", "propertyTax"], "deductions.stateIncomeTax": ["deductions", "stateIncomeTax"], "deductions.medical": ["deductions", "medical"],
    "deductions.charitable.cash": ["deductions", "charitable", "cash"], "deductions.charitable.appreciatedStock": ["deductions", "charitable", "appreciatedStock"], "deductions.charitable.daf": ["deductions", "charitable", "daf"],
    "prior_return.amtCreditCarryforward": ["carryforwards", "amtCredit"], "prior_return.capitalLossCarryforward.shortTerm": ["carryforwards", "capitalLoss", "shortTerm"], "prior_return.capitalLossCarryforward.longTerm": ["carryforwards", "capitalLoss", "longTerm"], "prior_return.charitableCarryforward": ["carryforwards", "charitable"],
    "assumptions.fmvGrowth": ["assumptions", "fmvGrowth"], "assumptions.wageGrowth": ["assumptions", "wageGrowth"], "assumptions.inflation": ["assumptions", "inflation"],
  };
  if (direct[path]) return direct[path]!;
  const m = path.match(/^people\.(self|spouse)\.(name|baseSalary|expectedBonus|pretaxContributions|withholdingToDate)$/);
  if (m) return ["people", m[1]!, { name: "name", baseSalary: "salary", expectedBonus: "bonus", pretaxContributions: "pretaxContributions", withholdingToDate: "withholdingToDate" }[m[2]!]!];
  return null;
}
