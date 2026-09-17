/**
 * The data directory as both servers see it: where profiles, history, attachments and the
 * remote-access secret live, and the checks on names and file names. The engine stays pure;
 * everything that touches disk for a profile file goes through here.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { describeChanges, migrateProfileText, parseProfile, type HistoryEntry } from "@taxonomy/engine";

export const root = resolve(import.meta.dir, "../..");
export const dataDir = process.env.TAXONOMY_DATA ? resolve(process.env.TAXONOMY_DATA) : join(root, "data");
export const profilesDir = join(dataDir, "profiles");
export const examplePath = join(root, "data", "profile.example.yaml");

/** Profile ids: the file name without `.yaml`. */
export const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const fileFor = (id: string) => join(profilesDir, `${id}.yaml`);

export function slug(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return s || "profile";
}
/** The slug, or the slug with a counter, whichever file does not exist yet. */
export function uniqueId(name: string): string {
  const base = slug(name);
  let id = base;
  for (let n = 2; existsSync(fileFor(id)); n++) id = `${base}-${n}`;
  return id;
}
/** Names identify profiles in conversation, so no two profiles may share one. */
export function nameTaken(profiles: { id: string; name: string }[], name: string, exceptId?: string): boolean {
  const key = name.trim().toLowerCase();
  return profiles.some((p) => p.id !== exceptId && p.name.trim().toLowerCase() === key);
}

// ---- history: one line per save, with the text before it, in history/<id>.jsonl ----
const historyDir = join(dataDir, "history");
export const historyFor = (id: string) => join(historyDir, `${id}.jsonl`);
export function recordChange(id: string, beforeText: string | null, afterText: string, actor: string, extra: string[] = []): void {
  let lines: string[];
  try {
    const before = beforeText === null ? null : parseProfile(migrateProfileText(beforeText));
    lines = [...extra, ...describeChanges(before, parseProfile(afterText))];
  } catch { lines = [...extra, "edited the file"]; }
  if (lines.length === 0) return;
  const entry: HistoryEntry = { at: new Date().toISOString(), actor, lines, before: beforeText ?? undefined };
  try { mkdirSync(historyDir, { recursive: true, mode: 0o700 }); appendFileSync(historyFor(id), JSON.stringify(entry) + "\n", { mode: 0o600 }); } catch {}
}
export function readHistory(id: string): HistoryEntry[] {
  try { return readFileSync(historyFor(id), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as HistoryEntry); } catch { return []; }
}

// ---- attachments: the documents behind the numbers, in attachments/<profile>/ ----
export const ATTACHABLE = /\.(png|jpe?g|webp|gif|pdf|txt|csv|md|ya?ml|json)$/i;
export const MAX_ATTACHMENT = 25 * 1_048_576;
export const attachmentsDir = (id: string) => join(dataDir, "attachments", id);
/** A plain file name: no directories, no control characters, no leading dots. */
export const safeName = (name: string) => name.replace(/[\\/]/g, "_").replace(/[^\x20-\x7E]/g, "").replace(/^\.+/, "").trim().slice(0, 120);
/** The path for a stored document, or null when the name is not a plain file name inside the profile's folder. */
export function attachmentPath(id: string, name: string): string | null {
  if (!ID.test(id)) return null;
  let raw = name;
  try { raw = decodeURIComponent(name); } catch { /* keep as is */ }
  const clean = safeName(raw);
  if (!clean || clean !== raw) return null;
  const base = attachmentsDir(id);
  const full = resolve(base, clean);
  return full.startsWith(base + sep) ? full : null;
}
export function listAttachments(id: string): { name: string; size: number; mtime: number }[] {
  const dir = attachmentsDir(id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => ATTACHABLE.test(f)).map((f) => { const st = statSync(join(dir, f)); return { name: f, size: st.size, mtime: st.mtimeMs }; }).sort((a, b) => b.mtime - a.mtime);
}
/** Store a document under a checked name; the bytes must already be decoded. */
export function saveAttachment(id: string, name: string, bytes: Uint8Array): string {
  const clean = safeName(name);
  if (!clean) throw new Error("a file name is required");
  if (!ATTACHABLE.test(clean)) throw new Error("only images, PDFs and text files (png, jpg, webp, gif, pdf, txt, csv, md, yaml, json)");
  if (bytes.length === 0) throw new Error("the file is empty");
  if (bytes.length > MAX_ATTACHMENT) throw new Error(`the file is over ${MAX_ATTACHMENT / 1_048_576} MB`);
  mkdirSync(attachmentsDir(id), { recursive: true, mode: 0o700 });
  writeFileSync(join(attachmentsDir(id), clean), bytes, { mode: 0o600 });
  return clean;
}

// ---- remote access: the secret path for claude.ai, kept in .remote.json (owner-only) ----
export const remoteFile = join(dataDir, ".remote.json");
export interface RemoteConfig { token: string; port: number; tunnelHost?: string; pid?: number; /** false once the user turns it off; it then stays off across restarts */ enabled?: boolean }
/** The secret and port, created once and kept so the connector URL stays the same. */
export function remoteConfig(): RemoteConfig {
  try { if (existsSync(remoteFile)) return JSON.parse(readFileSync(remoteFile, "utf8")) as RemoteConfig; } catch {}
  const cfg: RemoteConfig = { token: randomBytes(24).toString("base64url"), port: 5182 };
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  writeFileSync(remoteFile, JSON.stringify(cfg), { mode: 0o600 });
  return cfg;
}
export function saveRemoteConfig(patch: Partial<RemoteConfig>): void {
  writeFileSync(remoteFile, JSON.stringify({ ...remoteConfig(), ...patch }), { mode: 0o600 });
}
