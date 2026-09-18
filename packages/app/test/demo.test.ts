import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const dataDir = mkdtempSync(join(tmpdir(), "taxonomy-demo-"));
const port = 5190 + Math.floor(Math.random() * 5);
const base = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof Bun.spawn>;
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0]!;

beforeAll(async () => {
  server = Bun.spawn(["bun", "packages/app/server.ts"], { cwd: root, stdout: "ignore", stderr: "pipe", env: { ...process.env, PORT: String(port), TAXONOMY_DATA: dataDir, TAXONOMY_AUTH: "1", TAXONOMY_SIGNUP: "closed" } });
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/auth/me"); return; } catch { await Bun.sleep(100); } }
  throw new Error("server did not start: " + (await new Response(server.stderr).text()));
});
afterAll(() => { server.kill(); rmSync(dataDir, { recursive: true, force: true }); });

describe("/demo", () => {
  test("a visitor gets a throwaway account with Ada loaded, and no seat is taken", async () => {
    const res = await fetch(base + "/demo", { redirect: "manual" });
    expect(res.status).toBe(303);
    const cookie = cookieOf(res);
    expect(cookie.startsWith("taxonomy_session=")).toBe(true);
    const me = await (await fetch(base + "/api/auth/me", { headers: { cookie } })).json() as { user: { email: string; guest?: boolean } | null; signup: boolean };
    expect(me.user?.guest).toBe(true);
    // Sign-up is closed after the first account on this server; a guest is not that account.
    expect(((await (await fetch(base + "/api/auth/me")).json()) as { signup: boolean }).signup).toBe(true);
    const list = await (await fetch(base + "/api/profiles", { headers: { cookie } })).json() as { id: string; name: string }[];
    expect(list.map((p) => p.name)).toEqual(["Ada (demo)"]);
    expect(res.headers.get("location")).toBe(`/profiles/${list[0]!.id}`);
    // Coming back with the cookie reuses the same account and profile; a new visitor gets their own.
    const again = await fetch(base + "/demo", { redirect: "manual", headers: { cookie } });
    expect(again.headers.get("set-cookie")).toBeNull();
    expect(again.headers.get("location")).toBe(`/profiles/${list[0]!.id}`);
    await fetch(base + "/demo", { redirect: "manual" });
    expect((await fetch(base + `/profiles/${list[0]!.id}`, { headers: { cookie } })).headers.get("content-type")).toContain("text/html");
    expect(readdirSync(join(dataDir, "users")).length).toBe(2);
  });
  test("nobody can register or sign in at the guest address", async () => {
    const H = { "content-type": "application/json", origin: base };
    const reg = await fetch(base + "/api/auth/register", { method: "POST", headers: H, body: JSON.stringify({ email: "guest-abc@demo.invalid", password: "pw" }) });
    expect(reg.status).toBe(400);
  });
});
