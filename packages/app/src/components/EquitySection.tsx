import { companyOf, grantFmv, grantsMissingVesting, newId, nextShareSpread, rsuVesting, sharesExercisable, sharesGranted, sharesOutstanding, vestedThrough, vestingOf, type AmtCrossover, type Company, type EquityGrant, type GrantType, type Levers, type Profile, type ProfileEdit } from "@taxonomy/engine";
import { pct, shares, usd, usdCompact } from "../format.ts";
import { Field, MoneyInput, NumberInput, PercentInput, Segmented, Select } from "./fields.tsx";
import { Section } from "./Section.tsx";
import { sourceOf } from "./Sidebar.tsx";

interface Props {
  profile: Profile;
  levers: Levers;
  crossovers: AmtCrossover[];
  years: number[];
  focusYear: number;
  onFocus: (year: number) => void;
  onExercise: (type: "iso" | "nso", year: number, shares: number) => void;
  edit: (edits: ProfileEdit[]) => void;
}

const TYPE_LABEL: Record<GrantType, string> = { iso: "ISO", nso: "NSO", rsu: "RSU" };
const TYPE_OPTIONS = [{ value: "iso", label: "ISO" }, { value: "nso", label: "NSO / NQSO" }, { value: "rsu", label: "RSU" }] as const;
const CADENCE_OPTIONS = [{ value: "monthly", label: "monthly" }, { value: "quarterly", label: "quarterly" }, { value: "annual", label: "annual" }] as const;

export function EquitySection({ profile, levers, crossovers, years, focusYear, onFocus, onExercise, edit }: Props) {
  const { companies, grants } = profile.equity;
  const set = (path: (string | number)[], value: unknown) => edit([{ path, value }]);
  const setGrant = (i: number, patch: Partial<EquityGrant>) => set(["equity", "grants"], grants.map((g, j) => (j === i ? clean({ ...g, ...patch }) : g)));
  const setCompany = (i: number, patch: Partial<Company>) => set(["equity", "companies"], companies.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const hasType = (t: GrantType) => grants.some((g) => g.type === t);
  const exercisedIso = Object.values(levers.exercises.iso).reduce((s, n) => s + n, 0);
  const missing = grantsMissingVesting(profile);
  const summary = grants.length === 0
    ? "no grants yet"
    : [hasType("iso") && `${shares(exercisedIso)} ISO exercised`, hasType("rsu") && `${shares(sharesGranted(profile, "rsu"))} RSU`, hasType("nso") && `${shares(sharesGranted(profile, "nso"))} NSO`].filter(Boolean).join(" · ") + (companies[0] ? ` · ${usd(companies[0].sharePrice)}/sh` : "");

  const addCompany = () => set(["equity", "companies"], [...companies, { id: newId("c", companies.map((c) => c.id)), name: `Company ${companies.length + 1}`, sharePrice: 10 }]);
  const addGrant = (type: GrantType) => {
    const id = newId("g", grants.map((g) => g.id));
    const g: EquityGrant = { id, name: `${TYPE_LABEL[type]} grant ${grants.length + 1}`, type, company: companies[0]?.id, granted: 1000, schedule: { start: `${profile.plan.startYear - 1}-01-01`, years: 4, cliffMonths: 12, cadence: type === "rsu" ? "quarterly" : "monthly" } };
    if (type !== "rsu") g.strike = 1;
    const edits: ProfileEdit[] = [];
    if (companies.length === 0) { edits.push({ path: ["equity", "companies"], value: [{ id: "c1", name: "Company", sharePrice: 10 }] }); g.company = "c1"; }
    edits.push({ path: ["equity", "grants"], value: [...grants, g] });
    edit(edits);
  };

  return (
    <Section id="equity" title="Equity" color="var(--series-amt)" defaultOpen summary={summary}>
      {missing.length > 0 && (
        <div className="notice">
          <strong>{missing.length === 1 ? "One grant has" : `${missing.length} grants have`} unvested shares but no vesting schedule</strong>, so nothing more of them vests in the plan: {missing.map((g) => g.name).join(", ")}. Set "Vesting" on each grant card below.
        </div>
      )}
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

      <div className="subhead">Companies</div>
      {companies.map((c, i) => (
        <div className="grant" key={c.id}>
          <div className="grant-head">
            <input className="grant-name" value={c.name} onChange={(e) => setCompany(i, { name: e.target.value })} aria-label="Company name" />
            {sourceOf(profile, ["companies", c.id, "sharePrice"]) && <span className="src" title={sourceOf(profile, ["companies", c.id, "sharePrice"])}>source</span>}
            {companies.length > 1 && <button type="button" className="link danger" onClick={() => set(["equity", "companies"], companies.filter((_, j) => j !== i))} disabled={grants.some((g) => (g.company ?? companies[0]?.id) === c.id)}>Remove</button>}
          </div>
          <div className="row3">
            <Field label="Share value" hint="per share now"><MoneyInput value={c.sharePrice} onChange={(n) => setCompany(i, { sharePrice: n })} decimals={2} /></Field>
            <Field label="As of"><span className="input-wrap"><input type="date" value={c.sharePriceAsOf ?? ""} onChange={(e) => setCompany(i, { sharePriceAsOf: e.target.value || undefined })} /></span></Field>
            <Field label="Growth" hint={c.growth === undefined ? `default ${pct(profile.assumptions.fmvGrowth)}` : "/yr"}><PercentInput value={c.growth ?? profile.assumptions.fmvGrowth} onChange={(n) => setCompany(i, { growth: n })} /></Field>
          </div>
          {grants.some((g) => g.type === "rsu" && g.settlement === "liquidity" && (g.company ?? companies[0]?.id) === c.id) && (
            <Field label="Liquidity event" hint="year double-trigger RSUs settle; blank means none in the plan" wide>
              <Select options={[{ value: "", label: "none in the plan" }, ...years.map((y) => ({ value: String(y), label: String(y) }))]} value={c.liquidityYear ? String(c.liquidityYear) : ""} onChange={(v) => setCompany(i, { liquidityYear: v ? Number(v) : undefined })} />
            </Field>
          )}
          <PricePath company={c} years={years} onChange={(pricePath) => setCompany(i, { pricePath })} />
        </div>
      ))}
      <button type="button" className="link" onClick={addCompany}>+ Add company</button>

      <div className="subhead">Grants</div>
      {grants.map((g, i) => <GrantCard key={g.id} grant={g} profile={profile} levers={levers} onChange={(patch) => setGrant(i, patch)} onRemove={() => set(["equity", "grants"], grants.filter((_, j) => j !== i))} />)}
      <div className="add-grant">
        {TYPE_OPTIONS.map((t) => <button type="button" key={t.value} className="link" onClick={() => addGrant(t.value)}>+ {t.label}</button>)}
      </div>

      {(profile.equity.holdings?.length ?? 0) > 0 && (
        <>
          <div className="subhead">Shares owned {sourceOf(profile, ["holdings"]) && <span className="src" title={sourceOf(profile, ["holdings"])}>source</span>}</div>
          <p className="muted small">Kept for the sales lever (coming next); not in the tax math yet.</p>
          <div className="vest-rows">
            {profile.equity.holdings!.map((h) => (
              <div key={h.id} className="vest-row holding">
                <span>{h.lot}{h.owner === "spouse" ? " (spouse)" : ""}</span>
                <span>{shares(h.quantity)} sh · {h.via.replace("_", " ")} · {h.acquired}</span>
                <span className="mono">basis {usd(h.costBasis)}{h.amtBasis !== undefined ? ` / AMT ${usd(h.amtBasis)}` : ""}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

function PricePath({ company, years, onChange }: { company: Company; years: number[]; onChange: (p: Record<number, number> | undefined) => void }) {
  const entries = Object.entries(company.pricePath ?? {}).map(([y, p]) => [Number(y), p] as const).sort((a, b) => a[0] - b[0]);
  const update = (list: (readonly [number, number])[]) => onChange(list.length ? Object.fromEntries(list) : undefined);
  return (
    <div className="price-path">
      {entries.map(([y, p], i) => (
        <div className="row3" key={i}>
          <Field label="Known price in"><NumberInput value={y} onChange={(n) => update(entries.map((e, j) => (j === i ? [Math.round(n), e[1]] as const : e)))} grouping={false} /></Field>
          <Field label="Per share"><MoneyInput value={p} onChange={(n) => update(entries.map((e, j) => (j === i ? [e[0], n] as const : e)))} decimals={2} /></Field>
          <button type="button" className="link danger" style={{ alignSelf: "end", paddingBottom: 8 }} onClick={() => update(entries.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <button type="button" className="link" onClick={() => update([...entries, [entries.length ? entries[entries.length - 1]![0] + 1 : years[1] ?? years[0]!, company.sharePrice * 2] as const])}>+ Known price in a later year (an IPO, a tender)</button>
    </div>
  );
}

/** Drop keys the YAML should not carry (undefined values, strike on RSUs). */
function clean(g: EquityGrant): EquityGrant {
  const out: EquityGrant = { id: g.id, name: g.name, type: g.type, granted: g.granted };
  if (g.company) out.company = g.company;
  if (g.owner) out.owner = g.owner;
  if (g.grantDate) out.grantDate = g.grantDate;
  if (g.vestedToDate !== undefined) out.vestedToDate = g.vestedToDate;
  if (g.type !== "rsu" && g.exercisedToDate !== undefined) out.exercisedToDate = g.exercisedToDate;
  if (g.type !== "rsu" && g.strike !== undefined) out.strike = g.strike;
  if (g.expires) out.expires = g.expires;
  if (g.type === "rsu" && g.settlement === "liquidity") out.settlement = "liquidity";
  if (g.schedule) out.schedule = g.schedule;
  else if (g.vesting) out.vesting = g.vesting;
  return out;
}

function GrantCard({ grant: g, profile, levers, onChange, onRemove }: { grant: EquityGrant; profile: Profile; levers: Levers; onChange: (patch: Partial<EquityGrant>) => void; onRemove: () => void }) {
  const source = sourceOf(profile, ["grants", g.id]);
  const v = vestingOf(profile, g);
  const mode: "schedule" | "years" | "none" = g.schedule ? "schedule" : g.vesting ? "years" : "none";
  const years = Array.from({ length: profile.plan.years }, (_, i) => profile.plan.startYear + i);
  const upcoming = years.map((y) => v.byYear[y] ?? 0);
  const spread = g.type === "rsu" ? null : Math.max(0, grantFmv(profile, g, profile.plan.startYear) - (g.strike ?? 0));
  const outstanding = sharesOutstanding(g);
  const exercisableNow = g.type === "rsu" ? null : vestedThrough(profile, g, profile.plan.startYear);
  const companies = profile.equity.companies;
  void levers;
  return (
    <div className="grant">
      <div className="grant-head">
        <span className={"badge " + g.type}>{TYPE_LABEL[g.type]}</span>
        <input className="grant-name" value={g.name} onChange={(e) => onChange({ name: e.target.value })} aria-label="Grant name" />
        {source && <span className="src" title={source}>source</span>}
        {profile.people.spouse && <Select options={[{ value: "self", label: "mine" }, { value: "spouse", label: "spouse's" }]} value={g.owner ?? "self"} onChange={(o) => onChange({ owner: o })} />}
        <button type="button" className="link danger" onClick={onRemove}>Remove</button>
      </div>
      <div className="row3">
        <Field label="Type"><Select options={[...TYPE_OPTIONS]} value={g.type} onChange={(t) => onChange({ type: t, strike: t === "rsu" ? undefined : (g.strike ?? 1), exercisedToDate: t === "rsu" ? undefined : g.exercisedToDate })} /></Field>
        <Field label={g.type === "rsu" ? "Units granted" : "Shares granted"}><NumberInput value={g.granted} onChange={(n) => onChange({ granted: Math.round(n) })} min={0} /></Field>
        {g.type !== "rsu"
          ? <Field label="Strike"><MoneyInput value={g.strike ?? 0} onChange={(n) => onChange({ strike: n })} decimals={2} /></Field>
          : <Field label="Value at vest"><span className="static">{usd(grantFmv(profile, g, profile.plan.startYear))}/sh</span></Field>}
      </div>
      <div className="row3">
        <Field label="Vested to date" hint={`by ${profile.plan.startYear}`}>
          <NumberInput value={g.vestedToDate ?? v.vestedAtStart + (g.type === "rsu" ? 0 : g.exercisedToDate ?? 0)} onChange={(n) => onChange({ vestedToDate: Math.max(0, Math.min(g.granted, Math.round(n))) })} min={0} />
        </Field>
        {g.type !== "rsu"
          ? <Field label="Exercised to date"><NumberInput value={g.exercisedToDate ?? 0} onChange={(n) => onChange({ exercisedToDate: Math.max(0, Math.min(g.granted, Math.round(n))) })} min={0} /></Field>
          : <span />}
        {companies.length > 1
          ? <Field label="Company"><Select options={companies.map((c) => ({ value: c.id, label: c.name }))} value={g.company ?? companies[0]!.id} onChange={(c) => onChange({ company: c })} /></Field>
          : <span />}
      </div>
      {g.type === "rsu" && (
        <Field label="Settles" hint="double-trigger RSUs need a liquidity event before they are income" wide>
          <Segmented options={[{ value: "vest", label: "When units vest" }, { value: "liquidity", label: "At a liquidity event (double-trigger)" }]} value={g.settlement ?? "vest"} onChange={(v) => onChange({ settlement: v === "liquidity" ? "liquidity" : undefined })} />
        </Field>
      )}
      <Field label="Vesting" wide>
        <Segmented options={[{ value: "schedule", label: "Schedule" }, { value: "years", label: "By year" }, { value: "none", label: "None" }]} value={mode}
          onChange={(m) => {
            if (m === "schedule") onChange({ schedule: g.schedule ?? { start: `${profile.plan.startYear - 1}-01-01`, years: 4, cliffMonths: 12, cadence: "monthly" }, vesting: undefined });
            else if (m === "years") onChange({ schedule: undefined, vesting: g.vesting ?? Object.fromEntries(years.map((y) => [y, 0])) });
            else onChange({ schedule: undefined, vesting: undefined, vestedToDate: g.vestedToDate ?? g.granted });
          }} />
      </Field>
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
      <div className={"grant-foot " + (mode === "none" && g.granted - (g.vestedToDate ?? 0) > 0 ? "warn" : "muted")}>
        {g.type === "rsu" ? `${shares(outstanding - (g.vestedToDate ?? v.vestedAtStart))} unvested.` : `${shares(outstanding)} outstanding, ${shares(exercisableNow ?? 0)} exercisable now.`}
        {mode === "none" && g.granted - (g.vestedToDate ?? 0) > 0 && " No schedule, so the unvested part never vests here."}
        {mode !== "none" && upcoming.some((n) => n > 0) ? ` Vests ${years.map((y, i) => upcoming[i] ? `${shares(upcoming[i]!)} in ${y}` : null).filter(Boolean).join(", ")}.` : ""}
        {spread !== null && ` Spread ${usd(spread)}/sh today${companyOf(profile, g) && companies.length > 1 ? ` (${companyOf(profile, g)!.name})` : ""}.`}
      </div>
    </div>
  );
}

interface LeverProps { year: number; available: number; value: number; mark: number | null; over: boolean; sharesBeforeAmt: number; spread: number; focus: boolean; onFocus: (y: number) => void; onChange: (n: number) => void; }

function ExerciseLever({ year, available, value, mark, over, sharesBeforeAmt, spread, focus, onFocus, onChange }: LeverProps) {
  const pctOf = (n: number) => (available > 0 ? (n / available) * 100 : 0);
  return (
    <div className={"lever" + (focus ? " focus" : "")}>
      <div className="head">
        <button type="button" className="year" onClick={() => onFocus(year)}>{year}</button>
        <NumberInput value={value} onChange={(n) => onChange(Math.min(available, n))} min={0} suffix="sh" />
      </div>
      <div className="track">
        <input type="range" className="range" min={0} max={available} step={available > 5000 ? 50 : 10} value={value} disabled={available === 0}
          style={{ "--pct": `${pctOf(value)}%` } as React.CSSProperties}
          onChange={(e) => onChange(Number(e.target.value))} onFocus={() => onFocus(year)} />
        {mark !== null && <div className="mark" style={{ left: `calc(9px + (100% - 18px) * ${pctOf(mark) / 100})` }} title={`AMT starts after ${shares(mark)} shares`} />}
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
