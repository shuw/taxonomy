import { useMemo } from "react";
import { nextShareSpread, sharesExercisable, type AmtCrossover, type Levers, type Profile, type ScenarioEvent, amtCrossover } from "@taxonomy/engine";
import { shares } from "../../format.ts";
import { LeverRow } from "../LeverRow.tsx";
import { DateField, InspectorShell, YearSelect } from "./InspectorShell.tsx";

type ExerciseEvent = Extract<ScenarioEvent, { kind: "exercise" }>;

interface Props { profile: Profile; levers: Levers; years: number[]; event: ExerciseEvent; crossovers: AmtCrossover[]; companyLabel: string; onChange: (patch: Partial<ScenarioEvent>) => void; onRemove: () => void; }

export function ExerciseInspector({ profile, levers, years, event: e, crossovers, companyLabel, onChange, onRemove }: Props) {
  const company = e.company ?? profile.equity.companies[0]?.id ?? "*";
  // The passed crossovers follow the hovered year; this event keeps its own.
  const cross = useMemo(() => e.type === "iso" ? (crossovers.find((c) => c.year === e.year && c.company === company) ?? amtCrossover(profile, levers, e.year, company)) : undefined, [profile, levers, crossovers, e.type, e.year, company]);
  const available = e.type === "iso" ? (cross?.available ?? 0) : sharesExercisable(profile, levers, "nso", e.year, company);
  const value = Math.min(e.shares, available);
  const hasMark = e.type === "iso" && !!cross && cross.available > 0 && cross.sharesBeforeAmt < cross.available;
  return (
    <InspectorShell title={`Exercise ${e.type.toUpperCase()}s${companyLabel ? ` · ${companyLabel}` : ""}`} onRemove={onRemove}
      head={<>
        <span className="muted">on</span>
        <DateField value={e.date} fallback={`${e.year}-01-01`} onChange={(d) => onChange({ date: d, ...(d ? { year: Number(d.slice(0, 4)) } : {}) })} />
        <YearSelect years={years} value={e.year} onChange={(y) => onChange({ year: y, date: undefined })} />
      </>}>
      <LeverRow label={e.type.toUpperCase()} year={e.year} hint={e.type === "iso" ? "The spread (share price minus strike) counts toward AMT, not regular tax." : "The spread (share price minus strike) is taxed as wages."} available={available} value={value}
        mark={hasMark ? cross!.sharesBeforeAmt : null} over={e.type === "iso" && !!cross && value > cross.sharesBeforeAmt} sharesBeforeAmt={cross?.sharesBeforeAmt ?? 0}
        spread={nextShareSpread(profile, e.type, e.year, company)} onChange={(n) => onChange({ shares: Math.max(0, Math.round(n)) })} />
      {e.shares > available && <p className="muted small">Only {shares(available)} are exercisable in {e.year}; the rest is ignored.</p>}
    </InspectorShell>
  );
}
