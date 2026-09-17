/**
 * Taxonomy over HTTP for claude.ai: the same tools behind a secret path, on localhost only.
 * A tunnel (Tailscale Funnel) gives it a public https address; only the exact path answers.
 * Each request gets a fresh server, so nothing is kept between calls.
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer } from "./taxonomy.ts";

const root = resolve(import.meta.dir, "../..");
const dataDir = process.env.TAXONOMY_DATA ? resolve(process.env.TAXONOMY_DATA) : join(root, "data");
const file = join(dataDir, ".remote.json");

/** The secret and port, created once and kept so the connector URL stays the same. */
export function remoteConfig(): { token: string; port: number } {
  try { if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as { token: string; port: number }; } catch {}
  const cfg = { token: randomBytes(24).toString("base64url"), port: 5182 };
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, JSON.stringify(cfg), { mode: 0o600 });
  return cfg;
}

if (import.meta.main) {
  const { token, port } = remoteConfig();
  const path = `/${token}/mcp`;
  Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(req) {
      if (new URL(req.url).pathname !== path) return new Response("not found", { status: 404 });
      const server = createServer({ clientLabel: "claude.ai" });
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      try { return await transport.handleRequest(req); } finally { void server.close(); }
    },
  });
  console.log(`Taxonomy MCP over HTTP on http://127.0.0.1:${port}/<secret>/mcp (the address is shown in the app)`);
}
