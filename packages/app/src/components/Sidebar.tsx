import { calibrate, latestReturn, statusName, timelineFields, type AmtCrossover, type FieldDef, type Levers, type Profile, type ProfileEdit, type Source, type TimelineEntry } from "@taxonomy/engine";
import { pct, usd, usdCompact } from "../format.ts";
import { EquitySection } from "./EquitySection.tsx";
import { FILING_OPTIONS, Field, MoneyInput, NumberInput, PercentInput, Segmented, Select, STATE_OPTIONS, parseAmount } from "./fields.tsx";
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
  onOpenIntake: () => void;
}

/** Source string recorded for a profile path, if any. */
export function sourceOf(profile: Profile, path: (string | number)[]): string | undefined {
  const s: Source | undefined = profile.sources?.[path.join(".")];
  if (!s) return undefined;
  return typeof s === "string" ? s : `${s.doc}${s.asOf ? ` (${s.asOf})` : ""}${s.note ? ` · ${s.note}` : ""}`;
}

export function Sidebar({ profile, levers, crossovers, years, focusYear, onFocus, onExercise, edit, onOpenIntake }: Props) {
  const set = (path: (string | number)[], value: unknown) => edit([{ path, value }]);
  const src = (path: (string | number)[]) => sourceOf(profile, path);
  const self = profile.people.self;
  const spouse = profile.people.spouse;
  const inc = profile.income;
  const ded = profile.deductions ?? {};
  const ch = ded.charitable ?? {};
  const home = profile.home ?? {};
  const cf = profile.carryforwards ?? {};
  const a = profile.assumptions;
  const deps = profile.filer.dependents ?? [];
  const endYear = profile.plan.startYear + profile.plan.years - 1;
  const investment = (inc.interest ?? 0) + (inc.ordinaryDividends ?? inc.qualifiedDividends ?? 0) + (inc.longTermGains ?? 0) + (inc.shortTermGains ?? 0) + (inc.otherOrdinary ?? 0);
  const giving = (ch.cash ?? 0) + (ch.appreciatedStock ?? 0) + (ch.daf ?? 0);
  const ret = latestReturn(profile);
  const cal = calibrate(profile);
  const calTotal = cal?.rows.find((r) => r.id === "federalTotal");
  const timeline = [...(profile.timeline ?? [])].sort((x, y) => x.year - y.year);

  return (
    <div className="sidebar-inner">
      <div className="intake-cta">
        <button type="button" className="btn primary" onClick={onOpenIntake}>Fill from documents</button>
        <span className="muted small" style={{ margin: 0 }}>Get a request for your own agent; paste back what it finds.</span>
      </div>

      <Section id="you" title="You" color="var(--accent)" summary={`${statusName(profile.filer.filingStatus)} · ${profile.filer.state} · ${usdCompact(self.salary)}${spouse ? ` + ${usdCompact(spouse.salary)}` : ""} · ${profile.plan.startYear}–${endYear}`}>
        <Field label="Filing status" wide source={src(["filer", "filingStatus"])}><Segmented options={[...FILING_OPTIONS]} columns={2} value={profile.filer.filingStatus} onChange={(v) => set(["filer", "filingStatus"], v)} /></Field>
        <div className="row2">
          <Field label="State" source={src(["filer", "state"])}><Select options={STATE_OPTIONS} value={profile.filer.state} onChange={(v) => set(["filer", "state"], v)} /></Field>
          <Field label="Dependents" hint="birth years">
            <span className="input-wrap"><input value={deps.map((d) => d.birthYear ?? "?").join(", ")} placeholder="e.g. 2019, 2022"
              onChange={(e) => set(["filer", "dependents"], e.target.value.split(/[,\s]+/).filter(Boolean).map((t) => (/^\d{4}$/.test(t) ? { birthYear: Number(t) } : {})))} /></span>
          </Field>
        </div>
        <div className="row2">
          <Field label="First year"><NumberInput value={profile.plan.startYear} onChange={(n) => set(["plan", "startYear"], Math.round(n))} min={2026} grouping={false} /></Field>
          <Field label="Years"><NumberInput value={profile.plan.years} onChange={(n) => set(["plan", "years"], Math.max(1, Math.min(15, Math.round(n))))} min={1} /></Field>
        </div>
        <PersonFields who="self" person={self} label={spouse ? "You" : undefined} profile={profile} set={set} />
        {spouse
          ? <>
              <PersonFields who="spouse" person={spouse} label="Spouse" profile={profile} set={set} />
              <button type="button" className="link danger" onClick={() => set(["people", "spouse"], undefined)}>Remove spouse</button>
            </>
          : <button type="button" className="link" onClick={() => set(["people", "spouse"], { salary: 0 })}>+ Add a spouse's income</button>}
      </Section>

      <EquitySection profile={profile} levers={levers} crossovers={crossovers} years={years} focusYear={focusYear} onFocus={onFocus} onExercise={onExercise} edit={edit} />

      <Section id="income" title="Other income" color="var(--series-surtax)" summary={investment > 0 ? `${usdCompact(investment)} beyond salary` : "nothing beyond salary"}>
        <div className="row2">
          <Field label="Interest" source={src(["income", "interest"])}><MoneyInput value={inc.interest ?? 0} onChange={(n) => set(["income", "interest"], n)} /></Field>
          <Field label="Other ordinary" hint="K-1, rental, side" source={src(["income", "otherOrdinary"])}><MoneyInput value={inc.otherOrdinary ?? 0} onChange={(n) => set(["income", "otherOrdinary"], n)} /></Field>
          <Field label="Total dividends" hint="1099-DIV 1a" source={src(["income", "ordinaryDividends"])}><MoneyInput value={inc.ordinaryDividends ?? inc.qualifiedDividends ?? 0} onChange={(n) => set(["income", "ordinaryDividends"], n)} /></Field>
          <Field label="Qualified dividends" hint="1099-DIV 1b" source={src(["income", "qualifiedDividends"])}><MoneyInput value={inc.qualifiedDividends ?? 0} onChange={(n) => set(["income", "qualifiedDividends"], n)} /></Field>
          <Field label="Short-term gains" source={src(["income", "shortTermGains"])}><MoneyInput value={inc.shortTermGains ?? 0} onChange={(n) => set(["income", "shortTermGains"], n)} /></Field>
          <Field label="Long-term gains" source={src(["income", "longTermGains"])}><MoneyInput value={inc.longTermGains ?? 0} onChange={(n) => set(["income", "longTermGains"], n)} /></Field>
        </div>
      </Section>

      <Section id="home" title="Home" color="var(--series-state)" summary={home.mortgage ? `${usdCompact(home.mortgage.balance)} at ${pct(home.mortgage.rate)}${home.propertyTax ? ` · ${usdCompact(home.propertyTax)} property tax` : ""}` : home.propertyTax ? `${usdCompact(home.propertyTax)} property tax, no mortgage` : "no mortgage"}>
        {home.mortgage
          ? <>
              <div className="row2">
                <Field label="Balance now" source={src(["home", "mortgage"])}><MoneyInput value={home.mortgage.balance} onChange={(n) => set(["home", "mortgage", "balance"], n)} /></Field>
                <Field label="Rate"><PercentInput value={home.mortgage.rate} onChange={(n) => set(["home", "mortgage", "rate"], n)} /></Field>
                <Field label="Originated"><span className="input-wrap"><input type="date" value={home.mortgage.originated} onChange={(e) => set(["home", "mortgage", "originated"], e.target.value)} /></span></Field>
                <Field label="Original amount" hint="sets the $750k cap"><MoneyInput value={home.mortgage.originalAmount ?? home.mortgage.balance} onChange={(n) => set(["home", "mortgage", "originalAmount"], n)} /></Field>
                <Field label="Term" hint="years"><NumberInput value={home.mortgage.termYears ?? 30} onChange={(n) => set(["home", "mortgage", "termYears"], Math.max(1, Math.round(n)))} min={1} /></Field>
              </div>
              <button type="button" className="link danger" onClick={() => set(["home", "mortgage"], undefined)}>Remove mortgage</button>
            </>
          : <>
              <button type="button" className="link" onClick={() => set(["home", "mortgage"], { balance: 800_000, rate: 0.06, originated: `${profile.plan.startYear - 2}-01-01`, originalAmount: 800_000, termYears: 30 })}>+ Add a mortgage</button>
              {home.mortgageInterest ? <Field label="Mortgage interest" hint="direct figure" wide><MoneyInput value={home.mortgageInterest} onChange={(n) => set(["home", "mortgageInterest"], n)} /></Field> : null}
            </>}
        <Field label="Property tax" wide source={src(["home", "propertyTax"])}><MoneyInput value={home.propertyTax ?? 0} onChange={(n) => set(["home", "propertyTax"], n)} /></Field>
      </Section>

      <Section id="deductions" title="Giving and deductions" color="var(--series-violet)" summary={giving > 0 ? `${usdCompact(giving)} charitable` : "no charitable giving"}>
        <div className="row3">
          <Field label="Cash gifts" source={src(["deductions", "charitable", "cash"])}><MoneyInput value={ch.cash ?? 0} onChange={(n) => set(["deductions", "charitable", "cash"], n)} /></Field>
          <Field label="Appreciated stock" source={src(["deductions", "charitable", "appreciatedStock"])}><MoneyInput value={ch.appreciatedStock ?? 0} onChange={(n) => set(["deductions", "charitable", "appreciatedStock"], n)} /></Field>
          <Field label="Donor-advised fund" source={src(["deductions", "charitable", "daf"])}><MoneyInput value={ch.daf ?? 0} onChange={(n) => set(["deductions", "charitable", "daf"], n)} /></Field>
        </div>
        <div className="row2">
          <Field label="State income tax" source={src(["deductions", "stateIncomeTax"])}><MoneyInput value={ded.stateIncomeTax ?? 0} onChange={(n) => set(["deductions", "stateIncomeTax"], n)} /></Field>
          <Field label="Medical expenses" source={src(["deductions", "medical"])}><MoneyInput value={ded.medical ?? 0} onChange={(n) => set(["deductions", "medical"], n)} /></Field>
        </div>
      </Section>

      <Section id="history" title="Last return and carryforwards" color="var(--series-amt)" summary={ret ? `${ret.year} return${calTotal ? ` · model within ${pct(Math.abs(calTotal.delta) / Math.max(1, calTotal.reported))}` : ""}` : cf.amtCredit ? `${usdCompact(cf.amtCredit)} AMT credit` : "no return on file"}>
        <div className="row3">
          <Field label="AMT credit" hint="Form 8801" source={src(["carryforwards", "amtCredit"])}><MoneyInput value={cf.amtCredit ?? 0} onChange={(n) => set(["carryforwards", "amtCredit"], n)} /></Field>
          <Field label="ST loss carry" source={src(["carryforwards", "capitalLoss", "shortTerm"])}><MoneyInput value={cf.capitalLoss?.shortTerm ?? 0} onChange={(n) => set(["carryforwards", "capitalLoss", "shortTerm"], n)} /></Field>
          <Field label="LT loss carry" source={src(["carryforwards", "capitalLoss", "longTerm"])}><MoneyInput value={cf.capitalLoss?.longTerm ?? 0} onChange={(n) => set(["carryforwards", "capitalLoss", "longTerm"], n)} /></Field>
        </div>
        <Field label="Charitable carryforward" wide source={src(["carryforwards", "charitable"])}><MoneyInput value={cf.charitable ?? 0} onChange={(n) => set(["carryforwards", "charitable"], n)} /></Field>
        {(profile.returns ?? []).map((r) => (
          <div className="prior-return" key={r.year}>
            <div className="subhead">{r.year} return {src(["returns", r.year]) && <span className="src" title={src(["returns", r.year])}>source</span>}</div>
            <dl>
              {r.reported.agi !== undefined && <><dt>AGI</dt><dd>{usd(r.reported.agi)}</dd></>}
              {r.reported.totalTax !== undefined && <><dt>Total tax</dt><dd>{usd(r.reported.totalTax)}</dd></>}
              {r.reported.amt !== undefined && <><dt>AMT</dt><dd>{usd(r.reported.amt)}</dd></>}
            </dl>
            <button type="button" className="link danger" onClick={() => set(["returns"], (profile.returns ?? []).filter((x) => x.year !== r.year))}>Remove return</button>
          </div>
        ))}
        {!ret && <p className="muted small">Fill from documents to add last year's return; the tool will show how closely it reproduces it.</p>}
      </Section>

      <Section id="timeline" title="Changes over time" color="var(--series-regular)" summary={timeline.length ? timeline.map((t) => `${t.year}: ${labelOf(t.path)}`).join(" · ") : "nothing changes"}>
        <p className="muted small">A dated change to any fact above, in force from that year on. Growth assumptions still apply from the plan start.</p>
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
      </Section>
    </div>
  );
}

const labelOf = (path: string) => timelineFields().find((f) => f.path === path)?.label ?? path;

function TimelineRow({ entry, years, onChange, onRemove }: { entry: TimelineEntry; years: number[]; onChange: (e: TimelineEntry) => void; onRemove: () => void }) {
  const fields = timelineFields();
  const f: FieldDef | undefined = fields.find((x) => x.path === entry.path);
  const valueInput = f?.type === "enum"
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
        <Field label="What changes"><Select options={fields.map((x) => ({ value: x.path, label: x.label }))} value={entry.path} onChange={(p) => onChange({ ...entry, path: p, value: fields.find((x) => x.path === p)?.type === "enum" ? fields.find((x) => x.path === p)!.enum![0] : 0 })} /></Field>
        <Field label="To">{valueInput}</Field>
      </div>
      <div className="grant-head">
        <input className="grant-name" placeholder="note (optional)" value={entry.note ?? ""} onChange={(e) => onChange({ ...entry, note: e.target.value || undefined })} />
        <button type="button" className="link danger" onClick={onRemove}>Remove</button>
      </div>
    </div>
  );
}

function PersonFields({ who, person, label, profile, set }: { who: "self" | "spouse"; person: Profile["people"]["self"]; label?: string; profile: Profile; set: (path: (string | number)[], value: unknown) => void }) {
  const src = (field: string) => sourceOf(profile, ["people", who, field]);
  return (
    <>
      {label && <div className="subhead">{label}{person.name ? ` · ${person.name}` : ""}</div>}
      <div className="row3">
        <Field label="Base salary" source={src("salary")}><MoneyInput value={person.salary} onChange={(n) => set(["people", who, "salary"], n)} /></Field>
        <Field label="Bonus" source={src("bonus")}><MoneyInput value={person.bonus ?? 0} onChange={(n) => set(["people", who, "bonus"], n)} /></Field>
        <Field label="Pre-tax" hint="401k, HSA" source={src("pretaxContributions")}><MoneyInput value={person.pretaxContributions ?? 0} onChange={(n) => set(["people", who, "pretaxContributions"], n)} /></Field>
      </div>
    </>
  );
}
