/**
 * The data directory as both servers see it: where profiles, history, attachments and the
 * remote-access secret live, and the checks on names and file names. The engine stays pure;
 * everything that touches disk for a profile file goes through a Store.
 *
 * Without accounts there is one store, the data directory itself. With accounts each user has
 * one under data/users/<id>; the servers pick the store from the session, never from the URL.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { describeChanges, migrateProfileText, parseProfile, type HistoryEntry } from "@taxonomy/engine";

export const root = resolve(import.meta.dir, "../..");
export const dataDir = process.env.TAXONOMY_DATA ? resolve(process.env.TAXONOMY_DATA) : join(root, "data");
export const usersDir = join(dataDir, "users");
export const examplePath = join(root, "data", "profile.example.yaml");
export const demoPath = join(root, "data", "demo.yaml");

/** Profile ids: the file name without `.yaml`. */
export const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** User ids come from the accounts table, never from a request; still, only this shape is ever joined to a path. */
export const USER_ID = /^[A-Za-z0-9_-]{16,32}$/;

export function slug(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return s || "profile";
}
/** Names identify profiles in conversation, so no two profiles may share one. */
export function nameTaken(profiles: { id: string; name: string }[], name: string, exceptId?: string): boolean {
  const key = name.trim().toLowerCase();
  return profiles.some((p) => p.id !== exceptId && p.name.trim().toLowerCase() === key);
}

export const ATTACHABLE = /\.(png|jpe?g|webp|gif|pdf|txt|csv|md|ya?ml|json)$/i;
export const MAX_ATTACHMENT = 25 * 1_048_576;
/** A plain file name: no directories, no control characters, no leading dots. */
export const safeName = (name: string) => name.replace(/[\\/]/g, "_").replace(/[^\x20-\x7E]/g, "").replace(/^\.+/, "").trim().slice(0, 120);

export interface RemoteConfig { token: string; port: number; tunnelHost?: string; pid?: number; /** false once the user turns it off; it then stays off across restarts */ enabled?: boolean }

export interface Store {
  dir: string;
  profilesDir: string;
  fileFor: (id: string) => string;
  /** The slug, or the slug with a counter, whichever file does not exist yet. */
  uniqueId: (name: string) => string;
  /** Profiles as id and name, from the files. */
  listProfiles: () => { id: string; name: string }[];
  /** The profile the app is showing, as the app last told the server. */
  currentFile: string;
  /** When an agent last called, which client, and about which profile. */
  agentFile: string;
  historyFor: (id: string) => string;
  recordChange: (id: string, beforeText: string | null, afterText: string, actor: string, extra?: string[]) => void;
  readHistory: (id: string) => HistoryEntry[];
  attachmentsDir: (id: string) => string;
  /** The path for a stored document, or null when the name is not a plain file name inside the profile's folder. */
  attachmentPath: (id: string, name: string) => string | null;
  listAttachments: (id: string) => { name: string; size: number; mtime: number }[];
  /** Store a document under a checked name; the bytes must already be decoded. Returns the name used. */
  saveAttachment: (id: string, name: string, bytes: Uint8Array) => string;
  remoteFile: string;
  /** The secret and port, created once and kept so the connector URL stays the same. */
  remoteConfig: () => RemoteConfig;
  /** The same, without creating one. */
  remoteConfigIfAny: () => RemoteConfig | null;
  saveRemoteConfig: (patch: Partial<RemoteConfig>) => void;
}

export function storeFor(dir: string): Store {
  const profilesDir = join(dir, "profiles");
  const historyDir = join(dir, "history");
  const fileFor = (id: string) => join(profilesDir, `${id}.yaml`);
  const historyFor = (id: string) => join(historyDir, `${id}.jsonl`);
  const attachmentsDir = (id: string) => join(dir, "attachments", id);
  const remoteFile = join(dir, ".remote.json");
  const remoteConfigIfAny = (): RemoteConfig | null => { try { if (existsSync(remoteFile)) return JSON.parse(readFileSync(remoteFile, "utf8")) as RemoteConfig; } catch {} return null; };
  const remoteConfig = (): RemoteConfig => {
    const have = remoteConfigIfAny();
    if (have) return have;
    const cfg: RemoteConfig = { token: randomBytes(24).toString("base64url"), port: 5182 };
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(remoteFile, JSON.stringify(cfg), { mode: 0o600 });
    return cfg;
  };
  return {
    dir, profilesDir, fileFor, historyFor, attachmentsDir, remoteFile, remoteConfig, remoteConfigIfAny,
    currentFile: join(dir, ".current"),
    agentFile: join(dir, ".agent"),
    uniqueId(name) {
      const base = slug(name);
      let id = base;
      for (let n = 2; existsSync(fileFor(id)); n++) id = `${base}-${n}`;
      return id;
    },
    listProfiles() {
      if (!existsSync(profilesDir)) return [];
      return readdirSync(profilesDir).filter((f) => f.endsWith(".yaml")).map((f) => {
        const id = f.slice(0, -5);
        let name = id;
        try { name = parseProfile(migrateProfileText(readFileSync(join(profilesDir, f), "utf8"))).name?.trim() || id; } catch {}
        return { id, name };
      });
    },
    recordChange(id, beforeText, afterText, actor, extra = []) {
      let lines: string[];
      try {
        const before = beforeText === null ? null : parseProfile(migrateProfileText(beforeText));
        lines = [...extra, ...describeChanges(before, parseProfile(afterText))];
      } catch { lines = [...extra, "edited the file"]; }
      if (lines.length === 0) return;
      const entry: HistoryEntry = { at: new Date().toISOString(), actor, lines, before: beforeText ?? undefined };
      try { mkdirSync(historyDir, { recursive: true, mode: 0o700 }); appendFileSync(historyFor(id), JSON.stringify(entry) + "\n", { mode: 0o600 }); } catch {}
    },
    readHistory(id) {
      try { return readFileSync(historyFor(id), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as HistoryEntry); } catch { return []; }
    },
    attachmentPath(id, name) {
      if (!ID.test(id)) return null;
      let raw = name;
      try { raw = decodeURIComponent(name); } catch { /* keep as is */ }
      const clean = safeName(raw);
      if (!clean || clean !== raw) return null;
      const base = attachmentsDir(id);
      const full = resolve(base, clean);
      return full.startsWith(base + sep) ? full : null;
    },
    listAttachments(id) {
      const d = attachmentsDir(id);
      if (!existsSync(d)) return [];
      return readdirSync(d).filter((f) => ATTACHABLE.test(f)).map((f) => { const st = statSync(join(d, f)); return { name: f, size: st.size, mtime: st.mtimeMs }; }).sort((a, b) => b.mtime - a.mtime);
    },
    saveAttachment(id, name, bytes) {
      if (!ID.test(id)) throw new Error("no such profile");
      const clean = safeName(name);
      if (!clean) throw new Error("a file name is required");
      if (!ATTACHABLE.test(clean)) throw new Error("only images, PDFs and text files (png, jpg, webp, gif, pdf, txt, csv, md, yaml, json)");
      if (bytes.length === 0) throw new Error("the file is empty");
      if (bytes.length > MAX_ATTACHMENT) throw new Error(`the file is over ${MAX_ATTACHMENT / 1_048_576} MB`);
      mkdirSync(attachmentsDir(id), { recursive: true, mode: 0o700 });
      writeFileSync(join(attachmentsDir(id), clean), bytes, { mode: 0o600 });
      return clean;
    },
    saveRemoteConfig(patch) {
      writeFileSync(remoteFile, JSON.stringify({ ...remoteConfig(), ...patch }), { mode: 0o600 });
    },
  };
}

/** The store without accounts: the data directory itself. */
export const rootStore = storeFor(dataDir);

/** A user's own store. The id is checked again here so nothing but an account id is ever joined to a path. */
export function userStore(userId: string): Store {
  if (!USER_ID.test(userId)) throw new Error("bad user id");
  return storeFor(join(usersDir, userId));
}

const sameSecret = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The store whose remote-access secret this is: the root store, or one user's. Null when no secret matches. */
export function storeByToken(token: string): Store | null {
  if (!token) return null;
  const rootCfg = rootStore.remoteConfigIfAny();
  if (rootCfg && sameSecret(rootCfg.token, token)) return rootStore;
  if (!existsSync(usersDir)) return null;
  for (const id of readdirSync(usersDir)) {
    if (!USER_ID.test(id)) continue;
    const s = storeFor(join(usersDir, id));
    const cfg = s.remoteConfigIfAny();
    if (cfg && sameSecret(cfg.token, token)) return s;
  }
  return null;
}
