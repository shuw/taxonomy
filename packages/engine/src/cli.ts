import { readFileSync } from "node:fs";
import { parseProfile } from "./profile.ts";
import { runPlan } from "./plan.ts";
import { amtCrossover } from "./thresholds.ts";
import { usd, pct } from "./ledger.ts";

const path = process.argv[2] ?? "data/profile.yaml";
const profile = parseProfile(readFileSync(path, "utf8"));
const plan = runPlan(profile);

const rows = ["wages", "rsuIncome", "nsoIncome", "agi", "taxableIncome", "regularTax", "isoBargainElement", "tentativeMinimumTax", "amt", "amtCreditGenerated", "amtCreditUsed", "amtCreditCarryforwardOut", "niit", "stateTax", "totalTax", "effectiveRate"];
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
