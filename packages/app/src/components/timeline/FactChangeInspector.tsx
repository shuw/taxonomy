import { getPath, timelineFields, type FieldDef, type Profile, type TimelineEntry } from "@taxonomy/engine";
import { MoneyInput, PercentInput, Select, parseAmount } from "../fields.tsx";
import { InspectorShell, YearSelect } from "./InspectorShell.tsx";

/** An input for a registry field's value, by its type. */
export function FieldValueInput({ field, value, onChange }: { field: FieldDef | undefined; value: unknown; onChange: (v: unknown) => void }) {
  switch (field?.type) {
    case "bool": return <Select options={[{ value: "true", label: "on" }, { value: "false", label: "off" }]} value={String(value === true)} onChange={(v) => onChange(v === "true")} />;
    case "enum": return <Select options={(field.enum ?? []).map((v) => ({ value: v, label: v }))} value={String(value)} onChange={onChange} />;
    case "pct": return <PercentInput value={Number(value) || 0} onChange={onChange} />;
    case "usd": return <MoneyInput value={Number(value) || 0} onChange={onChange} />;
    default: return <span className="input-wrap"><input value={String(value ?? "")} onChange={(e) => onChange(parseAmount(e.target.value) ?? e.target.value)} /></span>;
  }
}

interface Props { profile: Profile; years: number[]; entry: TimelineEntry; onChange: (e: TimelineEntry) => void; onRemove: () => void; }

/** Edit a dated change to a fact: what, from when, to what. */
export function FactChangeInspector({ profile, years, entry, onChange, onRemove }: Props) {
  const f = timelineFields().find((x) => x.path === entry.path);
  const same = getPath(profile, entry.path) === entry.value;
  const once = entry.until !== undefined;
  return (
    <InspectorShell kind="fact" title={f?.label ?? entry.path} onRemove={onRemove}
      head={<>
        <span className="muted">{once ? "in" : "from"}</span>
        <YearSelect years={years} value={entry.year} onChange={(y) => onChange({ ...entry, year: y, ...(once ? { until: y } : {}) })} />
        <span className="ei-span"><Select options={[{ value: "once", label: "only" }, { value: "on", label: "and on" }]} value={once ? "once" : "on"} onChange={(v) => onChange({ ...entry, until: v === "once" ? entry.year : undefined })} /></span>
        <span className="muted">{once ? "of" : "set to"}</span>
        <span className="ei-value"><FieldValueInput field={f} value={entry.value} onChange={(v) => onChange({ ...entry, value: v })} /></span>
      </>}>
      <div className="ei-row">
        <span className="input-wrap ei-note"><input placeholder="note (optional)" value={entry.note ?? ""} onChange={(e) => onChange({ ...entry, note: e.target.value || undefined })} /></span>
        <span className="muted small">{same ? "Same as the current value, so nothing changes yet." : "Applies in every scenario."}</span>
      </div>
    </InspectorShell>
  );
}
