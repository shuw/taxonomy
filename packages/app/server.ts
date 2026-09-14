import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parseProfile } from "@taxonomy/engine";
import index from "./index.html";

const root = resolve(import.meta.dir, "../..");
const profilePath = resolve(root, "data/profile.yaml");
const examplePath = resolve(root, "data/profile.example.yaml");

function readProfile() {
  const exists = existsSync(profilePath);
  const file = exists ? profilePath : examplePath;
  return { exists, path: relative(root, file), mtime: statSync(file).mtimeMs, text: readFileSync(file, "utf8") };
}

const port = Number(process.env.PORT ?? 5180);
Bun.serve({
  port,
  hostname: "127.0.0.1",
  development: true,
  routes: {
    "/": index,
    "/api/profile": {
      GET: () => Response.json(readProfile()),
      PUT: async (req) => {
        const body = (await req.json()) as { text?: string };
        if (typeof body.text !== "string") return Response.json({ error: "text is required" }, { status: 400 });
        try {
          parseProfile(body.text);
        } catch (e) {
          return Response.json({ error: String((e as Error).message ?? e) }, { status: 400 });
        }
        writeFileSync(profilePath, body.text);
        return Response.json({ path: relative(root, profilePath), mtime: statSync(profilePath).mtimeMs });
      },
    },
  },
  fetch: () => new Response("Not found", { status: 404 }),
});
console.log(`Taxonomy: http://127.0.0.1:${port}  (profile: ${readProfile().path})`);
