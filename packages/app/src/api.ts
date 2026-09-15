export interface ProfileSummary { id: string; name: string; path: string; mtime: number; }
export interface ProfileFileBody { id: string; path: string; mtime: number; text: string; }

/** The file changed on disk since the app last read it; carries the current version. */
export class ConflictError extends Error {
  constructor(public file: ProfileFileBody) { super("the file changed on disk"); }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json()) as T & { error?: string };
  if (res.status === 409) throw new ConflictError(body as unknown as ProfileFileBody);
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  example: () => call<{ text: string }>("/api/example"),
  list: () => call<ProfileSummary[]>("/api/profiles"),
  get: (id: string) => call<ProfileFileBody>(`/api/profiles/${id}`),
  /** Writes only if the file still has `mtime`; a 409 carries the newer file. */
  put: (id: string, text: string, mtime?: number) => call<{ id: string; path: string; mtime: number }>(`/api/profiles/${id}`, json("PUT", { text, mtime })),
  create: (name: string, text?: string) => call<ProfileFileBody>("/api/profiles", json("POST", { name, text })),
  remove: (id: string) => call<{ ok: true }>(`/api/profiles/${id}`, { method: "DELETE" }),
};
