/**
 * Taxonomy over HTTP for claude.ai: the same tools behind a secret, on localhost only. A tunnel
 * (ngrok, Tailscale Funnel) or the hosted app's proxy gives it a public https address.
 * Each request gets a fresh server, so nothing is kept between calls.
 *
 * The secret selects the store (the data directory, or one user's). claude.ai's connector
 * dialog only takes a URL, so the secret can be the path: /<secret>/mcp. A client that can set
 * headers should send it as `Authorization: Bearer <secret>` to /mcp instead, which keeps it
 * out of proxy access logs.
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer } from "./taxonomy.ts";
import { rootStore, storeByToken, type Store } from "./store.ts";

/** The store a request may use, from its secret in the header or the path; null refuses. */
export function storeForRequest(req: Request): Store | null {
  const auth = req.headers.get("authorization") ?? "";
  const url = new URL(req.url);
  if (/^bearer /i.test(auth) && url.pathname === "/mcp") return storeByToken(auth.slice(7).trim());
  const m = /^\/([A-Za-z0-9_-]{16,64})\/mcp$/.exec(url.pathname);
  return m ? storeByToken(m[1]!) : null;
}

if (import.meta.main) {
  const { port } = rootStore.remoteConfig();
  Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(req) {
      const store = storeForRequest(req);
      if (!store) return new Response("not found", { status: 404 });
      const server = createServer({ clientLabel: "claude.ai", store });
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      try { return await transport.handleRequest(req); } finally { void server.close(); }
    },
  });
  console.log(`Taxonomy MCP over HTTP on http://127.0.0.1:${port}/<secret>/mcp (the address is shown in the app)`);
}
