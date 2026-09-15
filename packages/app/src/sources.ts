import type { Profile, Source } from "@taxonomy/engine";

/** Source string recorded for a profile path, if any. */
export function sourceOf(profile: Profile, path: (string | number)[]): string | undefined {
  const s: Source | undefined = profile.sources?.[path.join(".")];
  if (!s) return undefined;
  return typeof s === "string" ? s : `${s.doc}${s.asOf ? ` (${s.asOf})` : ""}${s.note ? ` · ${s.note}` : ""}`;
}
