import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The server with accounts on, against a throwaway data directory. Each test speaks plain HTTP,
 * carrying the session cookie by hand, the way a browser would.
 */
const root = resolve(import.meta.dir, "../../..");
const dataDir = mkdtempSync(join(tmpdir(), "taxonomy-auth-"));
const port = 5100 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof Bun.spawn>;

const H = { "content-type": "application/json", origin: base };
const post = (path: string, body: unknown, cookie?: string) => fetch(base + path, { method: "POST", headers: cookie ? { ...H, cookie } : H, body: JSON.stringify(body) });
const get = (path: string, cookie?: string) => fetch(base + path, { headers: cookie ? { cookie } : {} });
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0]!;

beforeAll(async () => {
  server = Bun.spawn(["bun", "packages/app/server.ts"], { cwd: root, stdout: "ignore", stderr: "pipe", env: { ...process.env, PORT: String(port), TAXONOMY_DATA: dataDir, TAXONOMY_AUTH: "1", TAXONOMY_SIGNUP: "closed", TAXONOMY_PUBLIC_HOST: "tax.example.test", TAXONOMY_DESKTOP_CONFIG: join(dataDir, "desktop.json") } });
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/auth/me"); return; } catch { await Bun.sleep(100); } }
  throw new Error("server did not start: " + (await new Response(server.stderr).text()));
});
afterAll(() => { server.kill(); rmSync(dataDir, { recursive: true, force: true }); });

let alice = "";
let bob = "";

describe("accounts", () => {
  test("nothing is served before signing in", async () => {
    const me = await (await get("/api/auth/me")).json();
    expect(me).toEqual({ enabled: true, user: null, signup: true, full: false });
    const res = await get("/api/profiles");
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("the first account can be created; an empty password or a bad email cannot", async () => {
    expect((await post("/api/auth/register", { email: "not an email", password: "long-enough-password" })).status).toBe(400);
    expect((await post("/api/auth/register", { email: "alice@example.com", password: "" })).status).toBe(400);
    const res = await post("/api/auth/register", { email: "Alice@Example.com", password: "correct horse battery" });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("taxonomy_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    alice = cookieOf(res);
    const me = await (await get("/api/auth/me", alice)).json() as { user: { email: string } };
    expect(me.user.email).toBe("alice@example.com");
  });

  test("sign-up closes after the first account", async () => {
    expect((await post("/api/auth/register", { email: "bob@example.com", password: "another good password" })).status).toBe(403);
    const me = await (await get("/api/auth/me")).json() as { signup: boolean };
    expect(me.signup).toBe(false);
  });

  test("a wrong password is refused, and too many tries are throttled", async () => {
    expect((await post("/api/auth/login", { email: "alice@example.com", password: "nope nope nope" })).status).toBe(401);
    expect((await post("/api/auth/login", { email: "nobody@example.com", password: "nope nope nope" })).status).toBe(401);
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await post("/api/auth/login", { email: "throttle@example.com", password: "nope nope nope" })).status;
    expect(last).toBe(429);
  });

  test("a cross-site sign-in attempt is refused before it reaches the password check", async () => {
    const res = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({ email: "alice@example.com", password: "correct horse battery" }) });
    expect(res.status).toBe(403);
  });

  test("each account has its own profiles", async () => {
    const created = await post("/api/profiles", { name: "Alice" }, alice);
    expect(created.status).toBe(200);
    const { id } = await created.json() as { id: string };
    expect(readdirSync(join(dataDir, "users")).length).toBe(1);

    // Bob joins on a server that was not closed: the first one under test runs with TAXONOMY_SIGNUP=closed.
    const port2 = port + 1;
    const server2 = Bun.spawn(["bun", "packages/app/server.ts"], { cwd: root, stdout: "ignore", stderr: "ignore", env: { ...process.env, PORT: String(port2), TAXONOMY_DATA: dataDir, TAXONOMY_AUTH: "1", TAXONOMY_SIGNUP: "" } });
    const base2 = `http://127.0.0.1:${port2}`;
    for (let i = 0; i < 50; i++) { try { await fetch(base2 + "/api/auth/me"); break; } catch { await Bun.sleep(100); } }
    try {
      const reg = await fetch(base2 + "/api/auth/register", { method: "POST", headers: { "content-type": "application/json", origin: base2 }, body: JSON.stringify({ email: "bob@example.com", password: "another good password" }) });
      expect(reg.status).toBe(200);
      bob = cookieOf(reg);
      // The sign-in card asks which way to go for an address; only an open server answers.
      const look = async (b: string, email: string) => (await (await fetch(b + "/api/auth/lookup", { method: "POST", headers: { "content-type": "application/json", origin: b }, body: JSON.stringify({ email }) })).json()) as { exists: boolean | null };
      expect(await look(base2, "BOB@example.com")).toEqual({ exists: true });
      expect(await look(base2, "nobody@example.com")).toEqual({ exists: false });
      expect(await look(base, "bob@example.com")).toEqual({ exists: null });
      const mine = await (await fetch(base2 + "/api/profiles", { headers: { cookie: bob } })).json() as unknown[];
      expect(mine).toEqual([]);
      const theirs = await fetch(base2 + `/api/profiles/${id}`, { headers: { cookie: bob } });
      expect(theirs.status).toBe(404);
      const history = await fetch(base2 + `/api/profiles/${id}/history`, { headers: { cookie: bob } });
      expect(await history.json()).toEqual([]);
    } finally { server2.kill(); }
  });

  test("an open server stops at its seat limit and says so", async () => {
    const port3 = port + 2;
    const server3 = Bun.spawn(["bun", "packages/app/server.ts"], { cwd: root, stdout: "ignore", stderr: "ignore", env: { ...process.env, PORT: String(port3), TAXONOMY_DATA: dataDir, TAXONOMY_AUTH: "1", TAXONOMY_SIGNUP: "", TAXONOMY_MAX_USERS: "2" } });
    const base3 = `http://127.0.0.1:${port3}`;
    for (let i = 0; i < 50; i++) { try { await fetch(base3 + "/api/auth/me"); break; } catch { await Bun.sleep(100); } }
    try {
      const me = await (await fetch(base3 + "/api/auth/me")).json() as { signup: boolean; full: boolean };
      expect(me).toMatchObject({ signup: false, full: true });
      const reg = await fetch(base3 + "/api/auth/register", { method: "POST", headers: { "content-type": "application/json", origin: base3 }, body: JSON.stringify({ email: "carol@example.com", password: "one more password" }) });
      expect(reg.status).toBe(403);
      expect(((await reg.json()) as { error: string }).error).toContain("full");
      expect((await fetch(base3 + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: base3 }, body: JSON.stringify({ email: "bob@example.com", password: "another good password" }) })).status).toBe(200);
    } finally { server3.kill(); }
  });

  test("signing out ends the session; a password change ends every other one", async () => {
    const second = cookieOf(await post("/api/auth/login", { email: "alice@example.com", password: "correct horse battery" }));
    expect((await get("/api/profiles", second)).status).toBe(200);
    expect((await post("/api/auth/password", { current: "wrong password here", next: "a brand new password" }, alice)).status).toBe(401);
    expect((await post("/api/auth/password", { current: "correct horse battery", next: "a brand new password" }, alice)).status).toBe(200);
    expect((await get("/api/profiles", second)).status).toBe(401);
    expect((await get("/api/profiles", alice)).status).toBe(200);
    const out = await post("/api/auth/logout", {}, alice);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await get("/api/profiles", alice)).status).toBe(401);
    expect((await post("/api/auth/login", { email: "alice@example.com", password: "a brand new password" })).status).toBe(200);
  });

  test("the local-machine routes are off on a hosted server", async () => {
    const cookie = cookieOf(await post("/api/auth/login", { email: "alice@example.com", password: "a brand new password" }));
    expect((await post("/api/agent/desktop", {}, cookie)).status).toBe(400);
    const agent = await (await get("/api/agent", cookie)).json() as { hosted: boolean; desktop: { added: boolean } };
    expect(agent.hosted).toBe(true);
    expect(agent.desktop.added).toBe(false);
  });
});
