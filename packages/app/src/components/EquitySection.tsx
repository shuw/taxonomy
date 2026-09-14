import { grantFmv, nextShareSpread, rsuVesting, sharesExercisable, sharesGranted, vestingOf, type AmtCrossover, type EquityGrant, type GrantType, type Levers, type Profile, type ProfileEdit } from "@taxonomy/engine";
import { shares, usd, usdCompact } from "../format.ts";
import { Field, MoneyInput, NumberInput, Segmented, Select } from "./fields.tsx";
import { Section } from "./Section.tsx";

interface Props {
  profile: Profile;
  levers: Levers;
  crossovers: AmtCrossover[];
  years: number[];
  focusYear: number;
  onFocus: (year: number) => void;
  onExercise: (type: "iso" | "nso", year: number, shares: number) => void;
  edit: (edits: ProfileEdit[]) => void;
  onOpenAssistant: () => void;
}

const TYPE_LABEL: Record<GrantType, string> = { iso: "ISO", nso: "NSO", rsu: "RSU" };
const TYPE_OPTIONS = [{ value: "iso", label: "ISO" }, { value: "nso", label: "NSO / NQSO" }, { value: "rsu", label: "RSU" }] as const;
const CADENCE_OPTIONS = [{ value: "monthly", label: "monthly" }, { value: "quarterly", label: "quarterly" }, { value: "annual", label: "annual" }] as const;

export function EquitySection({ profile, levers, crossovers, years, focusYear, onFocus, onExercise, edit, onOpenAssistant }: Props) {
  const grants = profile.equity.grants;
  const set = (path: (string | number)[], value: unknown) => edit([{ path, value }]);
  const setGrant = (i: number, patch: Partial<EquityGrant>) => set(["equity", "grants"], grants.map((g, j) => (j === i ? clean({ ...g, ...patch }) : g)));
  const hasType = (t: GrantType) => grants.some((g) => g.type === t);
  const exercisedIso = Object.values(levers.exercises.iso).reduce((s, n) => s + n, 0);
  const summary = grants.length === 0
    ? "no grants yet"
    : [hasType("iso") && `${shares(exercisedIso)} ISO exercised`, hasType("rsu") && `${shares(sharesGranted(profile, "rsu"))} RSU`, hasType("nso") && `${shares(sharesGranted(profile, "nso"))} NSO`].filter(Boolean).join(" · ") + ` · ${usd(profile.equity.sharePrice)}/sh`;

  return (
    <Section id="equity" title="Equity" color="var(--series-amt)" defaultOpen summary={summary}>
      <div className="assist-cta">
        <button type="button" className="btn primary" onClick={onOpenAssistant}>Paste a screenshot or describe your grants</button>
        <span className="muted small" style={{ margin: 0 }}>The assistant fills this in; you approve each change.</span>
      </div>

      <Field label="Share value now" hint="409A or market price, per share" wide><MoneyInput value={profile.equity.sharePrice} onChange={(n) => set(["equity", "sharePrice"], n)} decimals={2} /></Field>

      {hasType("iso") && (
        <>
          <div className="subhead">Exercise ISOs</div>
          <p className="muted small">Spread goes to AMT, not regular income. The orange mark is where AMT begins.</p>
          {crossovers.map((c) => <ExerciseLever key={c.year} year={c.year} available={c.available} value={Math.min(levers.exercises.iso[c.year] ?? 0, c.available)} mark={c.available > 0 && c.sharesBeforeAmt < c.available ? c.sharesBeforeAmt : null} over={c.overCrossover} sharesBeforeAmt={c.sharesBeforeAmt} spread={nextShareSpread(profile, "iso", c.year)} focus={c.year === focusYear} onFocus={onFocus} onChange={(n) => onExercise("iso", c.year, n)} />)}
        </>
      )}

      {hasType("nso") && (
        <>
          <div className="subhead">Exercise NSOs</div>
          <p className="muted small">Spread is ordinary wage income the year you exercise.</p>
          {years.map((y) => {
            const available = sharesExercisable(profile, levers, "nso", y);
            return <ExerciseLever key={y} year={y} available={available} value={Math.min(levers.exercises.nso[y] ?? 0, available)} mark={null} over={false} sharesBeforeAmt={0} spread={nextShareSpread(profile, "nso", y)} focus={y === focusYear} onFocus={onFocus} onChange={(n) => onExercise("nso", y, n)} />;
          })}
        </>
      )}

      {hasType("rsu") && (
        <>
          <div className="subhead">RSU vesting</div>
          <p className="muted small">Units vest on the schedule and count as wages that year.</p>
          <div className="vest-rows">
            {years.map((y) => { const v = rsuVesting(profile, y); return <div key={y} className={"vest-row" + (y === focusYear ? " focus" : "")} onClick={() => onFocus(y)}><span className="vest-year">{y}</span><span>{shares(v.shares)} units</span><span className="mono">{usdCompact(v.income)}</span></div>; })}
          </div>
        </>
      )}

      <div className="subhead">Grants</div>
      {grants.map((g, i) => <GrantCard key={i} grant={g} profile={profile} onChange={(patch) => setGrant(i, patch)} onRemove={() => set(["equity", "grants"], grants.filter((_, j) => j !== i))} />)}
      <div className="add-grant">
        {TYPE_OPTIONS.map((t) => (
          <button type="button" key={t.value} className="link" onClick={() => set(["equity", "grants"], [...grants, blankGrant(t.value, grants.length + 1, profile.plan.startYear)])}>+ {t.label}</button>
        ))}
      </div>
      <Field label="AMT credit already banked" hint="from earlier years" wide><MoneyInput value={profile.equity.amtCreditCarryforward ?? 0} onChange={(n) => set(["equity", "amtCreditCarryforward"], n)} /></Field>
    </Section>
  );
}

function blankGrant(type: GrantType, n: number, startYear: number): EquityGrant {
  const g: EquityGrant = { name: `${TYPE_LABEL[type]} grant ${n}`, type, shares: 1000 };
  if (type !== "rsu") g.strike = 1;
  g.schedule = { start: `${startYear - 1}-01-01`, years: 4, cliffMonths: 12, cadence: type === "rsu" ? "quarterly" : "monthly" };
  return g;
}

/** Drop keys the YAML should not carry (undefined values, strike on RSUs). */
function clean(g: EquityGrant): EquityGrant {
  const out: EquityGrant = { name: g.name, type: g.type, shares: g.shares };
  if (g.type !== "rsu" && g.strike !== undefined) out.strike = g.strike;
  if (g.fmv !== undefined) out.fmv = g.fmv;
  if (g.vested !== undefined) out.vested = g.vested;
  if (g.schedule) out.schedule = g.schedule;
  else if (g.vesting) out.vesting = g.vesting;
  return out;
}

function GrantCard({ grant: g, profile, onChange, onRemove }: { grant: EquityGrant; profile: Profile; onChange: (patch: Partial<EquityGrant>) => void; onRemove: () => void }) {
  const v = vestingOf(profile, g);
  const mode: "schedule" | "years" | "none" = g.schedule ? "schedule" : g.vesting ? "years" : "none";
  const years = Array.from({ length: profile.plan.years }, (_, i) => profile.plan.startYear + i);
  const upcoming = years.map((y) => v.byYear[y] ?? 0);
  const spread = g.type === "rsu" ? null : Math.max(0, grantFmv(profile, g, profile.plan.startYear) - (g.strike ?? 0));
  return (
    <div className="grant">
      <div className="grant-head">
        <span className={"badge " + g.type}>{TYPE_LABEL[g.type]}</span>
        <input className="grant-name" value={g.name} onChange={(e) => onChange({ name: e.target.value })} aria-label="Grant name" />
        <button type="button" className="link danger" onClick={onRemove}>Remove</button>
      </div>
      <div className="row3">
        <Field label="Type"><Select options={[...TYPE_OPTIONS]} value={g.type} onChange={(t) => onChange({ type: t, strike: t === "rsu" ? undefined : (g.strike ?? 1) })} /></Field>
        <Field label={g.type === "rsu" ? "Units" : "Shares"}><NumberInput value={g.shares} onChange={(n) => onChange({ shares: Math.round(n) })} min={0} /></Field>
        {g.type !== "rsu"
          ? <Field label="Strike"><MoneyInput value={g.strike ?? 0} onChange={(n) => onChange({ strike: n })} decimals={2} /></Field>
          : <Field label="Value at vest"><span className="static">{usd(profile.equity.sharePrice)}/sh</span></Field>}
      </div>
      <div className="row2">
        <Field label={g.type === "rsu" ? "Already vested" : "Vested, unexercised"} hint={`at ${profile.plan.startYear}`}>
          <NumberInput value={g.vested ?? v.vestedAtStart} onChange={(n) => onChange({ vested: Math.max(0, Math.min(g.shares, Math.round(n))) })} min={0} />
        </Field>
        <Field label="Vesting">
          <Segmented options={[{ value: "schedule", label: "Schedule" }, { value: "years", label: "By year" }, { value: "none", label: "None" }]} value={mode}
            onChange={(m) => {
              if (m === "schedule") onChange({ schedule: g.schedule ?? { start: `${profile.plan.startYear - 1}-01-01`, years: 4, cliffMonths: 12, cadence: "monthly" }, vesting: undefined });
              else if (m === "years") onChange({ schedule: undefined, vesting: g.vesting ?? Object.fromEntries(years.map((y) => [y, 0])) });
              else onChange({ schedule: undefined, vesting: undefined, vested: g.vested ?? g.shares });
            }} />
        </Field>
      </div>
      {mode === "schedule" && g.schedule && (
        <div className="row4">
          <Field label="Vest start"><span className="input-wrap"><input type="date" value={g.schedule.start} onChange={(e) => onChange({ schedule: { ...g.schedule!, start: e.target.value } })} /></span></Field>
          <Field label="Years"><NumberInput value={g.schedule.years} onChange={(n) => onChange({ schedule: { ...g.schedule!, years: Math.max(0.25, n) } })} decimals={2} /></Field>
          <Field label="Cliff" hint="months"><NumberInput value={g.schedule.cliffMonths ?? 0} onChange={(n) => onChange({ schedule: { ...g.schedule!, cliffMonths: Math.max(0, Math.round(n)) } })} min={0} /></Field>
          <Field label="Cadence"><Select options={[...CADENCE_OPTIONS]} value={g.schedule.cadence ?? "monthly"} onChange={(c) => onChange({ schedule: { ...g.schedule!, cadence: c } })} /></Field>
        </div>
      )}
      {mode === "years" && g.vesting && (
        <div className="vest-grid">
          {years.map((y) => <Field key={y} label={String(y)}><NumberInput value={g.vesting?.[y] ?? 0} onChange={(n) => onChange({ vesting: { ...g.vesting, [y]: Math.max(0, Math.round(n)) } })} min={0} /></Field>)}
        </div>
      )}
      <div className="grant-foot muted">
        {mode !== "none" && upcoming.some((n) => n > 0) ? `Vests ${years.map((y, i) => upcoming[i] ? `${shares(upcoming[i]!)} in ${y}` : null).filter(Boolean).join(", ")}.` : "Nothing more vests in the plan."}
        {spread !== null && ` Spread ${usd(spread)}/sh today.`}
      </div>
    </div>
  );
}

interface LeverProps { year: number; available: number; value: number; mark: number | null; over: boolean; sharesBeforeAmt: number; spread: number; focus: boolean; onFocus: (y: number) => void; onChange: (n: number) => void; }

function ExerciseLever({ year, available, value, mark, over, sharesBeforeAmt, spread, focus, onFocus, onChange }: LeverProps) {
  const pct = (n: number) => (available > 0 ? (n / available) * 100 : 0);
  return (
    <div className={"lever" + (focus ? " focus" : "")}>
      <div className="head">
        <button type="button" className="year" onClick={() => onFocus(year)}>{year}</button>
        <NumberInput value={value} onChange={(n) => onChange(Math.min(available, n))} min={0} suffix="sh" />
      </div>
      <div className="track">
        <input type="range" className="range" min={0} max={available} step={available > 5000 ? 50 : 10} value={value} disabled={available === 0}
          style={{ "--pct": `${pct(value)}%` } as React.CSSProperties}
          onChange={(e) => onChange(Number(e.target.value))} onFocus={() => onFocus(year)} />
        {mark !== null && <div className="mark" style={{ left: `calc(9px + (100% - 18px) * ${pct(mark) / 100})` }} title={`AMT starts after ${shares(mark)} shares`} />}
      </div>
      <div className="foot">
        <span className={over ? "over" : ""}>
          {available === 0 ? "nothing exercisable" : mark === null ? "" : over ? `${shares(value - sharesBeforeAmt)} past the AMT line` : `AMT-free up to ${shares(sharesBeforeAmt)}`}
        </span>
        <span>{shares(available)} exercisable · {usd(spread)}/sh spread</span>
      </div>
    </div>
  );
}
