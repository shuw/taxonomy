import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseProfile } from "@taxonomy/engine";

const root = resolve(import.meta.dir, "../../..");
// The in-process import below must never see the real data directory.
process.env.TAXONOMY_DATA ??= mkdtempSync(join(tmpdir(), "taxonomy-sec-unit-"));

describe("who is asking", () => {
  test("behind a trusted proxy the real address is Fly's header or the last forwarded entry, never the first", async () => {
    process.env.TAXONOMY_TRUST_PROXY = "fly";
    const { clientKey, limited } = await import("../auth.ts");
    const req = (h: Record<string, string>) => new Request("http://x/", { headers: h });
    expect(clientKey(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }), "10.0.0.1")).toBe("203.0.113.9");
    expect(clientKey(req({ "fly-client-ip": "198.51.100.4", "x-forwarded-for": "6.6.6.6, 203.0.113.9" }), "10.0.0.1")).toBe("198.51.100.4");
    expect(clientKey(req({}), "10.0.0.1")).toBe("10.0.0.1");
    expect(limited("t", "a", 2, 60_000)).toBeNull();
    expect(limited("t", "a", 2, 60_000)).toBeNull();
    expect(limited("t", "a", 2, 60_000)).toBeGreaterThan(0);
    expect(limited("t", "b", 2, 60_000)).toBeNull();
  });
  test("a plan longer than forty years is refused at parse", () => {
    const base = "version: 3\nname: x\nfiler: { filingStatus: single, state: WA }\nplan: { startYear: 2026, years: YEARS }\nassumptions: { inflation: 0.02, wageGrowth: 0.03, fmvGrowth: 0.1 }\npeople: { self: { salary: 1 } }\nequity: { companies: [], grants: [] }\n";
    expect(() => parseProfile(base.replace("YEARS", "41"))).toThrow(/at most 40/);
    expect(parseProfile(base.replace("YEARS", "40")).plan.years).toBe(40);
  });
});

describe("a hosted server", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "taxonomy-sec-"));
  const port = 5170 + Math.floor(Math.random() * 5);
  const base = `http://127.0.0.1:${port}`;
  let server: ReturnType<typeof Bun.spawn>;
  const H = { "content-type": "application/json", origin: base };
  beforeAll(async () => {
    server = Bun.spawn(["bun", "packages/app/server.ts"], { cwd: root, stdout: "ignore", stderr: "pipe", env: { ...process.env, PORT: String(port), TAXONOMY_DATA: dataDir, TAXONOMY_AUTH: "1", TAXONOMY_PUBLIC_HOST: "tax.example.test", TAXONOMY_SECURE_COOKIES: "1", TAXONOMY_DESKTOP_CONFIG: join(dataDir, "desktop.json") } });
    for (let i = 0; i < 100; i++) { try { await fetch(base + "/api/auth/me"); return; } catch { await Bun.sleep(100); } }
    throw new Error("server did not start: " + (await new Response(server.stderr).text()));
  });
  afterAll(() => { server.kill(); rmSync(dataDir, { recursive: true, force: true }); });

  test("serves the page with a content-security policy and no framing, and its assets immutable", async () => {
    for (const path of ["/", "/profiles/anyone"]) {
      const r = await fetch(base + path);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(r.headers.get("x-frame-options")).toBe("DENY");
      expect(r.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    }
    const html = await (await fetch(base + "/")).text();
    const src = /src="(\/[^"]+\.js)"/.exec(html)?.[1];
    expect(src).toBeDefined();
    const asset = await fetch(base + src!);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect((await fetch(base + "/../etc/passwd")).status).toBe(404);
    expect((await fetch(base + "/nope.js")).status).toBe(404);
  });
  test("a body that is not JSON is a 400, not a 500", async () => {
    const r = await fetch(base + "/api/auth/login", { method: "POST", headers: H, body: "{nope" });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(/not valid JSON/);
  });
  test("sign-up, lookup and the demo are throttled per address", async () => {
    const reg = (i: number) => fetch(base + "/api/auth/register", { method: "POST", headers: H, body: JSON.stringify({ email: `p${i}@example.test`, password: "pw" }) });
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await reg(i)).status);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
    const look = () => fetch(base + "/api/auth/lookup", { method: "POST", headers: H, body: JSON.stringify({ email: "p1@example.test" }) });
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await look()).status;
    expect(last).toBe(429);
    let demo = 0;
    for (let i = 0; i < 11; i++) demo = (await fetch(base + "/demo", { redirect: "manual" })).status;
    expect(demo).toBe(429);
  }, 60_000);
});
