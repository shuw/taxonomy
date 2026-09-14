import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parse } from "yaml";
import { editProfileText, migrateProfileText, parseProfile } from "@taxonomy/engine";
import { describeAssistantError, runAssistant } from "./assistant.ts";
import index from "./index.html";

const root = resolve(import.meta.dir, "../..");
const profilesDir = resolve(root, "data/profiles");
const examplePath = resolve(root, "data/profile.example.yaml");
const legacyPath = resolve(root, "data/profile.yaml");

mkdirSync(profilesDir, { recursive: true });
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

function validate(text: unknown): string | null {
  if (typeof text !== "string") return "text is required";
  try { parseProfile(text); return null; } catch (e) { return String((e as Error).message ?? e); }
}

const port = Number(process.env.PORT ?? 5180);
Bun.serve({
  port,
  hostname: "127.0.0.1",
  development: true,
  routes: {
    "/": index,
    "/api/example": () => Response.json({ text: readFileSync(examplePath, "utf8") }),
    "/api/profiles": {
      GET: () => Response.json(listProfiles()),
      POST: async (req) => {
        const body = (await req.json()) as { name?: string; text?: string };
        const name = (body.name ?? "").trim();
        if (!name) return bad("name is required");
        const text = editProfileText(body.text ?? readFileSync(examplePath, "utf8"), [{ path: ["name"], value: name }]);
        const problem = validate(text);
        if (problem) return bad(problem);
        const id = uniqueId(name);
        writeFileSync(fileFor(id), text);
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
        const { id } = req.params;
        if (!ID.test(id) || !existsSync(fileFor(id))) return bad("no such profile", 404);
        const body = (await req.json()) as { text?: string };
        const problem = validate(body.text);
        if (problem) return bad(problem);
        writeFileSync(fileFor(id), body.text as string);
        const { path, mtime } = readProfile(id);
        return Response.json({ id, path, mtime });
      },
      DELETE: (req) => {
        const { id } = req.params;
        if (!ID.test(id) || !existsSync(fileFor(id))) return bad("no such profile", 404);
        unlinkSync(fileFor(id));
        return Response.json({ ok: true });
      },
    },
    "/api/assistant": {
      POST: async (req) => {
        const body = (await req.json()) as { profileText?: string; messages?: unknown };
        if (typeof body.profileText !== "string") return bad("profileText is required");
        try {
          return Response.json(await runAssistant(body.profileText, body.messages));
        } catch (e) {
          const { status, message } = describeAssistantError(e);
          if (status >= 500) console.error("assistant:", e);
          return Response.json({ error: message }, { status });
        }
      },
    },
  },
  fetch: () => new Response("Not found", { status: 404 }),
});
console.log(`Taxonomy: http://127.0.0.1:${port}  (${listProfiles().length} profile(s) in data/profiles)`);
