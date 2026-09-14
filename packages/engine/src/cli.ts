import { readFileSync } from "node:fs";
import { parseProfile } from "./profile.ts";
import { runPlan } from "./plan.ts";
import { amtCrossover } from "./thresholds.ts";
import { usd, pct } from "./ledger.ts";
import { calibrate } from "./calibration.ts";

const path = process.argv[2] ?? "data/profile.yaml";
const profile = parseProfile(readFileSync(path, "utf8"));
const plan = runPlan(profile);

const rows = ["salarySelf", "rsuIncome", "nsoIncome", "wages", "agi", "deduction", "taxableIncome", "regularTax", "isoBargainElement", "tentativeMinimumTax", "amt", "amtCreditGenerated", "amtCreditUsed", "amtCreditCarryforwardOut", "niit", "stateTax", "totalTax", "effectiveRate"];
const w = 12;
console.log("".padEnd(28) + plan.years.map((y) => String(y.year).padStart(w)).join(""));
for (const id of rows) {
  const label = plan.years[0]!.lines[id]!.label;
  console.log(label.padEnd(28) + plan.years.map((y) => { const l = y.lines[id]!; return (l.unit === "rate" ? pct(l.value) : usd(l.value)).padStart(w); }).join(""));
}
console.log("");
for (const y of plan.years) {
  const c = amtCrossover(profile, undefined, y.year);
  console.log(`${y.year}: exercising ${y.inputs.isoSharesExercised} of ${c.available} exercisable ISO shares; AMT starts after ${c.sharesBeforeAmt} shares${c.overCrossover ? " (over)" : ""}`);
}
console.log(`\nPlan total tax ${usd(plan.totals.totalTax)}, of which AMT ${usd(plan.totals.amt)}; AMT credit left at end ${usd(plan.totals.amtCreditCarryforwardEnd)}`);
const cal = calibrate(profile);
if (cal) {
  console.log(`\nCalibration against the ${cal.year} return:`);
  for (const r of cal.rows) console.log(`  ${r.label.padEnd(34)} reported ${usd(r.reported).padStart(12)}  computed ${usd(r.computed).padStart(12)}  ${(r.delta >= 0 ? "+" : "-") + usd(Math.abs(r.delta))}`);
}
