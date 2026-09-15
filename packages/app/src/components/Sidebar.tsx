import { statusName, type Levers, type Profile, type ProfileEdit } from "@taxonomy/engine";
import { pct, usdCompact } from "../format.ts";
import { EquityKnobs } from "./EquitySection.tsx";
import type { FactTab } from "./FactsModal.tsx";
import { FILING_OPTIONS, Field, MoneyInput, PercentInput, Select, STATE_OPTIONS } from "./fields.tsx";
import { Section } from "./Section.tsx";

export { sourceOf } from "../sources.ts";

interface Props {
  profile: Profile;
  levers: Levers;
  years: number[];
  edit: (edits: ProfileEdit[]) => void;
  onOpenFacts: (tab: FactTab) => void;
}

/** What you turn: a few basics, share prices and assumptions. Decisions and dated changes live on the timeline; the facts behind them in the information dialog. */
export function Sidebar({ profile, levers, years, edit, onOpenFacts }: Props) {
  const set = (path: (string | number)[], value: unknown) => edit([{ path, value }]);
  const self = profile.people.self;
  const spouse = profile.people.spouse;
  const a = profile.assumptions;
  const endYear = profile.plan.startYear + profile.plan.years - 1;

  return (
    <div className="sidebar-inner">
      <Section id="you" title="You" color="var(--accent)" defaultOpen summary={`${statusName(profile.filer.filingStatus)} · ${profile.filer.state} · ${usdCompact(self.salary)}${spouse ? ` + ${usdCompact(spouse.salary)}` : ""} · ${profile.plan.startYear}–${endYear}`}>
        <div className="row2">
          <Field label="Filing status"><Select options={[...FILING_OPTIONS]} value={profile.filer.filingStatus} onChange={(v) => set(["filer", "filingStatus"], v)} /></Field>
          <Field label="State"><Select options={STATE_OPTIONS} value={profile.filer.state} onChange={(v) => set(["filer", "state"], v)} /></Field>
          <Field label={spouse ? "Your salary" : "Base salary"}><MoneyInput value={self.salary} onChange={(n) => set(["people", "self", "salary"], n)} /></Field>
          {spouse && <Field label="Spouse's salary"><MoneyInput value={spouse.salary} onChange={(n) => set(["people", "spouse", "salary"], n)} /></Field>}
        </div>
        <button type="button" className="link" onClick={() => onOpenFacts("you")}>Bonus, pre-tax, dependents, first plan year →</button>
      </Section>

      <EquityKnobs profile={profile} levers={levers} edit={edit} onOpenFacts={() => onOpenFacts("equity")} />

      <Section id="assumptions" title="Assumptions" color="var(--muted)" defaultOpen summary={`shares ${a.fmvGrowth >= 0 ? "+" : ""}${pct(a.fmvGrowth)}/yr · wages +${pct(a.wageGrowth)}/yr · CPI ${pct(a.inflation)}${a.bracketRateDelta ? ` · rates ${a.bracketRateDelta > 0 ? "+" : ""}${pct(a.bracketRateDelta)}` : ""}`}>
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
            <p className="muted small">To start any of these in a later year, press + under that year on the timeline and pick it under Assumptions.</p>
          </>
        )}
      </Section>
      <div className="sidebar-foot">
        <button type="button" className="link muted" onClick={resetView} title="Forget which sections and cards are open, the focused year, dismissed suggestions and the selected decision. Your data and theme stay.">Reset view</button>
      </div>
    </div>
  );
}

/** Clear remembered UI state (not data, not the theme) and reload. */
function resetView() {
  try {
    const keep = new Set(["taxonomy.profile", "taxonomy.theme"]);
    for (const k of Object.keys(localStorage)) if (k.startsWith("taxonomy.") && !keep.has(k)) localStorage.removeItem(k);
  } catch {}
  location.hash = "";
  location.reload();
}
