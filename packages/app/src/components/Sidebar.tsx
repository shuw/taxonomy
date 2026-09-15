import { statusName, timelineFields, type FieldDef, type Levers, type Profile, type ProfileEdit, type TimelineEntry } from "@taxonomy/engine";
import { pct, usdCompact } from "../format.ts";
import { EquityKnobs } from "./EquitySection.tsx";
import type { FactTab } from "./FactsModal.tsx";
import { FILING_OPTIONS, Field, MoneyInput, NumberInput, PercentInput, Select, STATE_OPTIONS, parseAmount } from "./fields.tsx";
import { Section } from "./Section.tsx";

export { sourceOf } from "../sources.ts";

interface Props {
  profile: Profile;
  levers: Levers;
  years: number[];
  edit: (edits: ProfileEdit[]) => void;
  onOpenFacts: (tab: FactTab) => void;
}

/** What you turn: a few basics, share prices, dated changes and assumptions. Decisions live on the timeline; the facts behind them in the information dialog. */
export function Sidebar({ profile, levers, years, edit, onOpenFacts }: Props) {
  const set = (path: (string | number)[], value: unknown) => edit([{ path, value }]);
  const self = profile.people.self;
  const spouse = profile.people.spouse;
  const a = profile.assumptions;
  const endYear = profile.plan.startYear + profile.plan.years - 1;
  const timeline = [...(profile.timeline ?? [])].sort((x, y) => x.year - y.year);

  return (
    <div className="sidebar-inner">
      <Section id="you" title="You" color="var(--accent)" defaultOpen summary={`${statusName(profile.filer.filingStatus)} · ${profile.filer.state} · ${usdCompact(self.salary)}${spouse ? ` + ${usdCompact(spouse.salary)}` : ""} · ${profile.plan.startYear}–${endYear}`}>
        <div className="row2">
          <Field label="Filing status"><Select options={[...FILING_OPTIONS]} value={profile.filer.filingStatus} onChange={(v) => set(["filer", "filingStatus"], v)} /></Field>
          <Field label="State"><Select options={STATE_OPTIONS} value={profile.filer.state} onChange={(v) => set(["filer", "state"], v)} /></Field>
          <Field label={spouse ? "Your salary" : "Base salary"}><MoneyInput value={self.salary} onChange={(n) => set(["people", "self", "salary"], n)} /></Field>
          {spouse && <Field label="Spouse's salary"><MoneyInput value={spouse.salary} onChange={(n) => set(["people", "spouse", "salary"], n)} /></Field>}
          <Field label="Years to plan" hint={`${profile.plan.startYear}–${endYear}`}><NumberInput value={profile.plan.years} onChange={(n) => set(["plan", "years"], Math.max(1, Math.min(15, Math.round(n))))} min={1} /></Field>
        </div>
        <button type="button" className="link" onClick={() => onOpenFacts("you")}>Bonus, pre-tax, dependents →</button>
      </Section>

      <EquityKnobs profile={profile} levers={levers} edit={edit} onOpenFacts={() => onOpenFacts("equity")} />

      <Section id="timeline" title="Changes over time" color="var(--series-regular)" summary={timeline.length ? timeline.map((t) => `${t.year}: ${labelOf(t.path)}`).join(" · ") : "nothing changes"}>
        <p className="muted small">A dated change to any fact, in force from that year on. Growth assumptions still apply from the plan start.</p>
        {timeline.map((t, i) => <TimelineRow key={i} entry={t} years={years} onChange={(e) => set(["timeline"], timeline.map((x, j) => (j === i ? e : x)))} onRemove={() => set(["timeline"], timeline.filter((_, j) => j !== i))} />)}
        <button type="button" className="link" onClick={() => set(["timeline"], [...timeline, { year: years[1] ?? years[0]!, path: "people.self.salary", value: self.salary }])}>+ Add a change</button>
      </Section>

      <Section id="assumptions" title="Assumptions" color="var(--muted)" summary={`shares ${a.fmvGrowth >= 0 ? "+" : ""}${pct(a.fmvGrowth)}/yr · wages +${pct(a.wageGrowth)}/yr · CPI ${pct(a.inflation)}${a.bracketRateDelta ? ` · rates ${a.bracketRateDelta > 0 ? "+" : ""}${pct(a.bracketRateDelta)}` : ""}`}>
        <div className="row3">
          <Field label="Share value growth" hint="/yr"><PercentInput value={a.fmvGrowth} onChange={(n) => set(["assumptions", "fmvGrowth"], n)} /></Field>
          <Field label="Wage growth" hint="/yr"><PercentInput value={a.wageGrowth} onChange={(n) => set(["assumptions", "wageGrowth"], n)} /></Field>
          <Field label="Inflation" hint="indexes brackets"><PercentInput value={a.inflation} onChange={(n) => set(["assumptions", "inflation"], n)} /></Field>
        </div>
        <Field label="Bracket rate shift" hint="added to every rate; put it on the timeline to start in a later year" wide><PercentInput value={a.bracketRateDelta ?? 0} onChange={(n) => set(["assumptions", "bracketRateDelta"], n || undefined)} /></Field>
        {profile.filer.state === "WA" && (
          <>
            <div className="subhead">Washington</div>
            <label className="switch"><input type="checkbox" checked={a.state?.waCapitalGainsTax !== false} onChange={(e) => set(["assumptions", "state", "waCapitalGainsTax"], e.target.checked ? undefined : false)} /><span><strong>Capital gains excise tax</strong> · 7% on long-term gains over about $285k. Law since 2022.</span></label>
            <label className="switch"><input type="checkbox" checked={a.state?.waCapitalGainsSurtax !== false} onChange={(e) => set(["assumptions", "state", "waCapitalGainsSurtax"], e.target.checked ? undefined : false)} /><span><strong>2.9% surtax</strong> · on gains over $1M. Law since 2025.</span></label>
            <label className="switch"><input type="checkbox" checked={a.state?.waMillionairesTax !== false} onChange={(e) => set(["assumptions", "state", "waMillionairesTax"], e.target.checked ? undefined : false)} /><span><strong>Millionaires' tax</strong> · 9.9% on income over $1M per household, from 2028. Signed March 2026; facing a court challenge and a repeal initiative, so switch it off to see that outcome.</span></label>
            <p className="muted small">Any of these can start in a later year from "Changes over time".</p>
          </>
        )}
      </Section>
    </div>
  );
}

const labelOf = (path: string) => timelineFields().find((f) => f.path === path)?.label ?? path;

function TimelineRow({ entry, years, onChange, onRemove }: { entry: TimelineEntry; years: number[]; onChange: (e: TimelineEntry) => void; onRemove: () => void }) {
  const fields = timelineFields();
  const f: FieldDef | undefined = fields.find((x) => x.path === entry.path);
  const valueInput = f?.type === "bool"
    ? <Select options={[{ value: "true", label: "on" }, { value: "false", label: "off" }]} value={String(entry.value === true)} onChange={(v) => onChange({ ...entry, value: v === "true" })} />
    : f?.type === "enum"
    ? <Select options={(f.enum ?? []).map((v) => ({ value: v, label: v }))} value={String(entry.value)} onChange={(v) => onChange({ ...entry, value: v })} />
    : f?.type === "pct"
      ? <PercentInput value={Number(entry.value) || 0} onChange={(n) => onChange({ ...entry, value: n })} />
      : f?.type === "usd"
        ? <MoneyInput value={Number(entry.value) || 0} onChange={(n) => onChange({ ...entry, value: n })} />
        : <span className="input-wrap"><input value={String(entry.value ?? "")} onChange={(e) => onChange({ ...entry, value: parseAmount(e.target.value) ?? e.target.value })} /></span>;
  return (
    <div className="grant timeline-row">
      <div className="row3">
        <Field label="From"><Select options={years.map((y) => ({ value: String(y), label: String(y) }))} value={String(entry.year)} onChange={(y) => onChange({ ...entry, year: Number(y) })} /></Field>
        <Field label="What changes"><Select options={fields.map((x) => ({ value: x.path, label: x.label }))} value={entry.path} onChange={(p) => { const t = fields.find((x) => x.path === p)?.type; onChange({ ...entry, path: p, value: t === "enum" ? fields.find((x) => x.path === p)!.enum![0] : t === "bool" ? true : 0 }); }} /></Field>
        <Field label="To">{valueInput}</Field>
      </div>
      <div className="grant-head">
        <input className="grant-name" placeholder="note (optional)" value={entry.note ?? ""} onChange={(e) => onChange({ ...entry, note: e.target.value || undefined })} />
        <button type="button" className="link danger" onClick={onRemove}>Remove</button>
      </div>
    </div>
  );
}
