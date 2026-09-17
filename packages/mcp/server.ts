/** Taxonomy over stdio: what Claude Desktop and Claude Code start. */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./taxonomy.ts";

await createServer().connect(new StdioServerTransport());
