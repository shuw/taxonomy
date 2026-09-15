import { parse } from "yaml";
import type { FilingStatus, Owner } from "../types.ts";

/**
 * The intake document: what an agent hands back after reading the user's documents.
 * Everything is optional; unknowns are listed, not guessed. Values are plain, provenance
 * sits in `sources` keyed by the path of the value it describes.
 */
export interface IntakeDocument {
  taxonomy_intake: 1;
  as_of?: string;
  basics?: {
    filingStatus?: FilingStatus;
    state?: string;
    dependents?: number;
    planStartYear?: number;
  };
  pay?: { dependents?: number };
  people?: { self?: IntakePerson; spouse?: IntakePerson };
  prior_return?: IntakePriorReturn;
  income?: {
    interest?: number;
    dividends?: { ordinary?: number; qualified?: number };
    realizedGains?: { shortTerm?: number; longTerm?: number };
    other?: number;
  };
  equity?: {
    company?: string;
    sharePrice?: number | { value: number; asOf?: string; basis?: string };
    grants?: IntakeGrant[];
    holdings?: IntakeHolding[];
  };
  home?: {
    mortgage?: { balance: number; rate: number; originated: string; originalAmount?: number; termYears?: number };
    propertyTax?: number;
  };
  deductions?: {
    stateIncomeTax?: number;
    charitable?: { cash?: number; appreciatedStock?: number; daf?: number };
    medical?: number;
  };
  assumptions?: { fmvGrowth?: number; wageGrowth?: number; inflation?: number };
  sources?: Record<string, string>;
  unknown?: string[];
  questions?: IntakeQuestion[];
}

/** Something the agent could not settle, ideally tied to the path it concerns. */
export interface IntakeQuestion {
  question: string;
  about?: string;
  proposed?: string | number;
}

export interface IntakePerson {
  name?: string;
  baseSalary?: number;
  expectedBonus?: number;
  pretaxContributions?: number;
  withholdingToDate?: number;
}

export interface IntakePriorReturn {
  year: number;
  filingStatus?: FilingStatus;
  agi?: number;
  taxableIncome?: number;
  regularTax?: number;
  totalTax?: number;
  niit?: number;
  additionalMedicare?: number;
  amt?: { amti?: number; exemption?: number; tentativeMinimumTax?: number; amt?: number; creditUsed?: number };
  amtCreditCarryforward?: number;
  capitalLossCarryforward?: { shortTerm?: number; longTerm?: number };
  charitableCarryforward?: number;
  itemized?: { salt?: number; mortgageInterest?: number; charitable?: number; other?: number };
  inputs?: {
    wages?: number;
    interest?: number;
    ordinaryDividends?: number;
    qualifiedDividends?: number;
    shortTermGains?: number;
    longTermGains?: number;
    otherIncome?: number;
    isoBargainElement?: number;
    amtCreditCarriedIn?: number;
    medicareWages?: number;
  };
}

export type IntakeGrantType = "iso" | "nso" | "nqso" | "rsu";

export interface IntakeGrant {
  name: string;
  type: IntakeGrantType;
  owner?: Owner;
  grantDate?: string;
  granted?: number;
  strike?: number;
  vesting?:
    | { start: string; years: number; cliffMonths?: number; cadence?: "monthly" | "quarterly" | "annual" }
    | { date?: string; year?: number; shares: number }[];
  vested?: number;
  exercised?: number;
  unexercised?: number;
  expires?: string;
  /** RSUs: "double" when the grant needs a liquidity event to settle. */
  trigger?: "single" | "double";
}

export interface IntakeHolding {
  lot: string;
  owner?: Owner;
  quantity: number;
  acquired: string;
  via: "iso_exercise" | "nso_exercise" | "rsu_vest" | "espp" | "purchase" | "other";
  costBasis: number;
  amtBasis?: number;
  /** ISO shares: the option's grant date. */
  grantDate?: string;
}

export interface IntakeProblem { path: string; message: string }

export interface IntakeParse {
  doc: IntakeDocument | null;
  problems: IntakeProblem[];
  warnings: IntakeProblem[];
}

const FILING: FilingStatus[] = ["single", "mfj", "mfs", "hoh"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse pasted text (YAML or JSON, with or without a code fence) into an intake document, with precise problems. */
export function parseIntake(text: string): IntakeParse {
  const problems: IntakeProblem[] = [];
  const warnings: IntakeProblem[] = [];
  const body = unfence(text);
  let raw: unknown;
  try {
    raw = parse(body);
  } catch (e) {
    return { doc: null, problems: [{ path: "", message: `not valid YAML or JSON: ${(e as Error).message}` }], warnings };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { doc: null, problems: [{ path: "", message: "expected a document with taxonomy_intake: 1 at the top" }], warnings };
  const d = raw as Record<string, unknown>;
  if (d.taxonomy_intake !== 1) problems.push({ path: "taxonomy_intake", message: "must be 1" });

  const num = (path: string, v: unknown, opts: { min?: number; max?: number } = {}): number | undefined => {
    if (v === undefined || v === null) return undefined;
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v.replace(/[,$%\s]/g, "")))) {
      warnings.push({ path, message: `read "${v}" as a number` });
      v = Number(v.replace(/[,$%\s]/g, ""));
    }
    if (typeof v !== "number" || !Number.isFinite(v)) { problems.push({ path, message: "must be a number" }); return undefined; }
    if (opts.min !== undefined && v < opts.min) problems.push({ path, message: `must be at least ${opts.min}` });
    if (opts.max !== undefined && v > opts.max) problems.push({ path, message: `must be at most ${opts.max}` });
    return v;
  };
  const str = (path: string, v: unknown): string | undefined => {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "string") { problems.push({ path, message: "must be text" }); return undefined; }
    return v;
  };
  const date = (path: string, v: unknown): string | undefined => {
    const s = v instanceof Date ? v.toISOString().slice(0, 10) : str(path, v);
    if (s !== undefined && !DATE.test(s)) problems.push({ path, message: "must be a date like 2025-03-15" });
    return s;
  };
  const obj = (path: string, v: unknown): Record<string, unknown> | undefined => {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "object" || Array.isArray(v)) { problems.push({ path, message: "must be a mapping" }); return undefined; }
    return v as Record<string, unknown>;
  };
  const rate = (path: string, v: unknown): number | undefined => {
    const r = num(path, v);
    if (r !== undefined && r > 1) { warnings.push({ path, message: `read ${r} as a percentage` }); return r / 100; }
    return r;
  };
  const person = (path: string, v: unknown): IntakePerson | undefined => {
    const o = obj(path, v);
    if (!o) return undefined;
    return {
      name: str(`${path}.name`, o.name),
      baseSalary: num(`${path}.baseSalary`, o.baseSalary, { min: 0 }),
      expectedBonus: num(`${path}.expectedBonus`, o.expectedBonus, { min: 0 }),
      pretaxContributions: num(`${path}.pretaxContributions`, o.pretaxContributions, { min: 0 }),
      withholdingToDate: num(`${path}.withholdingToDate`, o.withholdingToDate, { min: 0 }),
    };
  };

  const doc: IntakeDocument = { taxonomy_intake: 1, as_of: date("as_of", d.as_of) };

  const basics = obj("basics", d.basics);
  if (basics) {
    const fsRaw = str("basics.filingStatus", basics.filingStatus)?.toLowerCase();
    const fs = fsRaw === undefined ? undefined : normalizeFiling(fsRaw);
    if (fsRaw !== undefined && !fs) problems.push({ path: "basics.filingStatus", message: `must be one of ${FILING.join(", ")}` });
    doc.basics = { filingStatus: fs, state: str("basics.state", basics.state)?.toUpperCase(), dependents: num("basics.dependents", basics.dependents, { min: 0 }), planStartYear: num("basics.planStartYear", basics.planStartYear, { min: 2025, max: 2100 }) };
  }
  const payRaw = obj("pay", d.pay);
  if (payRaw) doc.pay = { dependents: num("pay.dependents", payRaw.dependents, { min: 0 }) };
  const people = obj("people", d.people);
  if (people) doc.people = { self: person("people.self", people.self), spouse: person("people.spouse", people.spouse) };

  const pr = obj("prior_return", d.prior_return);
  if (pr) {
    const year = num("prior_return.year", pr.year, { min: 2018, max: 2100 });
    if (year === undefined) problems.push({ path: "prior_return.year", message: "is required" });
    const amt = obj("prior_return.amt", pr.amt);
    const clc = obj("prior_return.capitalLossCarryforward", pr.capitalLossCarryforward);
    const it = obj("prior_return.itemized", pr.itemized);
    const inp = obj("prior_return.inputs", pr.inputs);
    const fsRaw = str("prior_return.filingStatus", pr.filingStatus)?.toLowerCase();
    doc.prior_return = {
      year: year ?? 0,
      filingStatus: fsRaw ? normalizeFiling(fsRaw) : undefined,
      agi: num("prior_return.agi", pr.agi),
      taxableIncome: num("prior_return.taxableIncome", pr.taxableIncome),
      regularTax: num("prior_return.regularTax", pr.regularTax),
      totalTax: num("prior_return.totalTax", pr.totalTax),
      niit: num("prior_return.niit", pr.niit),
      additionalMedicare: num("prior_return.additionalMedicare", pr.additionalMedicare),
      amt: amt ? { amti: num("prior_return.amt.amti", amt.amti), exemption: num("prior_return.amt.exemption", amt.exemption), tentativeMinimumTax: num("prior_return.amt.tentativeMinimumTax", amt.tentativeMinimumTax), amt: num("prior_return.amt.amt", amt.amt), creditUsed: num("prior_return.amt.creditUsed", amt.creditUsed) } : undefined,
      amtCreditCarryforward: num("prior_return.amtCreditCarryforward", pr.amtCreditCarryforward, { min: 0 }),
      capitalLossCarryforward: clc ? { shortTerm: num("prior_return.capitalLossCarryforward.shortTerm", clc.shortTerm, { min: 0 }), longTerm: num("prior_return.capitalLossCarryforward.longTerm", clc.longTerm, { min: 0 }) } : undefined,
      charitableCarryforward: num("prior_return.charitableCarryforward", pr.charitableCarryforward, { min: 0 }),
      itemized: it ? { salt: num("prior_return.itemized.salt", it.salt), mortgageInterest: num("prior_return.itemized.mortgageInterest", it.mortgageInterest), charitable: num("prior_return.itemized.charitable", it.charitable), other: num("prior_return.itemized.other", it.other) } : undefined,
      inputs: inp ? {
        wages: num("prior_return.inputs.wages", inp.wages), interest: num("prior_return.inputs.interest", inp.interest),
        ordinaryDividends: num("prior_return.inputs.ordinaryDividends", inp.ordinaryDividends), qualifiedDividends: num("prior_return.inputs.qualifiedDividends", inp.qualifiedDividends),
        shortTermGains: num("prior_return.inputs.shortTermGains", inp.shortTermGains), longTermGains: num("prior_return.inputs.longTermGains", inp.longTermGains),
        otherIncome: num("prior_return.inputs.otherIncome", inp.otherIncome), isoBargainElement: num("prior_return.inputs.isoBargainElement", inp.isoBargainElement),
        amtCreditCarriedIn: num("prior_return.inputs.amtCreditCarriedIn", inp.amtCreditCarriedIn),
        medicareWages: num("prior_return.inputs.medicareWages", inp.medicareWages),
      } : undefined,
    };
  }

  const income = obj("income", d.income);
  if (income) {
    const div = obj("income.dividends", income.dividends);
    const g = obj("income.realizedGains", income.realizedGains);
    doc.income = {
      interest: num("income.interest", income.interest),
      dividends: div ? { ordinary: num("income.dividends.ordinary", div.ordinary), qualified: num("income.dividends.qualified", div.qualified) } : undefined,
      realizedGains: g ? { shortTerm: num("income.realizedGains.shortTerm", g.shortTerm), longTerm: num("income.realizedGains.longTerm", g.longTerm) } : undefined,
      other: num("income.other", income.other),
    };
  }

  const eq = obj("equity", d.equity);
  if (eq) {
    let sharePrice: number | { value: number; asOf?: string; basis?: string } | undefined;
    if (typeof eq.sharePrice === "object" && eq.sharePrice !== null) {
      const sp = eq.sharePrice as Record<string, unknown>;
      const value = num("equity.sharePrice.value", sp.value, { min: 0 });
      sharePrice = value === undefined ? undefined : { value, asOf: date("equity.sharePrice.asOf", sp.asOf), basis: str("equity.sharePrice.basis", sp.basis) };
    } else sharePrice = num("equity.sharePrice", eq.sharePrice, { min: 0 });
    const grants: IntakeGrant[] = [];
    if (eq.grants !== undefined) {
      if (!Array.isArray(eq.grants)) problems.push({ path: "equity.grants", message: "must be a list" });
      else eq.grants.forEach((g, i) => {
        const path = `equity.grants[${i}]`;
        const o = obj(path, g);
        if (!o) return;
        const name = str(`${path}.name`, o.name) ?? `Grant ${i + 1}`;
        const typeRaw = str(`${path}.type`, o.type)?.toLowerCase();
        if (!typeRaw || !["iso", "nso", "nqso", "rsu"].includes(typeRaw)) { problems.push({ path: `${path}.type`, message: "must be iso, nso, nqso or rsu" }); return; }
        const type = typeRaw as IntakeGrantType;
        const ownerRaw = str(`${path}.owner`, o.owner)?.toLowerCase();
        if (ownerRaw !== undefined && ownerRaw !== "self" && ownerRaw !== "spouse") problems.push({ path: `${path}.owner`, message: "must be self or spouse" });
        let vesting: IntakeGrant["vesting"];
        if (Array.isArray(o.vesting)) {
          vesting = o.vesting.map((ev, j) => {
            const e = obj(`${path}.vesting[${j}]`, ev) ?? {};
            return { date: e.date === undefined ? undefined : date(`${path}.vesting[${j}].date`, e.date), year: num(`${path}.vesting[${j}].year`, e.year), shares: num(`${path}.vesting[${j}].shares`, e.shares, { min: 0 }) ?? 0 };
          });
        } else if (o.vesting !== undefined) {
          const v = obj(`${path}.vesting`, o.vesting);
          if (v) {
            const start = date(`${path}.vesting.start`, v.start);
            const years = num(`${path}.vesting.years`, v.years, { min: 0 });
            if (start === undefined || years === undefined) problems.push({ path: `${path}.vesting`, message: "a schedule needs start and years" });
            const cadence = str(`${path}.vesting.cadence`, v.cadence)?.toLowerCase();
            if (cadence !== undefined && !["monthly", "quarterly", "annual"].includes(cadence)) problems.push({ path: `${path}.vesting.cadence`, message: "must be monthly, quarterly or annual" });
            vesting = { start: start ?? "", years: years ?? 0, cliffMonths: num(`${path}.vesting.cliffMonths`, v.cliffMonths, { min: 0 }), cadence: cadence as "monthly" | "quarterly" | "annual" | undefined };
          }
        }
        const strike = num(`${path}.strike`, o.strike, { min: 0 });
        if (type !== "rsu" && strike === undefined) problems.push({ path: `${path}.strike`, message: "options need a strike price" });
        const granted = num(`${path}.granted`, o.granted, { min: 0 });
        const unexercised = num(`${path}.unexercised`, o.unexercised, { min: 0 });
        if (granted === undefined && unexercised === undefined) problems.push({ path, message: "needs granted or unexercised shares" });
        const triggerRaw = str(`${path}.trigger`, o.trigger)?.toLowerCase();
        if (triggerRaw !== undefined && triggerRaw !== "single" && triggerRaw !== "double") problems.push({ path: `${path}.trigger`, message: "must be single or double" });
        grants.push({ name, type, owner: ownerRaw as Owner | undefined, grantDate: o.grantDate === undefined ? undefined : date(`${path}.grantDate`, o.grantDate), granted, strike, vesting, vested: num(`${path}.vested`, o.vested, { min: 0 }), exercised: num(`${path}.exercised`, o.exercised, { min: 0 }), unexercised, expires: o.expires === undefined ? undefined : date(`${path}.expires`, o.expires), trigger: triggerRaw as "single" | "double" | undefined });
      });
    }
    const holdings: IntakeHolding[] = [];
    if (eq.holdings !== undefined) {
      if (!Array.isArray(eq.holdings)) problems.push({ path: "equity.holdings", message: "must be a list" });
      else eq.holdings.forEach((h, i) => {
        const path = `equity.holdings[${i}]`;
        const o = obj(path, h);
        if (!o) return;
        const via = str(`${path}.via`, o.via)?.toLowerCase() ?? "other";
        if (!["iso_exercise", "nso_exercise", "rsu_vest", "espp", "purchase", "other"].includes(via)) problems.push({ path: `${path}.via`, message: "must be iso_exercise, nso_exercise, rsu_vest, espp, purchase or other" });
        holdings.push({
          lot: str(`${path}.lot`, o.lot) ?? `Lot ${i + 1}`,
          owner: str(`${path}.owner`, o.owner) as Owner | undefined,
          quantity: num(`${path}.quantity`, o.quantity, { min: 0 }) ?? 0,
          acquired: date(`${path}.acquired`, o.acquired) ?? "",
          via: via as IntakeHolding["via"],
          costBasis: num(`${path}.costBasis`, o.costBasis, { min: 0 }) ?? 0,
          amtBasis: num(`${path}.amtBasis`, o.amtBasis, { min: 0 }),
          grantDate: date(`${path}.grantDate`, o.grantDate),
        });
      });
    }
    doc.equity = { company: str("equity.company", eq.company), sharePrice, grants: eq.grants === undefined ? undefined : grants, holdings: eq.holdings === undefined ? undefined : holdings };
  }

  const home = obj("home", d.home);
  if (home) {
    const m = obj("home.mortgage", home.mortgage);
    doc.home = {
      mortgage: m ? {
        balance: num("home.mortgage.balance", m.balance, { min: 0 }) ?? 0,
        rate: rate("home.mortgage.rate", m.rate) ?? 0,
        originated: date("home.mortgage.originated", m.originated) ?? "",
        originalAmount: num("home.mortgage.originalAmount", m.originalAmount, { min: 0 }),
        termYears: num("home.mortgage.termYears", m.termYears, { min: 1 }),
      } : undefined,
      propertyTax: num("home.propertyTax", home.propertyTax, { min: 0 }),
    };
    if (m && (m.balance === undefined || m.rate === undefined || m.originated === undefined)) problems.push({ path: "home.mortgage", message: "needs balance, rate and originated" });
  }

  const ded = obj("deductions", d.deductions);
  if (ded) {
    const ch = obj("deductions.charitable", ded.charitable);
    doc.deductions = {
      stateIncomeTax: num("deductions.stateIncomeTax", ded.stateIncomeTax, { min: 0 }),
      charitable: ch ? { cash: num("deductions.charitable.cash", ch.cash, { min: 0 }), appreciatedStock: num("deductions.charitable.appreciatedStock", ch.appreciatedStock, { min: 0 }), daf: num("deductions.charitable.daf", ch.daf, { min: 0 }) } : undefined,
      medical: num("deductions.medical", ded.medical, { min: 0 }),
    };
  }

  const as = obj("assumptions", d.assumptions);
  if (as) doc.assumptions = { fmvGrowth: rate("assumptions.fmvGrowth", as.fmvGrowth), wageGrowth: rate("assumptions.wageGrowth", as.wageGrowth), inflation: rate("assumptions.inflation", as.inflation) };

  const sources = obj("sources", d.sources);
  if (sources) doc.sources = Object.fromEntries(Object.entries(sources).filter(([, v]) => typeof v === "string") as [string, string][]);
  if (d.unknown !== undefined) doc.unknown = Array.isArray(d.unknown) ? d.unknown.map(String) : [];
  if (d.questions !== undefined) {
    doc.questions = Array.isArray(d.questions)
      ? d.questions.map((q): IntakeQuestion | null => {
          if (typeof q === "string") return q.trim() ? { question: q.trim() } : null;
          if (q && typeof q === "object") {
            const o = q as Record<string, unknown>;
            const question = String(o.question ?? o.text ?? "").trim();
            if (!question) return null;
            return { question, about: typeof o.about === "string" ? o.about : undefined, proposed: typeof o.proposed === "number" || typeof o.proposed === "string" ? o.proposed : undefined };
          }
          return null;
        }).filter((q): q is IntakeQuestion => q !== null)
      : [];
  }

  const known = new Set(["taxonomy_intake", "as_of", "basics", "pay", "people", "prior_return", "income", "equity", "home", "deductions", "assumptions", "sources", "unknown", "questions"]);
  for (const k of Object.keys(d)) if (!known.has(k)) warnings.push({ path: k, message: "not a known section; ignored" });

  return { doc: problems.length ? null : doc, problems, warnings };
}

function normalizeFiling(raw: string): FilingStatus | undefined {
  const s = raw.replace(/[_-]+/g, " ").trim();
  const map: Record<string, FilingStatus> = {
    single: "single", s: "single",
    mfj: "mfj", "married filing jointly": "mfj", joint: "mfj", married: "mfj",
    mfs: "mfs", "married filing separately": "mfs", separate: "mfs",
    hoh: "hoh", "head of household": "hoh",
  };
  return map[s];
}

/** The document inside the first ``` fence in the text (prose around it is ignored), or the text itself. */
export function unfence(text: string): string {
  const m = text.match(/```[a-zA-Z]*[ \t]*\n([\s\S]*?)\n[ \t]*```/);
  return m ? m[1]! : text;
}
