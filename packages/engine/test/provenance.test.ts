import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseProfile, editProfileText } from "../src/profile.ts";
import { sourcesAfterEdit, describeSource } from "../src/provenance.ts";

const example = readFileSync(new URL("../../../data/profile.example.yaml", import.meta.url), "utf8");

describe("sources after a hand edit", () => {
  const p = parseProfile(editProfileText(example, [{ path: ["sources"], value: { "people.self.salary": "2025 pay stub, box 1", "grants.g1": { doc: "grant notice", asOf: "2026-01-05" } } }]));
  test("a changed value gets 'you' with the old provenance kept", () => {
    const extra = sourcesAfterEdit(p, [{ path: ["people", "self", "salary"], value: 400_000 }], "2026-09-17");
    expect(extra).toEqual([{ path: ["sources", "people.self.salary"], value: { doc: "you", asOf: "2026-09-17", note: "was: 2025 pay stub, box 1" } }]);
    const after = parseProfile(editProfileText(example, [{ path: ["sources"], value: p.sources }, { path: ["people", "self", "salary"], value: 400_000 }, ...extra]));
    expect(describeSource(after.sources!["people.self.salary"]!)).toBe("you (2026-09-17) · was: 2025 pay stub, box 1");
  });
  test("grant fields map to the grant's source; unchanged, unsourced and bookkeeping edits are left alone", () => {
    expect(sourcesAfterEdit(p, [{ path: ["equity", "grants", 0, "strike"], value: 3 }], "2026-09-17")[0]?.path).toEqual(["sources", "grants.g1"]);
    expect(sourcesAfterEdit(p, [{ path: ["people", "self", "salary"], value: p.people.self.salary }])).toEqual([]);
    expect(sourcesAfterEdit(p, [{ path: ["people", "self", "bonus"], value: 10 }])).toEqual([]);
    expect(sourcesAfterEdit(p, [{ path: ["scenarios", "default", "events"], value: [] }, { path: ["timeline"], value: [] }])).toEqual([]);
  });
});
