/**
 * Accounts and sessions, for a hosted Taxonomy where more than one person signs in. Off by
 * default: the local app on 127.0.0.1 has no accounts and one data directory. On with
 * TAXONOMY_AUTH=1, or whenever the server is bound to an address other than loopback.
 *
 * Passwords are hashed with argon2id (Bun.password). A session is a random id kept only as its
 * SHA-256 in the database, so a copy of the database yields no live session. The cookie is
 * HttpOnly and SameSite=Strict; every state change also passes the app's same-origin check.
 */
import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { dataDir } from "../mcp/store.ts";

export interface User { id: string; email: string; createdAt: string; }

export const HOST = process.env.HOST ?? "127.0.0.1";
const loopback = /^(127\.\d+\.\d+\.\d+|localhost|::1)$/.test(HOST);
export const authEnabled = process.env.TAXONOMY_AUTH === "1" || !loopback;
/** Set to make session cookies Secure even when the server itself sees plain http (behind a TLS proxy). */
const secureCookies = process.env.TAXONOMY_SECURE_COOKIES === "1";

export const SESSION_COOKIE = "taxonomy_session";
const SESSION_DAYS = 30;
const MAX_PASSWORD = 200;
const FAILS_ALLOWED = 10;
const FAIL_WINDOW_MS = 15 * 60_000;

let db: Database | null = null;
function open(): Database {
  if (db) return db;
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, "auth.sqlite");
  db = new Database(path, { create: true });
  try { chmodSync(path, 0o600); } catch {}
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
  `);
  return db;
}

const now = () => new Date().toISOString();
const hashOf = (s: string) => createHash("sha256").update(s).digest("base64url");
const normalizeEmail = (e: unknown) => (typeof e === "string" ? e : "").trim().toLowerCase();
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;

export function userCount(): number {
  return (open().query("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
}
/** The first account can always be made; after that only when the operator opens sign-up. */
export function signupOpen(): boolean {
  return userCount() === 0 || process.env.TAXONOMY_SIGNUP === "open";
}

export class AuthError extends Error { constructor(message: string, public status: number, public retryAfter?: number) { super(message); } }

export async function register(emailRaw: unknown, password: unknown): Promise<User> {
  const email = normalizeEmail(emailRaw);
  if (!emailOk(email)) throw new AuthError("that is not an email address", 400);
  if (typeof password !== "string" || password.length === 0) throw new AuthError("a password is required", 400);
  if (password.length > MAX_PASSWORD) throw new AuthError("the password is too long", 400);
  if (!signupOpen()) throw new AuthError("sign-up is closed; ask whoever runs this server for an account", 403);
  const d = open();
  if (d.query("SELECT 1 FROM users WHERE email = ?").get(email)) throw new AuthError("an account with that email already exists", 409);
  const user: User = { id: randomBytes(16).toString("base64url"), email, createdAt: now() };
  const hash = await Bun.password.hash(password, { algorithm: "argon2id" });
  d.query("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)").run(user.id, email, hash, user.createdAt);
  return user;
}

// A hash of nothing in particular, verified against when the email is unknown so a miss costs the same time as a wrong password.
let dummyHash: string | null = null;
async function dummy(): Promise<string> { return (dummyHash ??= await Bun.password.hash(randomBytes(16).toString("hex"), { algorithm: "argon2id" })); }

const fails = new Map<string, { n: number; since: number }>();
function tooMany(key: string): number | null {
  const f = fails.get(key);
  if (!f) return null;
  if (Date.now() - f.since > FAIL_WINDOW_MS) { fails.delete(key); return null; }
  return f.n >= FAILS_ALLOWED ? Math.ceil((f.since + FAIL_WINDOW_MS - Date.now()) / 1000) : null;
}
function failed(key: string): void {
  const f = fails.get(key);
  if (!f || Date.now() - f.since > FAIL_WINDOW_MS) fails.set(key, { n: 1, since: Date.now() });
  else f.n++;
}

/** A session id for the browser to keep; only its hash is stored. */
export async function login(emailRaw: unknown, password: unknown, clientKey: string): Promise<{ user: User; sessionId: string }> {
  const email = normalizeEmail(emailRaw);
  const key = `${clientKey}|${email}`;
  const wait = tooMany(key);
  if (wait !== null) throw new AuthError("too many attempts; try again later", 429, wait);
  const row = open().query("SELECT id, email, password_hash, created_at FROM users WHERE email = ?").get(email) as { id: string; email: string; password_hash: string; created_at: string } | null;
  const ok = await Bun.password.verify(typeof password === "string" ? password : "", row?.password_hash ?? (await dummy()));
  if (!row || !ok) { failed(key); throw new AuthError("wrong email or password", 401); }
  fails.delete(key);
  return { user: { id: row.id, email: row.email, createdAt: row.created_at }, sessionId: startSession(row.id) };
}

function startSession(userId: string): string {
  const id = randomBytes(32).toString("base64url");
  const t = now();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  open().query("INSERT INTO sessions (id_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run(hashOf(id), userId, t, expires, t);
  return id;
}

/** The user behind a session id, or null. A live session slides forward at most once an hour. */
export function userFor(sessionId: string | null | undefined): User | null {
  if (!sessionId || sessionId.length < 32 || sessionId.length > 64) return null;
  const d = open();
  const h = hashOf(sessionId);
  const row = d.query("SELECT s.expires_at, s.last_seen_at, u.id, u.email, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?").get(h) as { expires_at: string; last_seen_at: string; id: string; email: string; created_at: string } | null;
  if (!row) return null;
  if (row.expires_at < now()) { d.query("DELETE FROM sessions WHERE id_hash = ?").run(h); return null; }
  if (Date.now() - Date.parse(row.last_seen_at) > 3_600_000) {
    d.query("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?").run(now(), new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString(), h);
  }
  return { id: row.id, email: row.email, createdAt: row.created_at };
}

export function logout(sessionId: string | null | undefined): void {
  if (sessionId) open().query("DELETE FROM sessions WHERE id_hash = ?").run(hashOf(sessionId));
}

/** A new password ends every other session. */
export async function changePassword(user: User, current: unknown, next: unknown, keepSessionId: string): Promise<void> {
  const row = open().query("SELECT password_hash FROM users WHERE id = ?").get(user.id) as { password_hash: string } | null;
  if (!row || !(await Bun.password.verify(typeof current === "string" ? current : "", row.password_hash))) throw new AuthError("the current password is wrong", 401);
  if (typeof next !== "string" || next.length === 0) throw new AuthError("a new password is required", 400);
  if (next.length > MAX_PASSWORD) throw new AuthError("the new password is too long", 400);
  const d = open();
  d.query("UPDATE users SET password_hash = ? WHERE id = ?").run(await Bun.password.hash(next, { algorithm: "argon2id" }), user.id);
  d.query("DELETE FROM sessions WHERE user_id = ? AND id_hash <> ?").run(user.id, hashOf(keepSessionId));
}

/** The session id from the request's cookies, if any. */
export function sessionIdOf(req: Request): string | null {
  const cookie = req.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === SESSION_COOKIE) return rest.join("=") || null;
  }
  return null;
}

/** Whether this request arrived over https, directly or through a proxy that says so. */
export function isSecure(req: Request): boolean {
  if (secureCookies) return true;
  if (new URL(req.url).protocol === "https:") return true;
  return (req.headers.get("x-forwarded-proto") ?? "").split(",")[0]!.trim() === "https";
}

export function sessionCookie(sessionId: string | null, req: Request): string {
  const base = `${SESSION_COOKIE}=${sessionId ?? ""}; Path=/; HttpOnly; SameSite=Strict${isSecure(req) ? "; Secure" : ""}`;
  return sessionId ? `${base}; Max-Age=${SESSION_DAYS * 86_400}` : `${base}; Max-Age=0`;
}

/** Set when a reverse proxy sits in front, so its X-Forwarded-For is believed; otherwise a client could forge it and dodge the throttle. */
const trustProxy = process.env.TAXONOMY_TRUST_PROXY === "1";

/** Who is asking, for the rate limit: the socket's address, or the proxy's client address when the proxy is trusted. */
export function clientKey(req: Request, remote: string | undefined): string {
  const forwarded = trustProxy ? (req.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim() : "";
  return forwarded || remote || "local";
}
