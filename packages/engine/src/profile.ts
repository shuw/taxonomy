import { parse } from "yaml";
import type { FilingStatus, Profile } from "./types.ts";

const STATUSES: FilingStatus[] = ["single", "mfj", "mfs", "hoh"];

/** Parse a profile file and fail loudly on anything the engine cannot work with. */
export function parseProfile(text: string): Profile {
  const raw = parse(text) as Partial<Profile> | null;
  if (!raw || typeof raw !== "object") throw new Error("profile is empty");
  const problems: string[] = [];
  if (raw.version !== 1) problems.push("version must be 1");
  if (!raw.filer || !STATUSES.includes(raw.filer.filingStatus)) problems.push(`filer.filingStatus must be one of ${STATUSES.join(", ")}`);
  if (!raw.filer?.state) problems.push("filer.state is required");
  if (!raw.plan || !Number.isInteger(raw.plan.startYear) || !Number.isInteger(raw.plan.years) || raw.plan.years < 1) problems.push("plan.startYear and plan.years are required");
  if (!raw.assumptions) problems.push("assumptions is required");
  if (!raw.income || typeof raw.income.wages !== "number") problems.push("income.wages is required");
  if (problems.length) throw new Error("profile problems:\n - " + problems.join("\n - "));
  return {
    version: 1,
    filer: raw.filer!,
    plan: raw.plan!,
    assumptions: { inflation: 0.025, wageGrowth: 0, fmvGrowth: 0, ...raw.assumptions },
    income: raw.income!,
    deductions: raw.deductions ?? {},
    equity: { isoGrants: [], ...raw.equity },
    levers: raw.levers,
  };
}
