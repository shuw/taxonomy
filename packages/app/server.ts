import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { homedir, platform } from "node:os";
import { parse } from "yaml";
import { editProfileText, migrateProfileText, parseProfile, tools } from "@taxonomy/engine";
// Paths, ids, history, attachments and the remote secret are shared with the MCP server, so the two never drift.
import { ID, dataDir, examplePath, nameTaken as nameIsTaken, root, rootStore, userStore, usersDir, type Store } from "../mcp/store.ts";
import { AuthError, HOST, authEnabled, changePassword, clientKey, deleteAccount, login, logout, loopback, register, sessionCookie, sessionIdOf, signupOpen, userFor, type User } from "./auth.ts";
import { existsSync as exists, readdirSync } from "node:fs";
const { answeredFollowUps } = tools;
import index from "./index.html";

/** With accounts, a hosted deployment's public host name, for the connector address it shows; when unset, the tunnel address saved in local mode (an ngrok host on a laptop) serves. */
const publicHost = process.env.TAXONOMY_PUBLIC_HOST?.trim() || (authEnabled ? rootStore.remoteConfigIfAny()?.tunnelHost ?? null : null);

if (!authEnabled) {
  mkdirSync(rootStore.profilesDir, { recursive: true, mode: 0o700 });
  const legacyPath = resolve(dataDir, "profile.yaml");
  if (existsSync(legacyPath)) {
    const target = resolve(rootStore.profilesDir, "profile.yaml");
    if (!existsSync(target)) {
      renameSync(legacyPath, target);
      console.log(`moved data/profile.yaml to data/profiles/profile.yaml`);
    }
  }
}

/** The name inside a profile's text, or the id when it has none. */
function nameOf(text: string, id: string): string {
  try {
    const raw = parse(text) as { name?: unknown } | null;
    if (raw && typeof raw.name === "string" && raw.name.trim()) return raw.name.trim();
  } catch {}
  return id;
}

function listProfiles(store: Store) {
  return store.listProfiles()
    .map(({ id, name }) => { const path = store.fileFor(id); return { id, name, path: relative(root, path), mtime: statSync(path).mtimeMs }; })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function readProfile(store: Store, id: string) {
  const path = store.fileFor(id);
  let text = readFileSync(path, "utf8");
  // A file the engine cannot read is still handed over as text, so the page can say what is wrong and where.
  let migrated = text;
  try { migrated = migrateProfileText(text); } catch { return { id, path: relative(root, path), mtime: statSync(path).mtimeMs, text }; }
  if (migrated !== text) {
    writeFileSync(path, migrated, { mode: 0o600 });
    text = migrated;
    console.log(`migrated ${relative(root, path)} to typed grants`);
  }
  return { id, path: relative(root, path), mtime: statSync(path).mtimeMs, text };
}

const bad = (message: string, status = 400) => Response.json({ error: message }, { status });

/**
 * Only the app's own page may change things. A browser sends Origin on cross-site requests;
 * requiring JSON also forces a CORS preflight, which this server never approves.
 */
function sameOrigin(req: Request): Response | null {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host") ?? "";
  if (origin !== null) {
    let ok = false;
    try { ok = new URL(origin).host === host; } catch { ok = false; } // "null" and other opaque origins are refused, not thrown on
    if (!ok) return bad("cross-origin request refused", 403);
  }
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return bad("cross-site request refused", 403);
  if (req.method !== "DELETE" && !(req.headers.get("content-type") ?? "").startsWith("application/json")) return bad("expected application/json", 415);
  return null;
}

/** Nothing but a name: no pay, no equity, nothing pending, nothing dated. */
function isEmptyProfile(p: ReturnType<typeof parseProfile>): boolean {
  const none = (o: object | undefined): boolean => !o || Object.values(o).every((v) => v === undefined || v === 0 || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && none(v as object)));
  const self = p.people.self;
  return self.salary === 0 && !self.bonus && !self.pretaxContributions && !p.people.spouse && !(p.filer.dependents?.length)
    && p.equity.grants.length === 0 && p.equity.companies.length === 0 && !(p.equity.holdings?.length)
    && none(p.income) && none(p.home) && none(p.deductions) && none(p.carryforwards)
    && !p.pendingIntake && !(p.pending?.length) && !(p.timeline?.length) && !(p.returns?.length) && !(p.followUps?.length) && none(p.sources)
    && Object.values(p.scenarios ?? {}).every((s) => s.events.length === 0);
}

function validate(text: unknown): string | null {
  if (typeof text !== "string") return "text is required";
  try { parseProfile(text); return null; } catch (e) { return String((e as Error).message ?? e); }
}

// ---- who is asking: without accounts everyone is the one user of this machine; with accounts, the session says ----
class Unauthenticated extends Error {}
const stores = new WeakMap<Request, Store>();
const users = new WeakMap<Request, User>();
/** The store this request may touch; set by the guard before any handler runs. */
const storeOf = (req: Request): Store => { const s = stores.get(req); if (!s) throw new Unauthenticated(); return s; };
function whoIs(req: Request): { store: Store; user: User | null } {
  if (!authEnabled) return { store: rootStore, user: null };
  const user = userFor(sessionIdOf(req));
  if (!user) throw new Unauthenticated();
  return { store: userStore(user.id), user };
}
function withHeaders(res: Response, api = true): Response {
  res.headers.set("x-content-type-options", "nosniff");
  if (api) res.headers.set("cache-control", "no-store");
  return res;
}
type Handler = (req: Request & { params: Record<string, string> }) => Response | Promise<Response>;
/** Every profile route runs behind this: no session, no store, no handler. */
function guard(handler: Handler): Handler {
  return async (req) => {
    try {
      const who = whoIs(req);
      stores.set(req, who.store);
      if (who.user) users.set(req, who.user);
      return withHeaders(await handler(req));
    } catch (e) {
      if (e instanceof Unauthenticated) return withHeaders(Response.json({ error: "sign in to continue", signup: authEnabled && signupOpen() }, { status: 401 }));
      throw e;
    }
  };
}
const authFailed = (e: unknown) => {
  if (e instanceof AuthError) return withHeaders(Response.json({ error: e.message }, { status: e.status, headers: e.retryAfter ? { "retry-after": String(e.retryAfter) } : {} }));
  throw e;
};

/** Claude Desktop's config file on this machine, and whether Taxonomy is in it. */
function desktopConfigPath(): string {
  if (process.env.TAXONOMY_DESKTOP_CONFIG) return process.env.TAXONOMY_DESKTOP_CONFIG;
  if (platform() === "win32") return resolve(process.env.APPDATA ?? resolve(homedir(), "AppData/Roaming"), "Claude/claude_desktop_config.json");
  if (platform() === "darwin") return resolve(homedir(), "Library/Application Support/Claude/claude_desktop_config.json");
  return resolve(process.env.XDG_CONFIG_HOME ?? resolve(homedir(), ".config"), "Claude/claude_desktop_config.json");
}
function readDesktopConfig(): Record<string, unknown> | null {
  try { return JSON.parse(readFileSync(desktopConfigPath(), "utf8")) as Record<string, unknown>; } catch { return null; }
}
function desktopState(script: string) {
  const path = desktopConfigPath();
  const config = readDesktopConfig();
  const entry = (config?.mcpServers as Record<string, { args?: string[] }> | undefined)?.taxonomy;
  const installed = platform() === "darwin" ? existsSync("/Applications/Claude.app") : existsSync(resolve(path, "..")); // the folder exists once the app has run
  return { configPath: path, installed, added: Array.isArray(entry?.args) && entry!.args!.includes(script) };
}

/** What an MCP client needs to start Taxonomy's server: the runtime and the absolute script path. */
function agentConnection(store: Store) {
  const script = resolve(import.meta.dir, "../mcp/server.ts");
  const bun = Bun.which("bun") ?? "bun";
  let lastSeen: string | null = null;
  let client: string | null = null;
  let lastProfile: string | null = null;
  try {
    const seen = JSON.parse(readFileSync(store.agentFile, "utf8")) as { lastSeen?: string; client?: string; profile?: string };
    lastSeen = seen.lastSeen ?? null;
    client = seen.client ?? null;
    lastProfile = seen.profile ?? null;
  } catch {}
  let current: string | null = null;
  try { current = readFileSync(store.currentFile, "utf8").trim() || null; } catch {}
  // On a hosted server there is no Claude Desktop on this machine to configure; the local paths are still reported for a stdio client.
  const desktop = authEnabled ? { configPath: "", installed: false, added: false } : desktopState(script);
  return { root: resolve(import.meta.dir, "../.."), script, command: bun, args: [script], config: { mcpServers: { taxonomy: { command: bun, args: [script] } } }, lastSeen, client, lastProfile, current, desktop, hosted: authEnabled };
}

/** Put Taxonomy into Claude Desktop's config, touching only the `taxonomy` entry and keeping a backup of the file. */
function addToDesktop(store: Store): { ok: true } | { error: string } {
  const conn = agentConnection(store);
  const path = desktopConfigPath();
  const existing = readDesktopConfig();
  if (existsSync(path) && existing === null) return { error: `${path} is not valid JSON; edit it by hand` };
  const config = existing ?? {};
  const servers = (typeof config.mcpServers === "object" && config.mcpServers ? config.mcpServers : {}) as Record<string, unknown>;
  servers.taxonomy = { command: conn.command, args: conn.args };
  config.mcpServers = servers;
  try {
    mkdirSync(resolve(path, ".."), { recursive: true });
    if (existsSync(path)) writeFileSync(`${path}.before-taxonomy`, readFileSync(path));
    writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
    return { ok: true };
  } catch (e) { return { error: String((e as Error).message ?? e) }; }
}

/** Bring Claude Desktop to the front, starting it if needed (macOS). */
async function openDesktop(): Promise<{ ok: boolean }> {
  if (platform() !== "darwin") return { ok: false };
  const proc = Bun.spawn(["open", "-a", "Claude"], { stdout: "ignore", stderr: "ignore" });
  return { ok: (await proc.exited) === 0 };
}

// ---- claude.ai: the HTTP MCP server on localhost, one process for every store. Locally the user exposes it with a
// tunnel; hosted, this server proxies /<secret>/mcp to it so one public address serves both. ----
const tailscaleBin = Bun.which("tailscale") ?? (existsSync("/Applications/Tailscale.app/Contents/MacOS/Tailscale") ? "/Applications/Tailscale.app/Contents/MacOS/Tailscale" : null);
let httpChild: ReturnType<typeof Bun.spawn> | null = null;
const mcpPort = () => rootStore.remoteConfig().port;

async function read(args: string[]): Promise<string> {
  try { const p = Bun.spawn(args, { stdout: "pipe", stderr: "ignore" }); const out = await new Response(p.stdout).text(); await p.exited; return out; } catch { return ""; }
}
async function httpRunning(port: number): Promise<boolean> {
  try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) }); return true; } catch { return false; }
}
async function tunnelState(port: number): Promise<{ available: boolean; dnsName: string | null; on: boolean }> {
  if (!tailscaleBin || authEnabled) return { available: false, dnsName: null, on: false };
  let dnsName: string | null = null;
  try { dnsName = ((JSON.parse(await read([tailscaleBin, "status", "--json"])) as { Self?: { DNSName?: string } }).Self?.DNSName ?? "").replace(/\.$/, "") || null; } catch {}
  const st = await read([tailscaleBin, "funnel", "status", "--json"]);
  return { available: dnsName !== null, dnsName, on: st.includes("AllowFunnel") && st.includes(`:${port}`) };
}
async function remoteState(store: Store) {
  const cfg = store.remoteConfig();
  const port = mcpPort();
  const [running, tunnel] = await Promise.all([httpRunning(port), tunnelState(port)]);
  const url = !running ? null : publicHost ? `https://${publicHost}/${cfg.token}/mcp` : tunnel.on && tunnel.dnsName ? `https://${tunnel.dnsName}/${cfg.token}/mcp` : null;
  return {
    running, port, tunnel,
    funnelCommand: tailscaleBin && !authEnabled ? `${tailscaleBin.includes("Tailscale.app") ? tailscaleBin : "tailscale"} funnel --bg ${port}` : null,
    path: `/${cfg.token}/mcp`,
    tunnelHost: publicHost ?? cfg.tunnelHost ?? null,
    url,
  };
}
/** The child's pid is kept with the root secret so a restarted app can replace a child left over from the previous one. */
function rememberChild(pid: number | undefined): void {
  try { rootStore.saveRemoteConfig({ pid }); } catch {}
}
/** True when the process is still the MCP server we started, so a reused pid is never signalled. */
function isOurHttpServer(pid: number): boolean {
  try { return Bun.spawnSync(["ps", "-p", String(pid), "-o", "command="]).stdout.toString().includes("packages/mcp/http.ts"); } catch { return false; }
}
function stopChild(): void {
  const { pid } = rootStore.remoteConfig();
  httpChild?.kill();
  if (pid && pid !== httpChild?.pid && isOurHttpServer(pid)) { try { process.kill(pid); } catch { /* already gone */ } }
  httpChild = null;
  rememberChild(undefined);
}
async function serveLocal(on: boolean, fresh = false): Promise<void> {
  const port = mcpPort();
  if (!on) { stopChild(); return; }
  if (fresh) { stopChild(); for (let i = 0; i < 20 && (await httpRunning(port)); i++) await Bun.sleep(100); }
  else if (await httpRunning(port)) return;
  httpChild = Bun.spawn([Bun.which("bun") ?? "bun", resolve(root, "packages/mcp/http.ts")], { stdout: "ignore", stderr: "ignore", env: { ...process.env, TAXONOMY_DATA: dataDir } });
  rememberChild(httpChild.pid);
  for (let i = 0; i < 20 && !(await httpRunning(port)); i++) await Bun.sleep(100);
}
/** Anyone with remote access set up and not turned off wants the child running. */
function remoteWanted(): boolean {
  const wants = (s: Store) => { const c = s.remoteConfigIfAny(); return !!c && c.enabled !== false && !!(c.tunnelHost || (authEnabled && publicHost)); };
  if (wants(rootStore)) return true;
  if (!authEnabled || !exists(usersDir)) return false;
  return readdirSync(usersDir).some((id) => { try { return wants(userStore(id)); } catch { return false; } });
}
/** With accounts, turning remote access off for the last user stops the child. */
function remoteStillWanted(): boolean { return remoteWanted(); }
process.on("exit", () => httpChild?.kill());
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { httpChild?.kill(); process.exit(0); });
// The HTTP server comes up with the app once someone has set claude.ai up, replacing any child from a previous run so it runs the current code.
if (remoteWanted()) void serveLocal(true, true);

/** The user behind a guarded request; only meaningful with accounts. */
const userOf = (req: Request): User => { const u = users.get(req); if (!u) throw new Unauthenticated(); return u; };

const port = Number(process.env.PORT ?? 5180);
const server = Bun.serve({
  port,
  hostname: HOST,
  // Rebuild the page as files change while developing on this machine; a hosted server builds once.
  development: loopback,
  routes: {
    "/": index,
    // ---- accounts ----
    "/api/auth/me": (req: Request) => {
      let user: User | null = null;
      try { user = authEnabled ? userFor(sessionIdOf(req)) : null; } catch {}
      return withHeaders(Response.json({ enabled: authEnabled, user: user ? { id: user.id, email: user.email } : null, signup: authEnabled && !user && signupOpen() }));
    },
    "/api/auth/register": { POST: async (req: Request) => {
      const refused = sameOrigin(req);
      if (refused) return refused;
      if (!authEnabled) return bad("accounts are off on this server", 404);
      const body = (await req.json()) as { email?: unknown; password?: unknown };
      try {
        const user = await register(body.email, body.password);
        const { sessionId } = await login(user.email, body.password, clientKey(req, server.requestIP(req)?.address));
        return withHeaders(Response.json({ user: { id: user.id, email: user.email } }, { headers: { "set-cookie": sessionCookie(sessionId, req) } }));
      } catch (e) { return authFailed(e); }
    } },
    "/api/auth/login": { POST: async (req: Request) => {
      const refused = sameOrigin(req);
      if (refused) return refused;
      if (!authEnabled) return bad("accounts are off on this server", 404);
      const body = (await req.json()) as { email?: unknown; password?: unknown };
      try {
        const { user, sessionId } = await login(body.email, body.password, clientKey(req, server.requestIP(req)?.address));
        return withHeaders(Response.json({ user: { id: user.id, email: user.email } }, { headers: { "set-cookie": sessionCookie(sessionId, req) } }));
      } catch (e) { return authFailed(e); }
    } },
    "/api/auth/logout": { POST: (req: Request) => {
      const refused = sameOrigin(req);
      if (refused) return refused;
      if (authEnabled) logout(sessionIdOf(req));
      return withHeaders(Response.json({ ok: true }, { headers: { "set-cookie": sessionCookie(null, req) } }));
    } },
    "/api/auth/password": { POST: guard(async (req) => {
      const refused = sameOrigin(req);
      if (refused) return refused;
      if (!authEnabled) return bad("accounts are off on this server", 404);
      const body = (await req.json()) as { current?: unknown; next?: unknown };
      try { await changePassword(userOf(req), body.current, body.next, sessionIdOf(req) ?? ""); return Response.json({ ok: true }); } catch (e) { return authFailed(e); }
    }) },
    // The account and everything under it: profiles, history, attachments, the connector secret. The password is asked once more.
    "/api/auth/delete": { POST: guard(async (req) => {
      const refused = sameOrigin(req);
      if (refused) return refused;
      if (!authEnabled) return bad("accounts are off on this server", 404);
      const body = (await req.json()) as { password?: unknown };
      const user = userOf(req);
      try { await deleteAccount(user, body.password); } catch (e) { return authFailed(e); }
      const dir = storeOf(req).dir;
      if (dir.startsWith(usersDir + sep) && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      console.log(`deleted account ${user.email} and ${relative(root, dir)}`);
      return Response.json({ ok: true }, { headers: { "set-cookie": sessionCookie(null, req) } });
    }) },
    // ---- hosted: the connector address for claude.ai goes through this server to the MCP child ----
    "/:token/mcp": async (req: Request & { params: { token: string } }) => {
      if (!authEnabled) return new Response("not found", { status: 404 });
      const token = req.params.token;
      if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return new Response("not found", { status: 404 });
      if (!(await httpRunning(mcpPort()))) return new Response("the MCP server is not running", { status: 503 });
      const headers = new Headers();
      for (const h of ["content-type", "accept", "mcp-session-id", "mcp-protocol-version", "last-event-id"]) { const v = req.headers.get(h); if (v) headers.set(h, v); }
      const upstream = await fetch(`http://127.0.0.1:${mcpPort()}/${token}/mcp`, { method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body, ...({ duplex: "half" } as object) });
      return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
    },
    "/api/example": guard(() => Response.json({ text: readFileSync(examplePath, "utf8") })),
    // Documents behind the numbers: page images, PDFs, statements. Stored beside the profile, cited by name in sources.
    "/api/profiles/:id/attachments": {
      GET: guard((req) => {
        const { id } = req.params as { id: string; name: string };
        if (!ID.test(id)) return bad("no such profile", 404);
        return Response.json(storeOf(req).listAttachments(id));
      }),
      POST: guard(async (req) => {
        const refused = sameOrigin(req);
        if (refused) return refused;
        const s = storeOf(req);
        const { id } = req.params as { id: string; name: string };
        if (!ID.test(id) || !existsSync(s.fileFor(id))) return bad("no such profile", 404);
        const body = (await req.json()) as { name?: string; base64?: string };
        try { s.saveAttachment(id, body.name ?? "", Buffer.from(body.base64 ?? "", "base64")); } catch (e) { return bad((e as Error).message); }
        return Response.json(s.listAttachments(id));
      }),
    },
    "/api/profiles/:id/attachments/:name": {
      GET: guard((req) => {
        const { id, name } = req.params as { id: string; name: string };
        const file = storeOf(req).attachmentPath(id, name);
        if (!file || !existsSync(file)) return bad("no such document", 404);
        const shown = name.replace(/["\\]/g, "_");
        return new Response(Bun.file(file), { headers: { "content-disposition": `inline; filename="${shown}"` } });
      }),
      DELETE: guard((req) => {
        const refused = sameOrigin(req);
        if (refused) return refused;
        const s = storeOf(req);
        const { id, name } = req.params as { id: string; name: string };
        const file = s.attachmentPath(id, name);
        if (!file || !existsSync(file)) return bad("no such document", 404);
        unlinkSync(file);
        return Response.json(s.listAttachments(id));
      }),
    },
    "/api/profiles/:id/history": {
      GET: guard((req) => {
        const { id } = req.params as { id: string; name: string };
        if (!ID.test(id)) return bad("no such profile", 404);
        // Newest first; the text before each change stays on the server and is fetched only to restore.
        return Response.json(storeOf(req).readHistory(id).reverse().map(({ before, ...e }) => ({ ...e, restorable: before !== undefined })));
      }),
    },
    "/api/profiles/:id/restore": {
      POST: guard(async (req) => {
        const refused = sameOrigin(req);
        if (refused) return refused;
        const s = storeOf(req);
        const { id } = req.params as { id: string; name: string };
        if (!ID.test(id) || !existsSync(s.fileFor(id))) return bad("no such profile", 404);
        const { at, seen } = (await req.json()) as { at?: string; seen?: string };
        const log = s.readHistory(id);
        const entry = log.find((e) => e.at === at);
        if (!entry?.before) return bad("nothing to restore for that entry", 404);
        // `seen` is the newest entry the History list showed; a newer one means something wrote since.
        const latest = log[log.length - 1]?.at;
        if (seen && latest && latest > seen) return Response.json({ error: "the profile changed since the list was loaded; it has been refreshed", ...readProfile(s, id) }, { status: 409 });
        const problem = validate(entry.before);
        if (problem) return bad(`that version no longer parses: ${problem}`);
        const beforeText = readFileSync(s.fileFor(id), "utf8");
        writeFileSync(s.fileFor(id), entry.before, { mode: 0o600 });
        s.recordChange(id, beforeText, entry.before, "you", [`Restored the version from ${new Date(entry.at).toLocaleString()}`]);
        return Response.json(readProfile(s, id));
      }),
    },
    "/api/agent": guard(async (req) => Response.json({ ...agentConnection(storeOf(req)), remote: await remoteState(storeOf(req)) })),
    "/api/agent/remote": { POST: guard(async (req) => {
      const refused = sameOrigin(req);
      if (refused) return refused;
      const s = storeOf(req);
      const body = (await req.json()) as { on?: boolean; tunnelHost?: string };
      if (typeof body.on === "boolean") {
        s.saveRemoteConfig({ enabled: body.on });
        await serveLocal(body.on || remoteStillWanted());
      }
      // The tunnel's address is kept with the secret so every browser sees the same setup.
      if (typeof body.tunnelHost === "string") {
        const host = body.tunnelHost.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
        if (host && !/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) return bad("that is not a host name");
        s.saveRemoteConfig({ tunnelHost: host || undefined });
      }
      return Response.json({ ...agentConnection(s), remote: await remoteState(s) });
    }) },
    "/api/current": { POST: guard(async (req) => { const refused = sameOrigin(req); if (refused) return refused; const s = storeOf(req); const { id } = (await req.json()) as { id?: string }; if (!id || !ID.test(id) || !existsSync(s.fileFor(id))) return bad("no such profile", 404); mkdirSync(s.dir, { recursive: true, mode: 0o700 }); writeFileSync(s.currentFile, id, { mode: 0o600 }); return Response.json({ ok: true }); }) },
    "/api/agent/desktop": { POST: guard(async (req) => { const refused = sameOrigin(req); if (refused) return refused; if (authEnabled) return bad("Claude Desktop is set up on your own computer, not on this server"); const r = addToDesktop(storeOf(req)); return "error" in r ? bad(r.error) : Response.json({ ...agentConnection(storeOf(req)), remote: await remoteState(storeOf(req)) }); }) },
    "/api/agent/open": { POST: guard(async (req) => { const refused = sameOrigin(req); if (refused) return refused; if (authEnabled) return Response.json({ ok: false }); return Response.json(await openDesktop()); }) },
    "/api/profiles": {
      GET: guard((req) => Response.json(listProfiles(storeOf(req)))),
      POST: guard(async (req) => {
        const refused = sameOrigin(req);
        if (refused) return refused;
        const s = storeOf(req);
        const body = (await req.json()) as { name?: string; text?: string };
        const name = (body.name ?? "").trim();
        if (!name) return bad("name is required");
        if (nameIsTaken(listProfiles(s), name)) return bad(`a profile named "${name}" already exists`, 422);
        const text = editProfileText(body.text ?? readFileSync(examplePath, "utf8"), [{ path: ["name"], value: name }]);
        const problem = validate(text);
        if (problem) return bad(problem);
        mkdirSync(s.profilesDir, { recursive: true, mode: 0o700 });
        const id = s.uniqueId(name);
        writeFileSync(s.fileFor(id), text, { mode: 0o600 });
        s.recordChange(id, null, text, "you");
        return Response.json(readProfile(s, id));
      }),
    },
    "/api/profiles/:id": {
      GET: guard((req) => {
        const s = storeOf(req);
        const { id } = req.params as { id: string; name: string };
        if (!ID.test(id) || !existsSync(s.fileFor(id))) return bad("no such profile", 404);
        return Response.json(readProfile(s, id));
      }),
      PUT: guard(async (req) => {
        const refused = sameOrigin(req);
        if (refused) return refused;
        const s = storeOf(req);
        const { id } = req.params as { id: string; name: string };
        if (!ID.test(id) || !existsSync(s.fileFor(id))) return bad("no such profile", 404);
        const body = (await req.json()) as { text?: string; mtime?: number };
        const problem = validate(body.text);
        if (problem) return bad(problem);
        if (nameIsTaken(listProfiles(s), nameOf(body.text as string, id), id)) return bad(`a profile named "${nameOf(body.text as string, id)}" already exists`, 422);
        // A write based on an older read must not clobber a newer file: hand back the current version instead.
        if (typeof body.mtime === "number" && statSync(s.fileFor(id)).mtimeMs !== body.mtime) return Response.json({ error: "the file changed on disk", ...readProfile(s, id) }, { status: 409 });
        const beforeText = readFileSync(s.fileFor(id), "utf8");
        let text = body.text as string;
        const settled = answeredFollowUps(parseProfile(text));
        if (settled.length) text = editProfileText(text, settled);
        if (typeof body.mtime === "number" && statSync(s.fileFor(id)).mtimeMs !== body.mtime) return Response.json({ error: "the file changed on disk", ...readProfile(s, id) }, { status: 409 });
        writeFileSync(s.fileFor(id), text, { mode: 0o600 });
        s.recordChange(id, beforeText, text, "you");
        const { path, mtime } = readProfile(s, id);
        return Response.json({ id, path, mtime });
      }),
      // A profile with anything in it is only deleted when the app's Delete button says so (?confirm=1);
      // an empty draft can go without that. Every delete is logged.
      DELETE: guard((req) => {
        const refused = sameOrigin(req);
        if (refused) return refused;
        const s = storeOf(req);
        const { id } = req.params as { id: string; name: string };
        if (!ID.test(id) || !existsSync(s.fileFor(id))) return bad("no such profile", 404);
        const confirmed = new URL(req.url).searchParams.get("confirm") === "1";
        let empty = false;
        try { empty = isEmptyProfile(parseProfile(migrateProfileText(readFileSync(s.fileFor(id), "utf8")))); } catch { empty = false; }
        if (!empty && !confirmed) return bad("this profile has data in it; deleting it needs confirmation", 409);
        console.log(`deleted ${relative(root, s.fileFor(id))}${empty ? " (empty)" : " (confirmed)"}`);
        unlinkSync(s.fileFor(id));
        return Response.json({ ok: true });
      }),
    },
  },
  fetch: () => new Response("Not found", { status: 404 }),
});
if (authEnabled) {
  console.log(`Taxonomy: http://${HOST}:${port}  accounts on; each user's data under ${relative(root, usersDir)}${signupOpen() ? "; sign-up open" : "; sign-up closed (TAXONOMY_SIGNUP=open to allow)"}`);
  if (publicHost) console.log(`claude.ai connectors reach the MCP server through https://${publicHost}/<secret>/mcp; the secret is in that path, so keep proxy access logs private or off`);
} else {
  console.log(`Taxonomy: http://${HOST}:${port}  (${listProfiles(rootStore).length} profile(s) in ${relative(root, rootStore.profilesDir) || rootStore.profilesDir})`);
}
