export interface ProfileSummary { id: string; name: string; path: string; mtime: number; }
/** How an MCP client starts Taxonomy's server on this machine. */
export interface AgentConnection {
  root: string; script: string; command: string; args: string[];
  config: { mcpServers: Record<string, { command: string; args: string[] }> };
  lastSeen: string | null; client: string | null;
  /** The profile the agent's last call was about. */
  lastProfile: string | null;
  /** The profile the app is showing; the MCP server's default. */
  current: string | null;
  desktop: { configPath: string; installed: boolean; added: boolean };
  /** The HTTP server for claude.ai, and the Tailscale Funnel that would expose it (the user runs that command). */
  remote: { running: boolean; url: string | null; port: number; path: string; tunnelHost: string | null; funnelCommand: string | null; tunnel: { available: boolean; dnsName: string | null; on: boolean } };
}
export interface ProfileFileBody { id: string; path: string; mtime: number; text: string; }

/** The file changed on disk since the app last read it; carries the current version. */
export class ConflictError extends Error {
  constructor(public file: ProfileFileBody) { super("the file changed on disk"); }
}

/** The server refused the request as such (a bad value, a name in use); retrying will not help. */
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json()) as T & { error?: string };
  if (res.status === 409) throw new ConflictError(body as unknown as ProfileFileBody);
  if (!res.ok) throw new ApiError(body.error ?? res.statusText, res.status);
  return body;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export interface HistoryRow { at: string; actor: string; lines: string[]; restorable: boolean; }

export const api = {
  history: (id: string) => call<HistoryRow[]>(`/api/profiles/${id}/history`),
  restore: (id: string, at: string) => call<ProfileFileBody>(`/api/profiles/${id}/restore`, json("POST", { at })),
  example: () => call<{ text: string }>("/api/example"),
  agent: () => call<AgentConnection>("/api/agent"),
  setCurrent: (id: string) => call<{ ok: true }>("/api/current", json("POST", { id })),
  addToDesktop: () => call<AgentConnection>("/api/agent/desktop", json("POST", {})),
  openDesktop: () => call<{ ok: boolean }>("/api/agent/open", json("POST", {})),
  serve: (on: boolean) => call<AgentConnection>("/api/agent/remote", json("POST", { on })),
  setTunnelHost: (tunnelHost: string) => call<AgentConnection>("/api/agent/remote", json("POST", { tunnelHost })),
  list: () => call<ProfileSummary[]>("/api/profiles"),
  get: (id: string) => call<ProfileFileBody>(`/api/profiles/${id}`),
  /** Writes only if the file still has `mtime`; a 409 carries the newer file. */
  put: (id: string, text: string, mtime?: number) => call<{ id: string; path: string; mtime: number }>(`/api/profiles/${id}`, json("PUT", { text, mtime })),
  create: (name: string, text?: string) => call<ProfileFileBody>("/api/profiles", json("POST", { name, text })),
  /** `confirm` is the user's own Delete; without it the server only removes an empty draft. */
  remove: (id: string, confirm = false) => call<{ ok: true }>(`/api/profiles/${id}${confirm ? "?confirm=1" : ""}`, { method: "DELETE" }),
};
