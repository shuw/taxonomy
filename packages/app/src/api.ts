export interface ProfileSummary { id: string; name: string; path: string; mtime: number; }
export interface ProfileFileBody { id: string; path: string; mtime: number; text: string; }

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  example: () => call<{ text: string }>("/api/example"),
  list: () => call<ProfileSummary[]>("/api/profiles"),
  get: (id: string) => call<ProfileFileBody>(`/api/profiles/${id}`),
  put: (id: string, text: string) => call<{ id: string; path: string; mtime: number }>(`/api/profiles/${id}`, json("PUT", { text })),
  create: (name: string, text?: string) => call<ProfileFileBody>("/api/profiles", json("POST", { name, text })),
  remove: (id: string) => call<{ ok: true }>(`/api/profiles/${id}`, { method: "DELETE" }),
};
