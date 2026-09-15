import { usePersisted } from "../persist.ts";
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
  const focusCrossover = crossovers.find((c) => c.year === focusYear) ?? crossovers[0];
  const nsoAvailable = sharesExercisable(profile, levers, "nso", focusYear);

  return (
    <Section id="equity" title="Equity" color="var(--series-amt)" defaultOpen summary={summary}>
      {companies.map((c, i) => (
        <CompanyRow key={c.id} company={c} profile={profile} years={years}
          hasDoubleTrigger={grants.some((g) => g.type === "rsu" && g.settlement === "liquidity" && (g.company ?? companies[0]?.id) === c.id)}
          removable={companies.length > 1 && !grants.some((g) => (g.company ?? companies[0]?.id) === c.id)}
          onChange={(patch) => setCompany(i, patch)} onRemove={() => set(["equity", "companies"], companies.filter((_, j) => j !== i))} />
      ))}
      <button type="button" className="link" onClick={addCompany}>+ Add company</button>

      {missing.length > 0 && (
        <div className="notice">
          <strong>{missing.length === 1 ? "One grant has" : `${missing.length} grants have`} unvested shares but no vesting schedule</strong>, so nothing more of them vests in the plan: {missing.map((g) => g.name).join(", ")}. Open the grant and set "Vesting".
        </div>
      )}

      {(hasType("iso") || hasType("nso") || hasType("rsu")) && (
        <>
          <div className="subhead">By year <span className="muted">· pick a year, then move its levers</span></div>
          <div className="year-strip">
            {years.map((y) => {
              const iso = levers.exercises.iso[y] ?? 0;
              const nso = levers.exercises.nso[y] ?? 0;
              const rsu = hasType("rsu") ? rsuVesting(profile, y).shares : 0;
              const parts = [iso > 0 && <span key="i" className="yc-iso">{shares(iso)} ISO</span>, nso > 0 && <span key="n" className="yc-nso">{shares(nso)} NSO</span>, rsu > 0 && <span key="r" className="yc-rsu">{shares(rsu)} RSU</span>].filter(Boolean);
              return (
                <button type="button" key={y} className={"year-chip" + (y === focusYear ? " on" : "")} onClick={() => onFocus(y)}>
                  <span className="yc-year">{y}</span>
                  {parts.length ? parts : <span className="yc-val">—</span>}
                </button>
              );
            })}
          </div>
          <div className="lever focus">
            <div className="year">{focusYear}</div>
            {hasType("iso") && focusCrossover && (
              <LeverRow label="ISO" hint="spread goes to AMT" available={focusCrossover.available} value={Math.min(levers.exercises.iso[focusYear] ?? 0, focusCrossover.available)}
                mark={focusCrossover.available > 0 && focusCrossover.sharesBeforeAmt < focusCrossover.available ? focusCrossover.sharesBeforeAmt : null}
                over={focusCrossover.overCrossover} sharesBeforeAmt={focusCrossover.sharesBeforeAmt} spread={nextShareSpread(profile, "iso", focusYear)} onChange={(n) => onExercise("iso", focusYear, n)} />
            )}
            {hasType("nso") && (
              <LeverRow label="NSO" hint="spread is wage income" available={nsoAvailable} value={Math.min(levers.exercises.nso[focusYear] ?? 0, nsoAvailable)} mark={null} over={false} sharesBeforeAmt={0}
                spread={nextShareSpread(profile, "nso", focusYear)} onChange={(n) => onExercise("nso", focusYear, n)} />
            )}
            {hasType("rsu") && (() => { const v = rsuVesting(profile, focusYear); return (
              <div className="lever-row">
                <div className="head"><span className="badge rsu">RSU</span><span className="lever-hint muted">wages the year units settle</span></div>
                <div className="foot"><span>{v.shares ? `${shares(v.shares)} units settle · ${usdCompact(v.income)} of wages` : "nothing settles this year"}</span></div>
              </div>
            ); })()}
          </div>
        </>
      )}

      <div className="subhead">Grants</div>
      {grants.map((g, i) => <GrantRow key={g.id} grant={g} profile={profile} onChange={(patch) => setGrant(i, patch)} onRemove={() => set(["equity", "grants"], grants.filter((_, j) => j !== i))} />)}
      <div className="add-grant">
        {TYPE_OPTIONS.map((t) => <button type="button" key={t.value} className="link" onClick={() => addGrant(t.value)}>+ {t.label}</button>)}
      </div>

      {(profile.equity.holdings?.length ?? 0) > 0 && (
        <details className="fold">
          <summary>Shares owned · {profile.equity.holdings!.length} lot{profile.equity.holdings!.length === 1 ? "" : "s"} {sourceOf(profile, ["holdings"]) && <span className="src" title={sourceOf(profile, ["holdings"])}>source</span>}</summary>
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
        </details>
      )}
    </Section>
  );
}

function CompanyRow({ company: c, profile, years, hasDoubleTrigger, removable, onChange, onRemove }: { company: Company; profile: Profile; years: number[]; hasDoubleTrigger: boolean; removable: boolean; onChange: (patch: Partial<Company>) => void; onRemove: () => void }) {
  const [open, setOpen] = usePersisted<boolean>(`open.company.${c.id}`, false, (v): v is boolean => typeof v === "boolean");
  const source = sourceOf(profile, ["companies", c.id, "sharePrice"]);
  const pathEntries = Object.entries(c.pricePath ?? {}).map(([y, p]) => [Number(y), p] as const).sort((a, b) => a[0] - b[0]);
  const updatePath = (list: (readonly [number, number])[]) => onChange({ pricePath: list.length ? Object.fromEntries(list) : undefined });
  const sub = [
    c.sharePriceAsOf && `as of ${c.sharePriceAsOf}`,
    `grows ${pct(c.growth ?? profile.assumptions.fmvGrowth)}/yr`,
    pathEntries.length > 0 && pathEntries.map(([y, p]) => `${usd(p)} in ${y}`).join(", "),
    hasDoubleTrigger && `liquidity ${c.liquidityYear ?? "not in plan"}`,
  ].filter(Boolean).join(" · ");
  return (
    <div className={"company" + (open ? " open" : "")}>
      <div className="company-line">
        <input className="grant-name" value={c.name} onChange={(e) => onChange({ name: e.target.value })} aria-label="Company name" />
        <span className="company-price"><MoneyInput value={c.sharePrice} onChange={(n) => onChange({ sharePrice: n })} decimals={2} suffix="/sh" /></span>
        {source && <span className="src" title={source}>source</span>}
        <button type="button" className="link" onClick={() => setOpen((o) => !o)}>{open ? "less" : "more"}</button>
      </div>
      {!open && <div className="company-sub muted">{sub}</div>}
      {open && (
        <div className="company-more">
          <div className="row2">
            <Field label="Price as of"><span className="input-wrap"><input type="date" value={c.sharePriceAsOf ?? ""} onChange={(e) => onChange({ sharePriceAsOf: e.target.value || undefined })} /></span></Field>
            <Field label="Growth" hint={c.growth === undefined ? `default ${pct(profile.assumptions.fmvGrowth)}` : "/yr"}><PercentInput value={c.growth ?? profile.assumptions.fmvGrowth} onChange={(n) => onChange({ growth: n })} /></Field>
          </div>
          {hasDoubleTrigger && (
            <Field label="Liquidity event" hint="the year double-trigger RSUs settle; blank means none in the plan" wide>
              <Select options={[{ value: "", label: "none in the plan" }, ...years.map((y) => ({ value: String(y), label: String(y) }))]} value={c.liquidityYear ? String(c.liquidityYear) : ""} onChange={(v) => onChange({ liquidityYear: v ? Number(v) : undefined })} />
            </Field>
          )}
          {pathEntries.map(([y, p], i) => (
            <div className="row3" key={i}>
              <Field label="Known price in"><NumberInput value={y} onChange={(n) => updatePath(pathEntries.map((e, j) => (j === i ? [Math.round(n), e[1]] as const : e)))} grouping={false} /></Field>
              <Field label="Per share"><MoneyInput value={p} onChange={(n) => updatePath(pathEntries.map((e, j) => (j === i ? [e[0], n] as const : e)))} decimals={2} /></Field>
              <button type="button" className="link danger" style={{ alignSelf: "end", paddingBottom: 8 }} onClick={() => updatePath(pathEntries.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <div className="add-grant">
            <button type="button" className="link" onClick={() => updatePath([...pathEntries, [pathEntries.length ? pathEntries[pathEntries.length - 1]![0] + 1 : years[1] ?? years[0]!, c.sharePrice * 2] as const])}>+ Known price in a later year (an IPO, a tender)</button>
            {removable && <button type="button" className="link danger" onClick={onRemove}>Remove company</button>}
          </div>
        </div>
      )}
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
  if (g.countsAsOf) out.countsAsOf = g.countsAsOf;
  if (g.type !== "rsu" && g.exercisedToDate !== undefined) out.exercisedToDate = g.exercisedToDate;
  if (g.type !== "rsu" && g.strike !== undefined) out.strike = g.strike;
  if (g.expires) out.expires = g.expires;
  if (g.type === "rsu" && g.settlement === "liquidity") out.settlement = "liquidity";
  if (g.schedule) out.schedule = g.schedule;
  else if (g.vesting) out.vesting = g.vesting;
  return out;
}

function GrantRow({ grant: g, profile, onChange, onRemove }: { grant: EquityGrant; profile: Profile; onChange: (patch: Partial<EquityGrant>) => void; onRemove: () => void }) {
  const [open, setOpen] = usePersisted<boolean>(`open.grant.${g.id}`, false, (v): v is boolean => typeof v === "boolean");
  const source = sourceOf(profile, ["grants", g.id]);
  const v = vestingOf(profile, g);
  const mode: "schedule" | "years" | "none" = g.schedule ? "schedule" : g.vesting ? "years" : "none";
  const years = Array.from({ length: profile.plan.years }, (_, i) => profile.plan.startYear + i);
  const upcoming = years.map((y) => v.byYear[y] ?? 0);
  const spread = g.type === "rsu" ? null : Math.max(0, grantFmv(profile, g, profile.plan.startYear) - (g.strike ?? 0));
  const outstanding = sharesOutstanding(g);
  const exercisableNow = g.type === "rsu" ? null : vestedThrough(profile, g, profile.plan.startYear);
  const companies = profile.equity.companies;
  const unvested = Math.max(0, g.granted - (g.vestedToDate ?? v.vestedAtStart));
  const noSchedule = mode === "none" && unvested > 0;
  const oneLine = g.type === "rsu"
    ? `${shares(g.granted)} units · ${shares(unvested)} unvested${g.settlement === "liquidity" ? " · double-trigger" : ""}`
    : `${shares(outstanding)} outstanding · ${shares(exercisableNow ?? 0)} exercisable · strike ${usd(g.strike ?? 0)}`;
  return (
    <div className={"grant" + (open ? " open" : "") + (noSchedule ? " warn" : "")}>
      <button type="button" className="grant-line" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={"badge " + g.type}>{TYPE_LABEL[g.type]}</span>
        <span className="grant-text">
          <span className="grant-title">{g.name}</span>
          <span className="grant-summary muted">{oneLine}{noSchedule ? " · no schedule" : ""}</span>
        </span>
        <svg className="chev" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="grant-body">
          <div className="grant-head">
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
              : <Field label="Value at settlement"><span className="static">{usd(grantFmv(profile, g, profile.plan.startYear))}/sh</span></Field>}
          </div>
          <div className="row3">
            <Field label="Vested to date" hint={g.countsAsOf ? `as of ${g.countsAsOf}` : `as of Jan 1, ${profile.plan.startYear}`}>
              <NumberInput value={g.vestedToDate ?? v.vestedAtStart + (g.type === "rsu" ? 0 : g.exercisedToDate ?? 0)} onChange={(n) => onChange({ vestedToDate: Math.max(0, Math.min(g.granted, Math.round(n))) })} min={0} />
            </Field>
            {g.type !== "rsu"
              ? <Field label="Exercised to date"><NumberInput value={g.exercisedToDate ?? 0} onChange={(n) => onChange({ exercisedToDate: Math.max(0, Math.min(g.granted, Math.round(n))) })} min={0} /></Field>
              : <span />}
            <Field label="Counts as of" hint="the date you read them"><span className="input-wrap"><input type="date" value={g.countsAsOf ?? ""} onChange={(e) => onChange({ countsAsOf: e.target.value || undefined })} /></span></Field>
          </div>
          {companies.length > 1 && <Field label="Company" wide><Select options={companies.map((c) => ({ value: c.id, label: c.name }))} value={g.company ?? companies[0]!.id} onChange={(c) => onChange({ company: c })} /></Field>}
          {g.type === "rsu" && (
            <Field label="Settles" hint="double-trigger RSUs need a liquidity event before they are income" wide>
              <Segmented options={[{ value: "vest", label: "When units vest" }, { value: "liquidity", label: "At a liquidity event (double-trigger)" }]} value={g.settlement ?? "vest"} onChange={(s) => onChange({ settlement: s === "liquidity" ? "liquidity" : undefined })} />
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
          <div className={"grant-foot " + (noSchedule ? "warn" : "muted")}>
            {g.type === "rsu" ? `${shares(unvested)} unvested.` : `${shares(outstanding)} outstanding, ${shares(exercisableNow ?? 0)} exercisable now.`}
            {noSchedule && " No schedule, so the unvested part never vests here."}
            {mode !== "none" && upcoming.some((n) => n > 0) ? ` Vests ${years.map((y, i) => upcoming[i] ? `${shares(upcoming[i]!)} in ${y}` : null).filter(Boolean).join(", ")}.` : ""}
            {spread !== null && ` Spread ${usd(spread)}/sh today${companyOf(profile, g) && companies.length > 1 ? ` (${companyOf(profile, g)!.name})` : ""}.`}
          </div>
        </div>
      )}
    </div>
  );
}

interface LeverProps { label: string; hint: string; available: number; value: number; mark: number | null; over: boolean; sharesBeforeAmt: number; spread: number; onChange: (n: number) => void; }

function LeverRow({ label, hint, available, value, mark, over, sharesBeforeAmt, spread, onChange }: LeverProps) {
  const pctOf = (n: number) => (available > 0 ? (n / available) * 100 : 0);
  return (
    <div className="lever-row">
      <div className="head">
        <span className={"badge " + label.toLowerCase()}>{label}</span>
        <span className="lever-hint muted">{hint}</span>
        <NumberInput value={value} onChange={(n) => onChange(Math.min(available, n))} min={0} suffix="sh" />
      </div>
      <div className="track">
        <input type="range" className="range" min={0} max={available} step={available > 5000 ? 50 : 10} value={value} disabled={available === 0}
          style={{ "--pct": `${pctOf(value)}%` } as React.CSSProperties}
          onChange={(e) => onChange(Number(e.target.value))} />
        {mark !== null && <div className="mark" style={{ left: `calc(9px + (100% - 18px) * ${pctOf(mark) / 100})` }} title={`AMT starts after ${shares(mark)} shares`} />}
      </div>
      <div className="foot">
        <span className={over ? "over" : ""}>
          {available === 0 ? "nothing exercisable this year" : mark === null ? "" : over ? `${shares(value - sharesBeforeAmt)} past the AMT line` : `AMT-free up to ${shares(sharesBeforeAmt)}`}
        </span>
        <span>{shares(available)} exercisable · {usd(spread)}/sh spread</span>
      </div>
    </div>
  );
}
