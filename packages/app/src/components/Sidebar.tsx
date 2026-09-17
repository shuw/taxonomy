import { clearRemembered } from "../persist.ts";
import { Info } from "./Info.tsx";
import { demo, setDemo } from "../format.ts";
import { statusName, type Levers, type Profile, type ProfileEdit } from "@taxonomy/engine";
import { pct, usdCompact } from "../format.ts";
import { EquityKnobs } from "./EquitySection.tsx";
import type { FactTab } from "./FactsModal.tsx";
import { FILING_OPTIONS, Field, MoneyInput, PercentInput, Select, STATE_OPTIONS } from "./fields.tsx";
import { Section } from "./Section.tsx";

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

      <Section id="assumptions" title="Assumptions" color="var(--muted)" defaultOpen summary={`wages +${pct(a.wageGrowth)}/yr · CPI ${pct(a.inflation)}${a.bracketRateDelta ? ` · rates ${a.bracketRateDelta > 0 ? "+" : ""}${pct(a.bracketRateDelta)}` : ""}`}>
        <div className="row2">
          <Field label="Wage growth" hint="/yr"><PercentInput value={a.wageGrowth} onChange={(n) => set(["assumptions", "wageGrowth"], n)} /></Field>
          <Field label="Inflation" hint="indexes brackets"><PercentInput value={a.inflation} onChange={(n) => set(["assumptions", "inflation"], n)} /></Field>
        </div>
        <Field label="Bracket rate shift" hint="added to every bracket" wide><PercentInput value={a.bracketRateDelta ?? 0} onChange={(n) => set(["assumptions", "bracketRateDelta"], n || undefined)} /></Field>
        {profile.filer.state === "WA" && (
          <>
            <div className="subhead">Washington <Info label="About the Washington taxes">Capital gains excise tax: 7% on long-term gains over about $285k, law since 2022. Surtax: 2.9% more on gains over $1M, since 2025. Millionaires' tax: 9.9% on income over $1M per household from 2028, signed March 2026 and facing a court challenge and a repeal initiative; switch it off to see that outcome. To start or stop any of these in a later year, press + under that year and pick it under Assumptions.</Info></div>
            <label className="switch"><input type="checkbox" checked={a.state?.waCapitalGainsTax !== false} onChange={(e) => set(["assumptions", "state", "waCapitalGainsTax"], e.target.checked ? undefined : false)} /><span><strong>Capital gains excise tax</strong> · 7% over $285k</span></label>
            <label className="switch"><input type="checkbox" checked={a.state?.waCapitalGainsSurtax !== false} onChange={(e) => set(["assumptions", "state", "waCapitalGainsSurtax"], e.target.checked ? undefined : false)} /><span><strong>2.9% surtax</strong> · gains over $1M</span></label>
            <label className="switch"><input type="checkbox" checked={a.state?.waMillionairesTax !== false} onChange={(e) => set(["assumptions", "state", "waMillionairesTax"], e.target.checked ? undefined : false)} /><span><strong>Millionaires' tax</strong> · 9.9% over $1M, from 2028</span></label>
          </>
        )}
      </Section>
      <div className="sidebar-foot">
        <button type="button" className="link muted" onClick={resetView} title="Forget which sections and cards are open, the focused year, dismissed suggestions and the selected decision. Your data and theme stay.">Reset view</button>
        <button type="button" className="link muted" onClick={() => setDemo(!demo.on)} title="Show every amount in a made-up currency at a fixed scale, for screenshots and screen shares. Your file is unchanged.">{demo.on ? "Leave demo mode" : "Demo mode"}</button>
      </div>
    </div>
  );
}

/** Clear remembered UI state (not data, not the theme) and reload. */
function resetView() {
  // Cleared again on boot (persist.ts), so nothing written during unmount survives.
  try { sessionStorage.setItem("taxonomy.reset", "1"); } catch {}
  clearRemembered();
  location.hash = "";
  location.reload();
}
