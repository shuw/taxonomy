import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { homedir, platform } from "node:os";
import { randomBytes } from "node:crypto";
import { parse } from "yaml";
import { describeChanges, editProfileText, migrateProfileText, parseProfile, tools, type HistoryEntry } from "@taxonomy/engine";
const { answeredFollowUps } = tools;
import { appendFileSync } from "node:fs";
import index from "./index.html";

const root = resolve(import.meta.dir, "../..");
/** Where profiles and the small state files live. Tests point this at a throwaway directory. */
const dataDir = process.env.TAXONOMY_DATA ? resolve(process.env.TAXONOMY_DATA) : resolve(root, "data");
const profilesDir = resolve(dataDir, "profiles");
const examplePath = resolve(root, "data/profile.example.yaml");
const legacyPath = resolve(dataDir, "profile.yaml");

mkdirSync(profilesDir, { recursive: true, mode: 0o700 });
if (existsSync(legacyPath)) {
  const target = resolve(profilesDir, "profile.yaml");
  if (!existsSync(target)) {
    renameSync(legacyPath, target);
    console.log(`moved data/profile.yaml to data/profiles/profile.yaml`);
  }
}

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const fileFor = (id: string) => resolve(profilesDir, `${id}.yaml`);

function slug(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return s || "profile";
}

function uniqueId(name: string): string {
  const base = slug(name);
  let id = base;
  for (let n = 2; existsSync(fileFor(id)); n++) id = `${base}-${n}`;
  return id;
}

/** Names identify profiles in conversation, so no two profiles may share one. */
function nameTaken(name: string, exceptId?: string): boolean {
  const key = name.trim().toLowerCase();
  return listProfiles().some((p) => p.id !== exceptId && p.name.trim().toLowerCase() === key);
}

function nameOf(text: string, id: string): string {
  try {
    const raw = parse(text) as { name?: unknown } | null;
    if (raw && typeof raw.name === "string" && raw.name.trim()) return raw.name.trim();
  } catch {}
  return id;
}

function listProfiles() {
  return readdirSync(profilesDir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => {
      const id = f.slice(0, -5);
      const path = fileFor(id);
      return { id, name: nameOf(readFileSync(path, "utf8"), id), path: relative(root, path), mtime: statSync(path).mtimeMs };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function readProfile(id: string) {
  const path = fileFor(id);
  let text = readFileSync(path, "utf8");
  const migrated = migrateProfileText(text);
  if (migrated !== text) {
    writeFileSync(path, migrated);
    text = migrated;
    console.log(`migrated ${relative(root, path)} to typed grants`);
  }
  return { id, path: relative(root, path), mtime: statSync(path).mtimeMs, text };
}

const bad = (message: string, status = 400) => Response.json({ error: message }, { status });

// ---- attachments: the documents behind the numbers, in data/attachments/<profile>/ ----
const ATTACHABLE = /\.(png|jpe?g|webp|gif|pdf|txt|csv|md|ya?ml|json)$/i;
const MAX_ATTACHMENT = 25 * 1_048_576;
const attachmentsDir = (id: string) => resolve(dataDir, "attachments", id);
/** A plain file name: no directories, no control characters. */
const safeName = (name: string) => name.replace(/[\\/]/g, "_").replace(/[^\x20-\x7E]/g, "").replace(/^\.+/, "").trim().slice(0, 120);
function attachmentPath(id: string, name: string): string | null {
  if (!ID.test(id)) return null;
  let raw = name;
  try { raw = decodeURIComponent(name); } catch { /* keep as is */ }
  const clean = safeName(raw);
  if (!clean || clean !== raw) return null;
  const base = attachmentsDir(id);
  const full = resolve(base, clean);
  return full.startsWith(base + sep) ? full : null;
}
function listAttachments(id: string): { name: string; size: number; mtime: number }[] {
  const dir = attachmentsDir(id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => ATTACHABLE.test(f)).map((f) => { const st = statSync(resolve(dir, f)); return { name: f, size: st.size, mtime: st.mtimeMs }; }).sort((a, b) => b.mtime - a.mtime);
}

// ---- history: one line per save, with the text before it, in data/history/<id>.jsonl ----
const historyDir = resolve(dataDir, "history");
const historyFor = (id: string) => resolve(historyDir, `${id}.jsonl`);
function recordChange(id: string, beforeText: string | null, afterText: string, actor: string, extra: string[] = []): void {
  let lines: string[];
  try {
    const before = beforeText === null ? null : parseProfile(migrateProfileText(beforeText));
    lines = [...extra, ...describeChanges(before, parseProfile(afterText))];
  } catch { lines = [...extra, "edited the file"]; }
  if (lines.length === 0) return;
  const entry: HistoryEntry = { at: new Date().toISOString(), actor, lines, before: beforeText ?? undefined };
  mkdirSync(historyDir, { recursive: true, mode: 0o700 });
  appendFileSync(historyFor(id), JSON.stringify(entry) + "\n", { mode: 0o600 });
}
function readHistory(id: string): HistoryEntry[] {
  try { return readFileSync(historyFor(id), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as HistoryEntry); } catch { return []; }
}

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
    && !p.pendingIntake && !(p.pending?.length) && !(p.timeline?.length) && !(p.returns?.length) && !(p.followUps?.length) && !p.sources
    && Object.values(p.scenarios ?? {}).every((s) => s.events.length === 0);
}

function validate(text: unknown): string | null {
  if (typeof text !== "string") return "text is required";
  try { parseProfile(text); return null; } catch (e) { return String((e as Error).message ?? e); }
}

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
function agentConnection() {
  const script = resolve(import.meta.dir, "../mcp/server.ts");
  const bun = Bun.which("bun") ?? "bun";
  let lastSeen: string | null = null;
  let client: string | null = null;
  let lastProfile: string | null = null;
  try {
    const seen = JSON.parse(readFileSync(resolve(dataDir, ".agent"), "utf8")) as { lastSeen?: string; client?: string; profile?: string };
    lastSeen = seen.lastSeen ?? null;
    client = seen.client ?? null;
    lastProfile = seen.profile ?? null;
  } catch {}
  let current: string | null = null;
  try { current = readFileSync(resolve(dataDir, ".current"), "utf8").trim() || null; } catch {}
  return { root: resolve(import.meta.dir, "../.."), script, command: bun, args: [script], config: { mcpServers: { taxonomy: { command: bun, args: [script] } } }, lastSeen, client, lastProfile, current, desktop: desktopState(script) };
}

/** Put Taxonomy into Claude Desktop's config, touching only the `taxonomy` entry and keeping a backup of the file. */
function addToDesktop(): { ok: true } | { error: string } {
  const conn = agentConnection();
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

// ---- claude.ai: the HTTP MCP server on localhost. Exposing it is the user's own `tailscale funnel` command;
// this only starts the local server, reads Funnel's status, and composes the URL once both are up. ----
const remoteFile = resolve(dataDir, ".remote.json");
const tailscaleBin = Bun.which("tailscale") ?? (existsSync("/Applications/Tailscale.app/Contents/MacOS/Tailscale") ? "/Applications/Tailscale.app/Contents/MacOS/Tailscale" : null);
let httpChild: ReturnType<typeof Bun.spawn> | null = null;

interface RemoteConfig { token: string; port: number; tunnelHost?: string; pid?: number; /** false once the user turns it off; it then stays off across restarts */ enabled?: boolean }
function remoteConfig(): RemoteConfig {
  try { if (existsSync(remoteFile)) return JSON.parse(readFileSync(remoteFile, "utf8")) as RemoteConfig; } catch {}
  const cfg = { token: randomBytes(24).toString("base64url"), port: 5182 };
  writeFileSync(remoteFile, JSON.stringify(cfg), { mode: 0o600 });
  return cfg;
}
async function read(args: string[]): Promise<string> {
  try { const p = Bun.spawn(args, { stdout: "pipe", stderr: "ignore" }); const out = await new Response(p.stdout).text(); await p.exited; return out; } catch { return ""; }
}
async function httpRunning(port: number): Promise<boolean> {
  try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) }); return true; } catch { return false; }
}
async function tunnelState(port: number): Promise<{ available: boolean; dnsName: string | null; on: boolean }> {
  if (!tailscaleBin) return { available: false, dnsName: null, on: false };
  let dnsName: string | null = null;
  try { dnsName = ((JSON.parse(await read([tailscaleBin, "status", "--json"])) as { Self?: { DNSName?: string } }).Self?.DNSName ?? "").replace(/\.$/, "") || null; } catch {}
  const st = await read([tailscaleBin, "funnel", "status", "--json"]);
  return { available: dnsName !== null, dnsName, on: st.includes("AllowFunnel") && st.includes(`:${port}`) };
}
async function remoteState() {
  const cfg = remoteConfig();
  const [running, tunnel] = await Promise.all([httpRunning(cfg.port), tunnelState(cfg.port)]);
  return {
    running, port: cfg.port, tunnel,
    funnelCommand: tailscaleBin ? `${tailscaleBin.includes("Tailscale.app") ? tailscaleBin : "tailscale"} funnel --bg ${cfg.port}` : null,
    path: `/${cfg.token}/mcp`,
    tunnelHost: cfg.tunnelHost ?? null,
    url: running && tunnel.on && tunnel.dnsName ? `https://${tunnel.dnsName}/${cfg.token}/mcp` : null,
  };
}
/** The child's pid is kept in the config so a restarted app can replace a child left over from the previous one. */
function rememberChild(pid: number | undefined): void {
  try { writeFileSync(remoteFile, JSON.stringify({ ...remoteConfig(), pid }), { mode: 0o600 }); } catch {}
}
/** True when the process is still the MCP server we started, so a reused pid is never signalled. */
function isOurHttpServer(pid: number): boolean {
  try { return Bun.spawnSync(["ps", "-p", String(pid), "-o", "command="]).stdout.toString().includes("packages/mcp/http.ts"); } catch { return false; }
}
function stopChild(): void {
  const { pid } = remoteConfig();
  httpChild?.kill();
  if (pid && pid !== httpChild?.pid && isOurHttpServer(pid)) { try { process.kill(pid); } catch { /* already gone */ } }
  httpChild = null;
  rememberChild(undefined);
}
async function serveLocal(on: boolean, fresh = false): Promise<void> {
  const cfg = remoteConfig();
  if (!on) { stopChild(); return; }
  if (fresh) { stopChild(); for (let i = 0; i < 20 && (await httpRunning(cfg.port)); i++) await Bun.sleep(100); }
  else if (await httpRunning(cfg.port)) return;
  httpChild = Bun.spawn(["bun", resolve(root, "packages/mcp/http.ts")], { stdout: "ignore", stderr: "ignore", env: { ...process.env, TAXONOMY_DATA: dataDir } });
  rememberChild(httpChild.pid);
  for (let i = 0; i < 20 && !(await httpRunning(cfg.port)); i++) await Bun.sleep(100);
}
process.on("exit", () => httpChild?.kill());
// Once claude.ai has been set up (a tunnel address is saved), the HTTP server comes up with the app,
// replacing any child from a previous run so it always runs the current code.
if (remoteConfig().tunnelHost && remoteConfig().enabled !== false) void serveLocal(true, true);

const port = Number(process.env.PORT ?? 5180);
Bun.serve({
  port,
  hostname: "127.0.0.1",
  development: true,
  routes: {
    "/": index,
    "/api/example": () => Response.json({ text: readFileSync(examplePath, "utf8") }),
    // Documents behind the numbers: page images, PDFs, statements. Stored beside the profile, cited by name in sources.
    "/api/profiles/:id/attachments": {
      GET: (req) => {
        const { id } = req.params;
        if (!ID.test(id)) return bad("no such profile", 404);
        return Response.json(listAttachments(id));
      },
      POST: async (req) => {
        const refused = sameOrigin(req);
        if (refused) return refused;
        const { id } = req.params;
        if (!ID.test(id) || !existsSync(fileFor(id))) return bad("no such profile", 404);
        const body = (await req.json()) as { name?: string; base64?: string };
        const name = safeName(body.name ?? "");
        if (!name) return bad("a file name is required");
        if (!ATTACHABLE.test(name)) return bad("only images, PDFs and text files (png, jpg, webp, gif, pdf, txt, csv, md, yaml, json)");
        const bytes = Buffer.from(body.base64 ?? "", "base64");
        if (bytes.length === 0) return bad("the file is empty");
        if (bytes.length > MAX_ATTACHMENT) return bad(`the file is over ${MAX_ATTACHMENT / 1_048_576} MB`);
        mkdirSync(attachmentsDir(id), { recursive: true, mode: 0o700 });
        writeFileSync(resolve(attachmentsDir(id), name), bytes, { mode: 0o600 });
        return Response.json(listAttachments(id));
      },
    },
    "/api/profiles/:id/attachments/:name": {
      GET: (req) => {
        const { id, name } = req.params;
        const file = attachmentPath(id, name);
        if (!file || !existsSync(file)) return bad("no such document", 404);
        const shown = safeName(name).replace(/["\\]/g, "_");
        return new Response(Bun.file(file), { headers: { "content-disposition": `inline; filename="${shown}"`, "x-content-type-options": "nosniff" } });
      },
      DELETE: (req) => {
        const refused = sameOrigin(req);
        if (refused) return refused;
        const { id, name } = req.params;
        const file = attachmentPath(id, name);
        if (!file || !existsSync(file)) return bad("no such document", 404);
        unlinkSync(file);
        return Response.json(listAttachments(id));
      },
    },
    "/api/profiles/:id/history": {
      GET: (req) => {
        const { id } = req.params;
        if (!ID.test(id)) return bad("no such profile", 404);
        // Newest first; the text before each change stays on the server and is fetched only to restore.
        return Response.json(readHistory(id).reverse().map(({ before, ...e }) => ({ ...e, restorable: before !== undefined })));
      },
    },
    "/api/profiles/:id/restore": {
      POST: async (req) => {
        const refused = sameOrigin(req);
        if (refused) return refused;
        const { id } = req.params;
        if (!ID.test(id) || !existsSync(fileFor(id))) return bad("no such profile", 404);
        const { at, seen } = (await req.json()) as { at?: string; seen?: string };
        const log = readHistory(id);
        const entry = log.find((e) => e.at === at);
        if (!entry?.before) return bad("nothing to restore for that entry", 404);
        // `seen` is the newest entry the History list showed; a newer one means something wrote since.
        const latest = log[log.length - 1]?.at;
        if (seen && latest && latest > seen) return Response.json({ error: "the profile changed since the list was loaded; it has been refreshed", ...readProfile(id) }, { status: 409 });
        const problem = validate(entry.before);
        if (problem) return bad(`that version no longer parses: ${problem}`);
        const beforeText = readFileSync(fileFor(id), "utf8");
        writeFileSync(fileFor(id), entry.before, { mode: 0o600 });
        recordChange(id, beforeText, entry.before, "you", [`Restored the version from ${new Date(entry.at).toLocaleString()}`]);
        return Response.json(readProfile(id));
      },
    },
    "/api/agent": async () => Response.json({ ...agentConnection(), remote: await remoteState() }),
    "/api/agent/remote": { POST: async (req) => {
      const refused = sameOrigin(req);
      if (refused) return refused;
      const body = (await req.json()) as { on?: boolean; tunnelHost?: string };
      if (typeof body.on === "boolean") {
        writeFileSync(remoteFile, JSON.stringify({ ...remoteConfig(), enabled: body.on }), { mode: 0o600 });
        await serveLocal(body.on);
      }
      // The tunnel's address is kept with the secret so every browser sees the same setup.
      if (typeof body.tunnelHost === "string") {
        const host = body.tunnelHost.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
        if (host && !/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) return bad("that is not a host name");
        writeFileSync(remoteFile, JSON.stringify({ ...remoteConfig(), tunnelHost: host || undefined }), { mode: 0o600 });
      }
      return Response.json({ ...agentConnection(), remote: await remoteState() });
    } },
    "/api/current": { POST: async (req) => { const refused = sameOrigin(req); if (refused) return refused; const { id } = (await req.json()) as { id?: string }; if (!id || !ID.test(id) || !existsSync(fileFor(id))) return bad("no such profile", 404); writeFileSync(resolve(dataDir, ".current"), id); return Response.json({ ok: true }); } },
    "/api/agent/desktop": { POST: (req) => { const refused = sameOrigin(req); if (refused) return refused; const r = addToDesktop(); return "error" in r ? bad(r.error) : Response.json(agentConnection()); } },
    "/api/agent/open": { POST: async (req) => { const refused = sameOrigin(req); if (refused) return refused; return Response.json(await openDesktop()); } },
    "/api/profiles": {
      GET: () => Response.json(listProfiles()),
      POST: async (req) => {
        const refused = sameOrigin(req);
        if (refused) return refused;
        const body = (await req.json()) as { name?: string; text?: string };
        const name = (body.name ?? "").trim();
        if (!name) return bad("name is required");
        if (nameTaken(name)) return bad(`a profile named "${name}" already exists`, 422);
        const text = editProfileText(body.text ?? readFileSync(examplePath, "utf8"), [{ path: ["name"], value: name }]);
        const problem = validate(text);
        if (problem) return bad(problem);
        const id = uniqueId(name);
        writeFileSync(fileFor(id), text, { mode: 0o600 });
        recordChange(id, null, text, "you");
        return Response.json(readProfile(id));
      },
    },
    "/api/profiles/:id": {
      GET: (req) => {
        const { id } = req.params;
        if (!ID.test(id) || !existsSync(fileFor(id))) return bad("no such profile", 404);
        return Response.json(readProfile(id));
      },
      PUT: async (req) => {
        const refused = sameOrigin(req);
        if (refused) return refused;
        const { id } = req.params;
        if (!ID.test(id) || !existsSync(fileFor(id))) return bad("no such profile", 404);
        const body = (await req.json()) as { text?: string; mtime?: number };
        const problem = validate(body.text);
        if (problem) return bad(problem);
        if (nameTaken(nameOf(body.text as string, id), id)) return bad(`a profile named "${nameOf(body.text as string, id)}" already exists`, 422);
        // A write based on an older read must not clobber a newer file: hand back the current version instead.
        if (typeof body.mtime === "number" && statSync(fileFor(id)).mtimeMs !== body.mtime) return Response.json({ error: "the file changed on disk", ...readProfile(id) }, { status: 409 });
        const beforeText = readFileSync(fileFor(id), "utf8");
        let text = body.text as string;
        const settled = answeredFollowUps(parseProfile(text));
        if (settled.length) text = editProfileText(text, settled);
        if (typeof body.mtime === "number" && statSync(fileFor(id)).mtimeMs !== body.mtime) return Response.json({ error: "the file changed on disk", ...readProfile(id) }, { status: 409 });
        writeFileSync(fileFor(id), text, { mode: 0o600 });
        recordChange(id, beforeText, text, "you");
        const { path, mtime } = readProfile(id);
        return Response.json({ id, path, mtime });
      },
      // A profile with anything in it is only deleted when the app's Delete button says so (?confirm=1);
      // an empty draft can go without that. Every delete is logged.
      DELETE: (req) => {
        const refused = sameOrigin(req);
        if (refused) return refused;
        const { id } = req.params;
        if (!ID.test(id) || !existsSync(fileFor(id))) return bad("no such profile", 404);
        const confirmed = new URL(req.url).searchParams.get("confirm") === "1";
        let empty = false;
        try { empty = isEmptyProfile(parseProfile(migrateProfileText(readFileSync(fileFor(id), "utf8")))); } catch { empty = false; }
        if (!empty && !confirmed) return bad("this profile has data in it; deleting it needs confirmation", 409);
        console.log(`deleted ${relative(root, fileFor(id))}${empty ? " (empty)" : " (confirmed)"}`);
        unlinkSync(fileFor(id));
        return Response.json({ ok: true });
      },
    },
  },
  fetch: () => new Response("Not found", { status: 404 }),
});
console.log(`Taxonomy: http://127.0.0.1:${port}  (${listProfiles().length} profile(s) in ${relative(root, profilesDir) || profilesDir})`);
