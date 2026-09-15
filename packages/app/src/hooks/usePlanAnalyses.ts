import { useMemo } from "react";
import { amtCrossover, companiesWithGrants, companyName, creditRecovery, holdOrSell, runPlan, sweepIsoExercise, type AmtCrossover, type CreditRecovery, type HoldOrSell, type Levers, type PlanResult, type Profile, type SweepPoint } from "@taxonomy/engine";

export interface CompanyAnalysis { company: string; name: string; crossover: AmtCrossover; sweep: SweepPoint[]; recovery: CreditRecovery | null; hold: HoldOrSell | null; }

/**
 * Everything the main view derives from the profile and its levers. The plan is memoized on both;
 * the per-year analyses (AMT crossover and sweep, credit recovery, hold-or-sell) run only for the
 * focused year and only for companies with ISO grants.
 */
export function usePlanAnalyses(profile: Profile, levers: Levers, sweepYear: number): { plan: PlanResult; isoCompanies: string[]; crossovers: AmtCrossover[]; byCompany: CompanyAnalysis[] } {
  const plan = useMemo(() => runPlan(profile, levers), [profile, levers]);
  const isoCompanies = useMemo(() => companiesWithGrants(profile, "iso"), [profile]);
  const byCompany = useMemo<CompanyAnalysis[]>(() => isoCompanies.map((company) => ({
    company,
    name: companyName(profile, company),
    crossover: amtCrossover(profile, levers, sweepYear, company),
    sweep: sweepIsoExercise(profile, levers, sweepYear, 40, company),
    recovery: creditRecovery(profile, levers, sweepYear, company, plan),
    hold: holdOrSell(profile, levers, sweepYear, company),
  })), [profile, levers, sweepYear, isoCompanies, plan]);
  const crossovers = useMemo(() => byCompany.map((c) => c.crossover), [byCompany]);
  return { plan, isoCompanies, crossovers, byCompany };
}
