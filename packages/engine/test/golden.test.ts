import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseProfile } from "../src/profile.ts";
import { runPlan } from "../src/plan.ts";
import { activeLevers } from "../src/timeline.ts";

/**
 * Every line of every year for two whole profiles, pinned. A change that moves numbers must
 * update the file on purpose: `bun run golden`. The diff then shows exactly what moved.
 */
const CASES = [
  { name: "demo", file: "../../../data/demo.yaml" },
  { name: "example", file: "../../../data/profile.example.yaml" },
];
const round = (v: number, unit: string) => (unit === "rate" ? Math.round(v * 10_000) / 10_000 : Math.round(v * 100) / 100);

function ledgerOf(file: string) {
  const profile = parseProfile(readFileSync(new URL(file, import.meta.url), "utf8"));
  const plan = runPlan(profile, activeLevers(profile));
  const years = Object.fromEntries(plan.years.map((y) => [y.year, Object.fromEntries(y.order.map((id) => [id, round(y.lines[id]!.value, y.lines[id]!.unit)]))]));
  const totals = Object.fromEntries(Object.entries(plan.totals).map(([k, v]) => [k, round(v, k.startsWith("rate") ? "rate" : "usd")]));
  return { years, totals };
}

describe("golden ledgers", () => {
  for (const c of CASES) {
    test(`${c.name}: every line of every year matches the pinned ledger`, () => {
      const got = ledgerOf(c.file);
      const path = new URL(`./golden/${c.name}.json`, import.meta.url);
      if (process.env.UPDATE_GOLDEN === "1" || !existsSync(path)) { writeFileSync(path, JSON.stringify(got, null, 1) + "\n"); }
      const want = JSON.parse(readFileSync(path, "utf8")) as typeof got;
      const diffs: string[] = [];
      for (const [year, lines] of Object.entries(want.years)) for (const [id, v] of Object.entries(lines)) { const g = got.years[year]?.[id]; if (g === undefined || Math.abs(g - v) > 0.005) diffs.push(`${year} ${id}: ${v} -> ${g}`); }
      for (const [year, lines] of Object.entries(got.years)) for (const id of Object.keys(lines)) if (want.years[year]?.[id] === undefined) diffs.push(`${year} ${id}: new line ${lines[id]}`);
      for (const [k, v] of Object.entries(want.totals)) if (Math.abs((got.totals[k] ?? NaN) - v) > 0.005) diffs.push(`totals ${k}: ${v} -> ${got.totals[k]}`);
      expect(diffs, `ledger drifted from test/golden/${c.name}.json; if intended, run: bun run golden\n` + diffs.slice(0, 20).join("\n")).toEqual([]);
    });
  }
});
