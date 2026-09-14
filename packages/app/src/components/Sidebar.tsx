import { fmvInYear, statusName, type AmtCrossover, type Levers, type Profile, type ProfileEdit } from "@taxonomy/engine";
import { pct, shares, usd, usdCompact } from "../format.ts";
import { FILING_OPTIONS, Field, MoneyInput, NumberInput, PercentInput, Segmented, Select, STATE_OPTIONS } from "./fields.tsx";
import { Section } from "./Section.tsx";

interface Props {
  profile: Profile;
  levers: Levers;
  crossovers: AmtCrossover[];
  focusYear: number;
  onFocus: (year: number) => void;
  onExercise: (year: number, shares: number) => void;
  edit: (edits: ProfileEdit[]) => void;
}

export function Sidebar({ profile, levers, crossovers, focusYear, onFocus, onExercise, edit }: Props) {
  const set = (path: (string | number)[], value: unknown) => edit([{ path, value }]);
  const inc = profile.income, ded = profile.deductions, a = profile.assumptions;
  const endYear = profile.plan.startYear + profile.plan.years - 1;
  const totalShares = profile.equity.isoGrants.reduce((s, g) => s + g.shares, 0);
  const exercised = Object.values(levers.isoExercises).reduce((s, n) => s + n, 0);
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

      <Section id="iso" title="ISO exercises" color="var(--series-amt)" defaultOpen
        summary={totalShares === 0 ? "no grants" : `${shares(exercised)} of ${shares(totalShares)} sh · ${crossovers[0] ? `AMT-free to ${shares(crossovers[0].sharesBeforeAmt)} in ${crossovers[0].year}` : ""}`}>
        {totalShares === 0
          ? <p className="muted small">Add a grant below to get the lever.</p>
          : <>
              <p className="muted small">Shares to exercise each year. The orange mark on each track is where AMT begins.</p>
              {crossovers.map((c) => {
                const value = Math.min(levers.isoExercises[c.year] ?? 0, c.available);
                const markPct = c.available > 0 ? (c.sharesBeforeAmt / c.available) * 100 : 0;
                const valuePct = c.available > 0 ? (value / c.available) * 100 : 0;
                const grant = profile.equity.isoGrants[0];
                const spread = grant ? Math.max(0, fmvInYear(profile, grant.fmv, c.year) - grant.strike) : 0;
                return (
                  <div className={"lever" + (c.year === focusYear ? " focus" : "")} key={c.year}>
                    <div className="head">
                      <button type="button" className="year" onClick={() => onFocus(c.year)}>{c.year}</button>
                      <NumberInput value={value} onChange={(n) => onExercise(c.year, Math.min(c.available, n))} min={0} suffix="sh" />
                    </div>
                    <div className="track">
                      <input type="range" className="range" min={0} max={c.available} step={c.available > 5000 ? 50 : 10} value={value} disabled={c.available === 0}
                        style={{ "--pct": `${valuePct}%` } as React.CSSProperties}
                        onChange={(e) => onExercise(c.year, Number(e.target.value))} onFocus={() => onFocus(c.year)} />
                      {c.available > 0 && c.sharesBeforeAmt < c.available && <div className="mark" style={{ left: `calc(9px + (100% - 18px) * ${markPct / 100})` }} title={`AMT starts after ${shares(c.sharesBeforeAmt)} shares`} />}
                    </div>
                    <div className="foot">
                      <span className={c.overCrossover ? "over" : ""}>
                        {c.available === 0 ? "nothing left" : c.overCrossover ? `${shares(value - c.sharesBeforeAmt)} past the AMT line` : `AMT-free up to ${shares(c.sharesBeforeAmt)}`}
                      </span>
                      <span>{shares(c.available)} left · {usd(spread)}/sh spread</span>
                    </div>
                  </div>
                );
              })}
            </>}
        <div className="subhead">Grants</div>
        {profile.equity.isoGrants.map((g, i) => (
          <div className="grant" key={i}>
            <input className="grant-name" value={g.name} onChange={(e) => set(["equity", "isoGrants", i, "name"], e.target.value)} />
            <div className="row3">
              <Field label="Strike"><MoneyInput value={g.strike} onChange={(n) => set(["equity", "isoGrants", i, "strike"], n)} decimals={2} /></Field>
              <Field label="Value now"><MoneyInput value={g.fmv} onChange={(n) => set(["equity", "isoGrants", i, "fmv"], n)} decimals={2} /></Field>
              <Field label="Shares"><NumberInput value={g.shares} onChange={(n) => set(["equity", "isoGrants", i, "shares"], Math.round(n))} min={0} /></Field>
            </div>
            <button type="button" className="link danger" onClick={() => set(["equity", "isoGrants"], profile.equity.isoGrants.filter((_, j) => j !== i))}>Remove grant</button>
          </div>
        ))}
        <button type="button" className="link" onClick={() => set(["equity", "isoGrants"], [...profile.equity.isoGrants, { name: `Grant ${profile.equity.isoGrants.length + 1}`, strike: 1, fmv: 10, shares: 1000 }])}>+ Add grant</button>
        <Field label="AMT credit already banked" hint="from earlier years" wide><MoneyInput value={profile.equity.amtCreditCarryforward ?? 0} onChange={(n) => set(["equity", "amtCreditCarryforward"], n)} /></Field>
      </Section>

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
