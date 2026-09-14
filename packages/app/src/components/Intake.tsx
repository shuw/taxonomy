import { useState } from "react";
import { editProfileText, type FilingStatus, type ProfileEdit } from "@taxonomy/engine";
import { FILING_OPTIONS, Field, MoneyInput, NumberInput, Segmented, Select, STATE_OPTIONS } from "./fields.tsx";

interface Props {
  exampleText: string;
  /** Present when other profiles exist, so this is a "new profile" dialog rather than first run. */
  onCancel?: () => void;
  onCreate: (name: string, text: string) => Promise<void>;
}

/** The few facts the picture cannot exist without, plus an optional ISO grant. */
export function Intake({ exampleText, onCancel, onCreate }: Props) {
  const thisYear = new Date().getFullYear();
  const [name, setName] = useState("");
  const [filingStatus, setFilingStatus] = useState<FilingStatus>("single");
  const [state, setState] = useState("WA");
  const [wages, setWages] = useState(0);
  const [startYear, setStartYear] = useState(thisYear);
  const [hasIso, setHasIso] = useState<"yes" | "no">("yes");
  const [strike, setStrike] = useState(0);
  const [fmv, setFmv] = useState(0);
  const [shares, setShares] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = name.trim() !== "" && wages > 0 && (hasIso === "no" || (shares > 0 && fmv > 0));

  const submit = async () => {
    const edits: ProfileEdit[] = [
      { path: ["name"], value: name.trim() },
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
    setError(null);
    try { await onCreate(name.trim(), editProfileText(exampleText, edits)); }
    catch (e) { setError(String((e as Error).message ?? e)); }
    finally { setBusy(false); }
  };

  return (
    <div className={"intake" + (onCancel ? " overlay" : "")}>
      <div className="intake-card">
        <div className="brand"><span className="mark" />Taxonomy</div>
        <h1>{onCancel ? "New profile." : "Start with the basics."}</h1>
        <p className="lede">{onCancel ? "A separate file with its own numbers and levers. Nothing you have entered elsewhere changes." : "A few facts and you have a picture. Everything else has a sensible default you can change later, in the sidebar or straight in the file."}</p>
        <div className="intake-grid">
          <Field label="Profile name" hint="a person, a household, or a what-if" wide><span className="input-wrap"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Me, or Me if we marry in 2027" /></span></Field>
          <Field label="Filing status" wide><Segmented options={[...FILING_OPTIONS]} value={filingStatus} onChange={setFilingStatus} /></Field>
          <Field label="State"><Select options={STATE_OPTIONS} value={state} onChange={setState} /></Field>
          <Field label="First plan year"><NumberInput value={startYear} onChange={setStartYear} min={2026} grouping={false} /></Field>
          <Field label="Annual salary" hint="wages before withholding; 320k works" wide><MoneyInput value={wages} onChange={setWages} placeholder="320,000" /></Field>
          <Field label="Incentive stock options?" wide><Segmented options={[{ value: "yes", label: "Yes, I have ISOs" }, { value: "no", label: "No" }]} value={hasIso} onChange={setHasIso} /></Field>
          {hasIso === "yes" && (
            <>
              <Field label="Strike price" hint="per share"><MoneyInput value={strike} onChange={setStrike} decimals={2} /></Field>
              <Field label="Current value" hint="409A or market, per share"><MoneyInput value={fmv} onChange={setFmv} decimals={2} /></Field>
              <Field label="Shares exercisable"><NumberInput value={shares} onChange={setShares} min={0} /></Field>
            </>
          )}
        </div>
        {error && <div className="error" style={{ marginTop: 14 }}>{error}</div>}
        <div className="intake-actions">
          <button type="button" className="btn primary big" disabled={!ready || busy} onClick={() => void submit()}>{busy ? "Saving…" : onCancel ? "Create profile" : "Show me the picture"}</button>
          {onCancel && <button type="button" className="btn big" onClick={onCancel}>Cancel</button>}
          <span className="muted">Saved as a plain file in <code>data/profiles</code>.</span>
        </div>
      </div>
    </div>
  );
}
