import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "taxonomy-store-"));
process.env.TAXONOMY_DATA = dir;
const { rootStore, storeByToken, storeFor, userStore, usersDir } = await import("../../mcp/store.ts");
const { storeForRequest } = await import("../../mcp/http.ts");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("stores and their secrets", () => {
  test("a user id that is not an account id never becomes a path", () => {
    expect(() => userStore("../../etc")).toThrow();
    expect(() => userStore("short")).toThrow();
    expect(userStore("abcdefghijklmnopqrstuv").dir).toBe(join(usersDir, "abcdefghijklmnopqrstuv"));
  });

  test("a remote secret picks out exactly the store it belongs to", () => {
    const a = userStore("aaaaaaaaaaaaaaaaaaaaaa");
    const b = userStore("bbbbbbbbbbbbbbbbbbbbbb");
    const ta = a.remoteConfig().token, tb = b.remoteConfig().token;
    expect(storeByToken(ta)?.dir).toBe(a.dir);
    expect(storeByToken(tb)?.dir).toBe(b.dir);
    expect(storeByToken(ta.slice(0, -1) + "x")).toBeNull();
    expect(storeByToken("")).toBeNull();
    expect(rootStore.remoteConfigIfAny()).toBeNull();
  });

  test("the HTTP server takes the secret from the path or from a bearer header, nowhere else", () => {
    const a = userStore("aaaaaaaaaaaaaaaaaaaaaa");
    const t = a.remoteConfig().token;
    expect(storeForRequest(new Request(`http://127.0.0.1:5182/${t}/mcp`))?.dir).toBe(a.dir);
    expect(storeForRequest(new Request("http://127.0.0.1:5182/mcp", { headers: { authorization: `Bearer ${t}` } }))?.dir).toBe(a.dir);
    expect(storeForRequest(new Request(`http://127.0.0.1:5182/mcp?token=${t}`))).toBeNull();
    expect(storeForRequest(new Request(`http://127.0.0.1:5182/${t}/other`))).toBeNull();
    expect(storeForRequest(new Request("http://127.0.0.1:5182/"))).toBeNull();
  });

  test("a store keeps history and attachments inside its own directory", () => {
    const s = storeFor(join(dir, "solo"));
    expect(s.attachmentPath("me", "../secret.txt")).toBeNull();
    expect(s.attachmentPath("me", "page1.png")).toBe(join(s.dir, "attachments", "me", "page1.png"));
    expect(s.historyFor("me")).toBe(join(s.dir, "history", "me.jsonl"));
  });
});
