import { getPath, rsuVesting, timelineFields, type Profile } from "@taxonomy/engine";
import { shares, usdCompact } from "../../format.ts";
import type { FactMarker } from "./types.ts";

/** Markers for the strip: dated changes from the profile's timeline and RSU settlements. */
export function factMarkers(profile: Profile, years: number[], onEditEquity: () => void): FactMarker[] {
  const out: FactMarker[] = [];
  const fields = timelineFields();
  for (const [i, t] of (profile.timeline ?? []).entries()) {
    const f = fields.find((x) => x.path === t.path);
    const v = t.value;
    const detail = getPath(profile, t.path) === v ? "same as now" : typeof v === "number" ? (f?.type === "pct" ? `${(v * 100).toFixed(1)}%` : usdCompact(v)) : String(v);
    out.push({ id: t.id ?? `t-${t.year}-${t.path}`, year: t.year, label: f?.label ?? t.path, detail: t.until === undefined ? `${detail} · from ${t.year}` : detail, entryIndex: i });
  }
  if (profile.equity.grants.some((g) => g.type === "rsu")) {
    for (const y of years) {
      const v = rsuVesting(profile, y);
      if (v.shares > 0) out.push({ id: `rsu${y}`, year: y, label: "RSUs settle", detail: `${shares(v.shares)} · ${usdCompact(v.income)}`, edit: onEditEquity });
    }
  }
  return out;
}
