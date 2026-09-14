import { statusName, type AmtCrossover, type Levers, type Profile, type ProfileEdit } from "@taxonomy/engine";
import { pct, usdCompact } from "../format.ts";
import { EquitySection } from "./EquitySection.tsx";
import { FILING_OPTIONS, Field, MoneyInput, NumberInput, PercentInput, Segmented, Select, STATE_OPTIONS } from "./fields.tsx";
import { Section } from "./Section.tsx";

interface Props {
  profile: Profile;
  levers: Levers;
  crossovers: AmtCrossover[];
  focusYear: number;
  onFocus: (year: number) => void;
  years: number[];
  onExercise: (type: "iso" | "nso", year: number, shares: number) => void;
  edit: (edits: ProfileEdit[]) => void;
  onOpenAssistant: () => void;
}

export function Sidebar({ profile, levers, crossovers, years, focusYear, onFocus, onExercise, edit, onOpenAssistant }: Props) {
  const set = (path: (string | number)[], value: unknown) => edit([{ path, value }]);
  const inc = profile.income, ded = profile.deductions, a = profile.assumptions;
  const endYear = profile.plan.startYear + profile.plan.years - 1;
  const investment = (inc.interest ?? 0) + (inc.qualifiedDividends ?? 0) + (inc.longTermGains ?? 0) + (inc.shortTermGains ?? 0) + (inc.otherOrdinary ?? 0);
  const itemized = (ded.mortgageInterest ?? 0) + (ded.propertyTax ?? 0) + (ded.stateIncomeTax ?? 0) + (ded.charitable ?? 0);

  return (
    <div className="sidebar-inner">
      <Section id="you" title="You" color="var(--accent)" summary={`${statusName(profile.filer.filingStatus)} · ${profile.filer.state} · ${usdCompact(inc.wages)} salary · ${profile.plan.startYear}–${endYear}`}>
        <Field label="Filing status" wide><Segmented options={[...FILING_OPTIONS]} columns={2} value={profile.filer.filingStatus} onChange={(v) => set(["filer", "filingStatus"], v)} /></Field>
        <Field label="State" wide><Select options={STATE_OPTIONS} value={profile.filer.state} onChange={(v) => set(["filer", "state"], v)} /></Field>
        <Field label="Annual salary" wide><MoneyInput value={inc.wages} onChange={(n) => set(["income", "wages"], n)} /></Field>
        <div className="row2">
          <Field label="First year"><NumberInput value={profile.plan.startYear} onChange={(n) => set(["plan", "startYear"], Math.round(n))} min={2026} grouping={false} /></Field>
          <Field label="Years"><NumberInput value={profile.plan.years} onChange={(n) => set(["plan", "years"], Math.max(1, Math.min(15, Math.round(n))))} min={1} /></Field>
        </div>
      </Section>

      <EquitySection profile={profile} levers={levers} crossovers={crossovers} years={years} focusYear={focusYear} onFocus={onFocus} onExercise={onExercise} edit={edit} onOpenAssistant={onOpenAssistant} />

      <Section id="income" title="Other income" color="var(--series-surtax)" summary={investment > 0 ? `${usdCompact(investment)} beyond salary` : "nothing beyond salary"}>
        <div className="row2">
          <Field label="Interest"><MoneyInput value={inc.interest ?? 0} onChange={(n) => set(["income", "interest"], n)} /></Field>
          <Field label="Qualified dividends"><MoneyInput value={inc.qualifiedDividends ?? 0} onChange={(n) => set(["income", "qualifiedDividends"], n)} /></Field>
          <Field label="Long-term gains"><MoneyInput value={inc.longTermGains ?? 0} onChange={(n) => set(["income", "longTermGains"], n)} /></Field>
          <Field label="Short-term gains"><MoneyInput value={inc.shortTermGains ?? 0} onChange={(n) => set(["income", "shortTermGains"], n)} /></Field>
        </div>
        <Field label="Other ordinary income" hint="bonus, RSU vests, side income" wide><MoneyInput value={inc.otherOrdinary ?? 0} onChange={(n) => set(["income", "otherOrdinary"], n)} /></Field>
      </Section>

      <Section id="deductions" title="Deductions" color="var(--series-state)" summary={itemized > 0 ? `${usdCompact(itemized)} itemizable` : "standard deduction"}>
        <div className="row2">
          <Field label="Mortgage interest"><MoneyInput value={ded.mortgageInterest ?? 0} onChange={(n) => set(["deductions", "mortgageInterest"], n)} /></Field>
          <Field label="Property tax"><MoneyInput value={ded.propertyTax ?? 0} onChange={(n) => set(["deductions", "propertyTax"], n)} /></Field>
          <Field label="State income tax"><MoneyInput value={ded.stateIncomeTax ?? 0} onChange={(n) => set(["deductions", "stateIncomeTax"], n)} /></Field>
          <Field label="Charitable gifts"><MoneyInput value={ded.charitable ?? 0} onChange={(n) => set(["deductions", "charitable"], n)} /></Field>
        </div>
      </Section>

      <Section id="assumptions" title="Assumptions" color="var(--series-violet)" summary={`shares ${a.fmvGrowth >= 0 ? "+" : ""}${pct(a.fmvGrowth)}/yr · wages +${pct(a.wageGrowth)}/yr · CPI ${pct(a.inflation)}`}>
        <div className="row3">
          <Field label="Share value growth" hint="/yr"><PercentInput value={a.fmvGrowth} onChange={(n) => set(["assumptions", "fmvGrowth"], n)} /></Field>
          <Field label="Wage growth" hint="/yr"><PercentInput value={a.wageGrowth} onChange={(n) => set(["assumptions", "wageGrowth"], n)} /></Field>
          <Field label="Inflation" hint="indexes brackets"><PercentInput value={a.inflation} onChange={(n) => set(["assumptions", "inflation"], n)} /></Field>
        </div>
      </Section>
    </div>
  );
}
