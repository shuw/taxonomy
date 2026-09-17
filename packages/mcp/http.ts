/**
 * Taxonomy over HTTP for claude.ai: the same tools behind a secret path, on localhost only.
 * A tunnel (Tailscale Funnel) gives it a public https address; only the exact path answers.
 * Each request gets a fresh server, so nothing is kept between calls.
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { timingSafeEqual } from "node:crypto";
import { createServer } from "./taxonomy.ts";
import { remoteConfig } from "./store.ts";

/** Same length and same bytes, without an early exit that would time the comparison. */
const samePath = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

if (import.meta.main) {
  const { token, port } = remoteConfig();
  const path = `/${token}/mcp`;
  Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(req) {
      if (!samePath(new URL(req.url).pathname, path)) return new Response("not found", { status: 404 });
      const server = createServer({ clientLabel: "claude.ai" });
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      try { return await transport.handleRequest(req); } finally { void server.close(); }
    },
  });
  console.log(`Taxonomy MCP over HTTP on http://127.0.0.1:${port}/<secret>/mcp (the address is shown in the app)`);
}
