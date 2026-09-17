import type { Line } from "./types.ts";

/**
 * A ledger collects every computed number for a year along with a plain-English reason.
 * The UI reads it to answer "why is this what it is?".
 */
export class Ledger {
  readonly lines: Record<string, Line> = {};
  readonly order: string[] = [];

  put(id: string, label: string, value: number, why: string, deps: string[] = [], unit: Line["unit"] = "usd"): number {
    if (!(id in this.lines)) this.order.push(id);
    this.lines[id] = { id, label, value, unit, why, deps };
    return value;
  }

  get(id: string): number {
    const line = this.lines[id];
    if (!line) throw new Error(`ledger has no line "${id}"`);
    return line.value;
  }
}

// One shared formatter: toLocaleString builds a new one per call, and the app formats thousands of numbers per render.
const INT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
export const int = (n: number): string => INT.format(Math.round(n));
export const usd = (n: number): string => (n < 0 ? "-" : "") + "$" + int(Math.abs(n));

export const pct = (r: number): string => `${(r * 100).toFixed(r * 100 % 1 === 0 ? 0 : 1)}%`;
