import { parse } from "yaml";
import { FIELDS } from "../fields.ts";
import { getPath } from "../timeline.ts";
import type { FilingStatus, Owner } from "../types.ts";

/** Set a dotted path on a plain object, creating the objects between. */
/** `equity.holdings[0].amtBasis` and `equity.holdings.0.amtBasis` mean the same path. */
const dotted = (path: string) => path.trim().replace(/\[(\d+)\]/g, ".$1");

function setAt(target: Record<string, unknown>, path: string, value: unknown): void {
  const segs = path.split(".");
  let node = target;
  for (const seg of segs.slice(0, -1)) {
    if (seg === "__proto__" || seg === "constructor") return;
    const next = node[seg];
    if (!next || typeof next !== "object") node[seg] = {};
    node = node[seg] as Record<string, unknown>;
  }
  const last = segs[segs.length - 1]!;
  if (last !== "__proto__" && last !== "constructor") node[last] = value;
}

/**
 * The intake document: what an agent hands back after reading the user's documents.
 * Everything is optional; unknowns are listed, not guessed. Values are plain, provenance
 * sits in `sources` keyed by the path of the value it describes.
 */
export interface IntakeDependent { name?: string; birthYear?: number; }

export interface IntakeDocument {
  taxonomy_intake: 1;
  as_of?: string;
  basics?: {
    filingStatus?: FilingStatus;
    state?: string;
    /** A count, birth years, or the dependents as the return lists them (name, and a birth year when known). */
    dependents?: number | IntakeDependent[];
    planStartYear?: number;
  };
  pay?: { dependents?: number | IntakeDependent[] };
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
    sharePrice?: number | { value: number; asOf?: string };
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

  const doc: IntakeDocument = { taxonomy_intake: 1, as_of: date("as_of", d.as_of) };

  /** Dependents come as a count, a list of birth years, or a list of people ({ name, birthYear? }) as the return lists them. */
  const dependents = (path: string, raw: unknown): number | IntakeDependent[] | undefined => {
    if (raw === undefined || raw === null) return undefined;
    if (Array.isArray(raw)) {
      const out: IntakeDependent[] = [];
      for (const x of raw) {
        const y = x && typeof x === "object" ? (x as { birthYear?: unknown; year?: unknown }).birthYear ?? (x as { year?: unknown }).year : x;
        const year = typeof y === "string" && /^\d{4}$/.test(y) ? Number(y) : y;
        const name = x && typeof x === "object" && typeof (x as { name?: unknown }).name === "string" ? (x as { name: string }).name.trim() : undefined;
        if (year !== undefined && !(typeof year === "number" && year >= 1900 && year <= 2100)) { problems.push({ path, message: "each dependent is a birth year, or { name, birthYear }" }); return undefined; }
        if (year === undefined && !name) { problems.push({ path, message: "each dependent needs a name or a birth year" }); return undefined; }
        out.push({ ...(name ? { name } : {}), ...(typeof year === "number" ? { birthYear: year } : {}) });
      }
      return out;
    }
    return num(path, raw, { min: 0 });
  };
  const basics = obj("basics", d.basics);
  if (basics) doc.basics = { dependents: dependents("basics.dependents", basics.dependents), planStartYear: num("basics.planStartYear", basics.planStartYear, { min: 2025, max: 2100 }) };
  const payRaw = obj("pay", d.pay);
  if (payRaw) doc.pay = { dependents: dependents("pay.dependents", payRaw.dependents) };

  const pr = obj("prior_return", d.prior_return);
  if (pr && num("prior_return.year", pr.year, { min: 2018, max: 2100 }) === undefined) problems.push({ path: "prior_return.year", message: "is required" });

  const eq = obj("equity", d.equity);
  if (eq) {
    // A bare number for the share price means { value }.
    if (typeof eq.sharePrice === "number" || typeof eq.sharePrice === "string") eq.sharePrice = { value: eq.sharePrice };
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
    doc.equity = { grants: eq.grants === undefined ? undefined : grants, holdings: eq.holdings === undefined ? undefined : holdings };
  }

  const home = obj("home", d.home);
  const m = home ? obj("home.mortgage", home.mortgage) : undefined;
  if (m && m.balance === undefined) problems.push({ path: "home.mortgage", message: "needs at least the balance" });
  else if (m && (m.rate === undefined || m.originated === undefined)) warnings.push({ path: "home.mortgage", message: `missing ${[m.rate === undefined && "rate", m.originated === undefined && "originated"].filter(Boolean).join(" and ")}; kept as a question` });

  // Every scalar the registry knows is read by its intake path and coerced by its type; sections above only handle what is not a plain scalar.
  const out = doc as unknown as Record<string, unknown>;
  const handledAbove = new Set(["filer.dependents"]);
  for (const f of FIELDS) {
    if (!f.intake || handledAbove.has(f.path)) continue;
    const raw = getPath(d, f.intake);
    if (raw === undefined || raw === null) continue;
    let v: unknown;
    switch (f.type) {
      case "usd": case "number": v = num(f.intake, raw, f.path.startsWith("returns.") || f.path.startsWith("income.") ? {} : { min: 0 }); break;
      case "pct": v = rate(f.intake, raw); break;
      case "date": v = date(f.intake, raw); break;
      case "year": v = num(f.intake, raw, { min: 2018, max: 2100 }); break;
      case "bool": v = typeof raw === "boolean" ? raw : typeof raw === "string" ? /^(true|yes|on)$/i.test(raw) : undefined; break;
      case "enum": {
        const sv = str(f.intake, raw)?.toLowerCase();
        v = sv === undefined ? undefined : f.path.endsWith("filingStatus") ? normalizeFiling(sv) : f.enum?.includes(sv) ? sv : undefined;
        if (sv !== undefined && v === undefined) problems.push({ path: f.intake, message: `must be one of ${(f.path.endsWith("filingStatus") ? FILING : f.enum ?? []).join(", ")}` });
        break;
      }
      default: v = str(f.intake, raw); if (f.path === "filer.state" && typeof v === "string") v = v.toUpperCase();
    }
    if (v !== undefined) setAt(out, f.intake, v);
  }

  const sources = obj("sources", d.sources);
  if (sources) doc.sources = Object.fromEntries(Object.entries(sources).filter(([, v]) => typeof v === "string") as [string, string][]);
  if (d.unknown !== undefined) doc.unknown = Array.isArray(d.unknown) ? d.unknown.map((u) => dotted(String(u))) : [];
  if (d.questions !== undefined) {
    doc.questions = Array.isArray(d.questions)
      ? d.questions.map((q): IntakeQuestion | null => {
          if (typeof q === "string") return q.trim() ? { question: q.trim() } : null;
          if (q && typeof q === "object") {
            const o = q as Record<string, unknown>;
            const question = String(o.question ?? o.text ?? "").trim();
            if (!question) return null;
            return { question, about: typeof o.about === "string" ? dotted(o.about) : undefined, proposed: typeof o.proposed === "number" || typeof o.proposed === "string" ? o.proposed : undefined };
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
