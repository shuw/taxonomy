import { existsSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import index from "./index.html";

const root = resolve(import.meta.dir, "../..");
const candidates = ["data/profile.yaml", "data/profile.example.yaml"].map((p) => resolve(root, p));

function profileFile(): string {
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("no profile file found; expected data/profile.yaml or data/profile.example.yaml");
  return found;
}

const port = Number(process.env.PORT ?? 5173);
Bun.serve({
  port,
  hostname: "127.0.0.1",
  development: true,
  routes: {
    "/": index,
    "/api/profile": () => {
      const file = profileFile();
      return Response.json({ path: relative(root, file), mtime: statSync(file).mtimeMs, text: readFileSync(file, "utf8") });
    },
  },
  fetch: () => new Response("Not found", { status: 404 }),
});
console.log(`Taxonomy: http://127.0.0.1:${port}  (profile: ${relative(root, profileFile())})`);
