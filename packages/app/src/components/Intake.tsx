import { useState } from "react";
import { editProfileText, type FilingStatus, type ProfileEdit } from "@taxonomy/engine";
import { FILING_OPTIONS, Field, MoneyInput, NumberInput, Segmented, Select, STATE_OPTIONS } from "./fields.tsx";

interface Props { exampleText: string; onCreate: (text: string) => Promise<void>; }

/** First run: the four facts the picture cannot exist without, plus an optional ISO grant. */
export function Intake({ exampleText, onCreate }: Props) {
  const thisYear = new Date().getFullYear();
  const [filingStatus, setFilingStatus] = useState<FilingStatus>("single");
  const [state, setState] = useState("WA");
  const [wages, setWages] = useState(0);
  const [startYear, setStartYear] = useState(thisYear);
  const [hasIso, setHasIso] = useState<"yes" | "no">("yes");
  const [strike, setStrike] = useState(0);
  const [fmv, setFmv] = useState(0);
  const [shares, setShares] = useState(0);
  const [busy, setBusy] = useState(false);

  const ready = wages > 0 && (hasIso === "no" || (shares > 0 && fmv > 0));

  const submit = async () => {
    const edits: ProfileEdit[] = [
      { path: ["filer", "filingStatus"], value: filingStatus },
      { path: ["filer", "state"], value: state },
      { path: ["plan", "startYear"], value: startYear },
      { path: ["income", "wages"], value: Math.round(wages) },
      { path: ["income", "interest"], value: 0 },
      { path: ["income", "qualifiedDividends"], value: 0 },
      { path: ["equity", "isoGrants"], value: hasIso === "yes" ? [{ name: "ISO grant", strike, fmv, shares: Math.round(shares) }] : [] },
      { path: ["levers", "isoExercises"], value: {} },
    ];
    if (hasIso === "yes") edits.push({ path: ["levers", "isoExercises", startYear], value: 0 });
    setBusy(true);
    try { await onCreate(editProfileText(exampleText, edits)); } finally { setBusy(false); }
  };

  return (
    <div className="intake">
      <div className="intake-card">
        <div className="brand"><span className="mark" />Taxonomy</div>
        <h1>Start with the basics.</h1>
        <p className="lede">Four facts and you have a picture. Everything else has a sensible default you can change later, in the sidebar or straight in the file.</p>
        <div className="intake-grid">
          <Field label="Filing status" wide><Segmented options={[...FILING_OPTIONS]} value={filingStatus} onChange={setFilingStatus} /></Field>
          <Field label="State"><Select options={STATE_OPTIONS} value={state} onChange={setState} /></Field>
          <Field label="First plan year"><NumberInput value={startYear} onChange={setStartYear} min={2026} grouping={false} /></Field>
          <Field label="Annual salary" hint="wages before withholding" wide><MoneyInput value={wages} onChange={setWages} placeholder="320,000" /></Field>
          <Field label="Incentive stock options?" wide><Segmented options={[{ value: "yes", label: "Yes, I have ISOs" }, { value: "no", label: "No" }]} value={hasIso} onChange={setHasIso} /></Field>
          {hasIso === "yes" && (
            <>
              <Field label="Strike price" hint="per share"><MoneyInput value={strike} onChange={setStrike} decimals={2} /></Field>
              <Field label="Current value" hint="409A or market, per share"><MoneyInput value={fmv} onChange={setFmv} decimals={2} /></Field>
              <Field label="Shares exercisable"><NumberInput value={shares} onChange={setShares} min={0} /></Field>
            </>
          )}
        </div>
        <div className="intake-actions">
          <button type="button" className="btn primary big" disabled={!ready || busy} onClick={() => void submit()}>{busy ? "Saving…" : "Show me the picture"}</button>
          <span className="muted">Saved to <code>data/profile.yaml</code>, a plain file you can edit.</span>
        </div>
      </div>
    </div>
  );
}
