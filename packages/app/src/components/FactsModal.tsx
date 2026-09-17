import { useEffect } from "react";
import { calibrate, latestReturn, statusName, type Profile, type ProfileEdit } from "@taxonomy/engine";
import { pct, usd, usdCompact } from "../format.ts";
import { notesOf, sourceOf } from "../sources.ts";
import { EquityFacts, equitySummary } from "./EquitySection.tsx";
import { NotesFromClaude, ProbablyMissing, secondLookCount } from "./FollowUps.tsx";
import { usePersisted } from "../persist.ts";
import { FILING_OPTIONS, Field, MoneyInput, NumberInput, PercentInput, Segmented, Select, STATE_OPTIONS } from "./fields.tsx";

export const FACT_TABS = ["confirm", "you", "equity", "income", "home", "giving", "deductions", "history"] as const;
export type FactTab = (typeof FACT_TABS)[number];
export const isFactTab = (v: unknown): v is FactTab => typeof v === "string" && (FACT_TABS as readonly string[]).includes(v);

interface Props {
  profile: Profile;
  years: number[];
  tab: FactTab;
  onTab: (t: FactTab) => void;
  edit: (edits: ProfileEdit[]) => void;
  onClose: () => void;
  onOpenIntake: () => void;
  /** The file behind this profile, and whether a save is in flight. */
  path: string;
  saving: boolean;
}

/** Everything the plan is computed from, in one place. The sidebar keeps what you turn. */
export function FactsModal({ profile, years, tab, onTab, edit, onClose, onOpenIntake, path, saving }: Props) {
  const set = (path: (string | number)[], value: unknown) => edit([{ path, value }]);
  const src = (path: (string | number)[]) => sourceOf(profile, path);
  const note = (path: (string | number)[]) => notesOf(profile, path);
  const self = profile.people.self;
  const spouse = profile.people.spouse;
  const inc = profile.income;
  const ded = profile.deductions ?? {};
  const ch = ded.charitable ?? {};
  const home = profile.home ?? {};
  const cf = profile.carryforwards ?? {};
  const deps = profile.filer.dependents ?? [];
  const endYear = profile.plan.startYear + profile.plan.years - 1;
  const investment = (inc.interest ?? 0) + (inc.ordinaryDividends ?? inc.qualifiedDividends ?? 0) + (inc.longTermGains ?? 0) + (inc.shortTermGains ?? 0) + (inc.otherOrdinary ?? 0);
  const giving = (ch.cash ?? 0) + (ch.appreciatedStock ?? 0) + (ch.daf ?? 0);
  const ret = latestReturn(profile);
  const cal = calibrate(profile);
  const calTotal = cal?.rows.find((r) => r.id === "federalTotal");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [dismissedGaps] = usePersisted<string[]>("dismissedGaps", [], (v): v is string[] => Array.isArray(v));
  const secondLook = secondLookCount(profile, dismissedGaps);
  const tabs: { id: FactTab; title: string; color: string; summary: string; task?: boolean }[] = [
    { id: "confirm", title: "Notes from Claude", color: "var(--accent)", summary: secondLook.notes ? `${secondLook.notes} note${secondLook.notes === 1 ? "" : "s"} to read` : "nothing new", task: true },
    { id: "you", title: "You", color: "var(--accent)", summary: `${statusName(profile.filer.filingStatus)} · ${profile.filer.state} · ${usdCompact(self.salary)}${spouse ? ` + ${usdCompact(spouse.salary)}` : ""} · ${profile.plan.startYear}–${endYear}` },
    { id: "equity", title: "Equity", color: "var(--series-amt)", summary: equitySummary(profile, { exercises: { iso: {}, nso: {} } }).replace(/^0 ISO exercised · /, "") },
    { id: "income", title: "Other income", color: "var(--series-surtax)", summary: investment > 0 ? `${usdCompact(investment)} beyond salary` : "nothing beyond salary" },
    { id: "home", title: "Home", color: "var(--series-state)", summary: home.mortgage ? `${usdCompact(home.mortgage.balance)} at ${pct(home.mortgage.rate)}` : home.propertyTax ? `${usdCompact(home.propertyTax)} property tax` : "no mortgage" },
    { id: "giving", title: "Giving", color: "var(--series-violet)", summary: giving > 0 ? `${usdCompact(giving)} this year` : "none recorded" },
    { id: "deductions", title: "Other deductions", color: "var(--series-state)", summary: [ded.stateIncomeTax ? "state income tax" : "", ded.medical ? "medical" : ""].filter(Boolean).join(", ") || "none beyond the standard ones" },
    { id: "history", title: "Last return", color: "var(--series-amt)", summary: [ret ? `${ret.year}${calTotal ? ` · within ${pct(Math.abs(calTotal.delta) / Math.max(1, calTotal.reported))}` : ""}` : cf.amtCredit ? `${usdCompact(cf.amtCredit)} AMT credit` : "none on file", secondLook.gaps ? `${secondLook.gaps} probably missing` : ""].filter(Boolean).join(" · ") },
  ];

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide facts" role="dialog" aria-modal="true" aria-label="Your information">
        <div className="modal-head">
          <div>
            <h3>Your information</h3>
            <div className="muted small" style={{ margin: 0 }}>Everything the plan is computed from, saved as you type to <code title="Edit this file by hand if you like; the app follows it">{path}</code>{saving ? " · saving…" : ""}. What-ifs stay in the sidebar.</div>
          </div>
          <button type="button" className="btn primary" onClick={onOpenIntake}>Fill from documents</button>
          <button type="button" className="btn icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="facts-body">
          <nav className="facts-nav">
            {tabs.map((t) => (
              <button type="button" key={t.id} className={"facts-tab" + (t.id === tab ? " on" : "") + (t.task ? " task" : "")} onClick={() => onTab(t.id)}>
                {t.task ? <span className="task-count">{secondLook.notes}</span> : <span className="dot" style={{ background: t.color }} />}
                <span className="facts-tab-text"><span className="facts-tab-title">{t.title}</span><span className="facts-tab-summary">{t.summary}</span></span>
              </button>
            ))}
          </nav>
          <div className="facts-pane">
            {tab === "you" && (
              <>
                <Field label="Filing status" wide source={src(["filer", "filingStatus"])} note={note(["filer", "filingStatus"])}><Segmented options={[...FILING_OPTIONS]} columns={4} value={profile.filer.filingStatus} onChange={(v) => set(["filer", "filingStatus"], v)} /></Field>
                <div className="row3">
                  <Field label="State" source={src(["filer", "state"])} note={note(["filer", "state"])}><Select options={STATE_OPTIONS} value={profile.filer.state} onChange={(v) => set(["filer", "state"], v)} /></Field>
                  <Field label="Dependents" hint="birth years">
                    <span className="input-wrap"><input value={deps.map((d) => d.birthYear ?? "?").join(", ")} placeholder="e.g. 2019, 2022"
                      onChange={(e) => set(["filer", "dependents"], e.target.value.split(/[,\s]+/).filter(Boolean).map((t) => (/^\d{4}$/.test(t) ? { birthYear: Number(t) } : {})))} /></span>
                  </Field>
                  <span />
                  <Field label="First plan year"><NumberInput value={profile.plan.startYear} onChange={(n) => set(["plan", "startYear"], Math.round(n))} min={2026} grouping={false} /></Field>
                  <Field label="Years to plan"><NumberInput value={profile.plan.years} onChange={(n) => set(["plan", "years"], Math.max(1, Math.min(15, Math.round(n))))} min={1} /></Field>
                </div>
                <PersonFields who="self" person={self} label={spouse ? "You" : "Pay"} profile={profile} set={set} />
                {spouse
                  ? <>
                      <PersonFields who="spouse" person={spouse} label="Spouse" profile={profile} set={set} />
                      <button type="button" className="link danger" onClick={() => set(["people", "spouse"], undefined)}>Remove spouse</button>
                    </>
                  : <button type="button" className="link" onClick={() => set(["people", "spouse"], { salary: 0 })}>+ Add a spouse's income</button>}
              </>
            )}

            {tab === "equity" && <EquityFacts profile={profile} years={years} edit={edit} />}

            {tab === "income" && (
              <div className="row3">
                <Field label="Interest" source={src(["income", "interest"])} note={note(["income", "interest"])}><MoneyInput value={inc.interest ?? 0} onChange={(n) => set(["income", "interest"], n)} /></Field>
                <Field label="Total dividends" hint="1099-DIV 1a" source={src(["income", "ordinaryDividends"])} note={note(["income", "ordinaryDividends"])}><MoneyInput value={inc.ordinaryDividends ?? inc.qualifiedDividends ?? 0} onChange={(n) => set(["income", "ordinaryDividends"], n)} /></Field>
                <Field label="Qualified dividends" hint="1099-DIV 1b" source={src(["income", "qualifiedDividends"])} note={note(["income", "qualifiedDividends"])}><MoneyInput value={inc.qualifiedDividends ?? 0} onChange={(n) => set(["income", "qualifiedDividends"], n)} /></Field>
                <Field label="Short-term gains" source={src(["income", "shortTermGains"])} note={note(["income", "shortTermGains"])}><MoneyInput value={inc.shortTermGains ?? 0} onChange={(n) => set(["income", "shortTermGains"], n)} /></Field>
                <Field label="Long-term gains" source={src(["income", "longTermGains"])} note={note(["income", "longTermGains"])}><MoneyInput value={inc.longTermGains ?? 0} onChange={(n) => set(["income", "longTermGains"], n)} /></Field>
                <Field label="Other ordinary" hint="K-1, rental, side" source={src(["income", "otherOrdinary"])} note={note(["income", "otherOrdinary"])}><MoneyInput value={inc.otherOrdinary ?? 0} onChange={(n) => set(["income", "otherOrdinary"], n)} /></Field>
              </div>
            )}

            {tab === "home" && (
              <>
                {home.mortgage
                  ? <>
                      <div className="row3">
                        <Field label="Balance now" source={src(["home", "mortgage"])} note={note(["home", "mortgage"])}><MoneyInput value={home.mortgage.balance} onChange={(n) => set(["home", "mortgage", "balance"], n)} /></Field>
                        <Field label="Rate"><PercentInput value={home.mortgage.rate} onChange={(n) => set(["home", "mortgage", "rate"], n)} /></Field>
                        <Field label="Originated"><span className="input-wrap"><input type="date" value={home.mortgage.originated} onChange={(e) => set(["home", "mortgage", "originated"], e.target.value)} /></span></Field>
                        <Field label="Original amount" hint="sets the $750k cap"><MoneyInput value={home.mortgage.originalAmount ?? home.mortgage.balance} onChange={(n) => set(["home", "mortgage", "originalAmount"], n)} /></Field>
                        <Field label="Term" hint="years"><NumberInput value={home.mortgage.termYears ?? 30} onChange={(n) => set(["home", "mortgage", "termYears"], Math.max(1, Math.round(n)))} min={1} /></Field>
                        <Field label="Property tax" source={src(["home", "propertyTax"])} note={note(["home", "propertyTax"])}><MoneyInput value={home.propertyTax ?? 0} onChange={(n) => set(["home", "propertyTax"], n)} /></Field>
                      </div>
                      <button type="button" className="link danger" onClick={() => set(["home", "mortgage"], undefined)}>Remove mortgage</button>
                    </>
                  : <>
                      <div className="row3">
                        {home.mortgageInterest ? <Field label="Mortgage interest" hint="direct figure"><MoneyInput value={home.mortgageInterest} onChange={(n) => set(["home", "mortgageInterest"], n)} /></Field> : null}
                        <Field label="Property tax" source={src(["home", "propertyTax"])} note={note(["home", "propertyTax"])}><MoneyInput value={home.propertyTax ?? 0} onChange={(n) => set(["home", "propertyTax"], n)} /></Field>
                      </div>
                      <button type="button" className="link" onClick={() => set(["home", "mortgage"], { balance: 800_000, rate: 0.06, originated: `${profile.plan.startYear - 2}-01-01`, originalAmount: 800_000, termYears: 30 })}>+ Add a mortgage</button>
                    </>}
              </>
            )}

            {tab === "giving" && (
              <>
                <div className="row3">
                  <Field label="Cash gifts" hint="expected this year" source={src(["deductions", "charitable", "cash"])} note={note(["deductions", "charitable", "cash"])}><MoneyInput value={ch.cash ?? 0} onChange={(n) => set(["deductions", "charitable", "cash"], n)} /></Field>
                  <Field label="Appreciated stock" hint="fair market value given" source={src(["deductions", "charitable", "appreciatedStock"])} note={note(["deductions", "charitable", "appreciatedStock"])}><MoneyInput value={ch.appreciatedStock ?? 0} onChange={(n) => set(["deductions", "charitable", "appreciatedStock"], n)} /></Field>
                  <Field label="Donor-advised fund" source={src(["deductions", "charitable", "daf"])} note={note(["deductions", "charitable", "daf"])}><MoneyInput value={ch.daf ?? 0} onChange={(n) => set(["deductions", "charitable", "daf"], n)} /></Field>
                </div>
                <div className="row3">
                  <Field label="Charitable carryforward" hint="gifts not yet deducted because of AGI limits" source={src(["carryforwards", "charitable"])} note={note(["carryforwards", "charitable"])}><MoneyInput value={cf.charitable ?? 0} onChange={(n) => set(["carryforwards", "charitable"], n)} /></Field>
                </div>
                <p className="muted small">Giving is deducted only when itemizing beats the standard deduction; appreciated stock avoids the gain as well. Put a large gift on the timeline to see which year it does the most.</p>
              </>
            )}

            {tab === "deductions" && (
              <div className="row3">
                <Field label="State income tax" hint="leave 0 for a modeled state" source={src(["deductions", "stateIncomeTax"])} note={note(["deductions", "stateIncomeTax"])}><MoneyInput value={ded.stateIncomeTax ?? 0} onChange={(n) => set(["deductions", "stateIncomeTax"], n)} /></Field>
                <Field label="Medical expenses" source={src(["deductions", "medical"])} note={note(["deductions", "medical"])}><MoneyInput value={ded.medical ?? 0} onChange={(n) => set(["deductions", "medical"], n)} /></Field>
              </div>
            )}

            {tab === "confirm" && <NotesFromClaude profile={profile} edit={edit} />}

            {tab === "history" && (
              <>
                <ProbablyMissing profile={profile} edit={edit} />
                <div className="subhead">Carryforwards into {profile.plan.startYear}</div>
                <div className="row4">
                  <Field label="AMT credit" hint="Form 8801" source={src(["carryforwards", "amtCredit"])} note={note(["carryforwards", "amtCredit"])}><MoneyInput value={cf.amtCredit ?? 0} onChange={(n) => set(["carryforwards", "amtCredit"], n)} /></Field>
                  <Field label="Short-term loss" source={src(["carryforwards", "capitalLoss", "shortTerm"])} note={note(["carryforwards", "capitalLoss", "shortTerm"])}><MoneyInput value={cf.capitalLoss?.shortTerm ?? 0} onChange={(n) => set(["carryforwards", "capitalLoss", "shortTerm"], n)} /></Field>
                  <Field label="Long-term loss" source={src(["carryforwards", "capitalLoss", "longTerm"])} note={note(["carryforwards", "capitalLoss", "longTerm"])}><MoneyInput value={cf.capitalLoss?.longTerm ?? 0} onChange={(n) => set(["carryforwards", "capitalLoss", "longTerm"], n)} /></Field>
                  <Field label="Charitable" source={src(["carryforwards", "charitable"])} note={note(["carryforwards", "charitable"])}><MoneyInput value={cf.charitable ?? 0} onChange={(n) => set(["carryforwards", "charitable"], n)} /></Field>
                </div>
                {(profile.returns ?? []).map((r) => (
                  <div className="prior-return" key={r.year}>
                    <div className="subhead">{r.year} return {src(["returns", r.year]) && <span className="src" title={src(["returns", r.year])}>source</span>}</div>
                    <dl>
                      {r.reported.agi !== undefined && <><dt>AGI</dt><dd>{usd(r.reported.agi)}</dd></>}
                      {r.reported.totalTax !== undefined && <><dt>Total tax</dt><dd>{usd(r.reported.totalTax)}</dd></>}
                      {r.reported.amt !== undefined && <><dt>AMT</dt><dd>{usd(r.reported.amt)}</dd></>}
                    </dl>
                    <p className="muted small">The card at the bottom of the main page shows how closely the model reproduces this return. To change its figures, edit the file or fill from documents again.</p>
                    <button type="button" className="link danger" onClick={() => set(["returns"], (profile.returns ?? []).filter((x) => x.year !== r.year))}>Remove return</button>
                  </div>
                ))}
                {!ret && <p className="muted small">Fill from documents to add last year's return; the tool will show how closely it reproduces it.</p>}
              </>
            )}
          </div>
        </div>
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
