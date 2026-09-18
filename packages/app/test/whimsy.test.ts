import { describe, expect, test } from "bun:test";
import { DEMO_CURRENCIES, TAX_TRIVIA, emptyGrantsLine, hashOf, nextTrivia, zeroAside } from "../src/whimsy.ts";

describe("the small jokes", () => {
  test("an aside lands only on zero lines, rarely, and always on the same ones", () => {
    expect(zeroAside("amt", 2026, 1200)).toBeUndefined();
    const hits: string[] = [];
    for (let y = 2026; y < 2226; y++) for (const id of ["amt", "stateTax", "giving", "niit"]) { const a = zeroAside(id, y, 0); if (a) hits.push(`${id}:${y}`); expect(a).toBe(zeroAside(id, y, 0)); }
    expect(hits.length).toBeGreaterThan(10);
    expect(hits.length).toBeLessThan(80);
    const seen = new Set<string>();
    for (let i = 0; i < TAX_TRIVIA.length; i++) seen.add(nextTrivia().text);
    expect(seen.size).toBe(TAX_TRIVIA.length);
    for (const f of TAX_TRIVIA) expect(f.source.length).toBeGreaterThan(5);
    for (const c of DEMO_CURRENCIES) expect(c.symbol.length).toBeGreaterThan(0);
    expect(emptyGrantsLine("plain").startsWith("No grants yet") || emptyGrantsLine("plain") === "plain").toBe(true);
    expect(hashOf("a")).not.toBe(hashOf("b"));
  });
});
