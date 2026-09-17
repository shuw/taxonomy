import type { Profile, Source } from "@taxonomy/engine";

/** Source string recorded for a profile path, if any. */
export function sourceOf(profile: Profile, path: (string | number)[]): string | undefined {
  const s: Source | undefined = profile.sources?.[path.join(".")];
  if (!s) return undefined;
  return typeof s === "string" ? s : `${s.doc}${s.asOf ? ` (${s.asOf})` : ""}${s.note ? ` · ${s.note}` : ""}`;
}

/** Notes Claude left about a value (judgment calls it made), for the field that holds it. */
export function notesOf(profile: Profile, path: (string | number)[]): string | undefined {
  const key = path.join(".");
  const notes = (profile.followUps ?? []).filter((f) => !f.resolved && f.kind !== "missing" && f.about === key).map((f) => f.text);
  return notes.length ? notes.join("\n\n") : undefined;
}
