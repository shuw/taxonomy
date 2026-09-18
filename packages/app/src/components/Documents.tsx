import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type Attachment } from "../api.ts";
import { ProfileIdContext } from "../persist.ts";
import { Info } from "./Info.tsx";

interface Docs { id: string; list: Attachment[]; refresh: () => void; }
export const DocumentsContext = createContext<Docs | null>(null);

/** The documents stored behind this profile, for the dialog and for source chips that can point at one. */
export function DocumentsProvider({ children }: { children: ReactNode }) {
  const id = useContext(ProfileIdContext);
  const [list, setList] = useState<Attachment[]>([]);
  const refresh = useCallback(() => { api.attachments(id).then(setList).catch(() => setList([])); }, [id]);
  useEffect(() => { refresh(); }, [refresh]);
  const value = useMemo(() => ({ id, list, refresh }), [id, list, refresh]);
  return <DocumentsContext.Provider value={value}>{children}</DocumentsContext.Provider>;
}

/** When a source names a stored document ("2025-return-p1.png p3"), the link to it. */
export function useDocumentLink(source: string | undefined): string | undefined {
  const docs = useContext(DocumentsContext);
  if (!docs || !source) return undefined;
  const s = source.toLowerCase();
  const hit = docs.list.find((a) => s.includes(a.name.toLowerCase()));
  return hit ? api.attachmentUrl(docs.id, hit.name) : undefined;
}

const size = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Upload, open and remove the pages behind the numbers. */
export function Documents() {
  const docs = useContext(DocumentsContext);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!docs) return null;
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); setError(null);
    try {
      for (const f of Array.from(files)) {
        const buf = new Uint8Array(await f.arrayBuffer());
        let bin = "";
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        await api.attach(docs.id, f.name, btoa(bin));
      }
    } catch (e) { setError(`Could not add the file: ${e instanceof Error ? e.message : String(e)}`); }
    finally { docs.refresh(); setBusy(false); }
  };
  return (
    <div className="docs">
      <div className="subhead">Documents <Info label="About documents">A value's source chip links to its page here.</Info></div>
      <p className="muted small">The pages your numbers came from.</p>
      {docs.list.length > 0 && (
        <ul className="plain doc-list">
          {docs.list.map((a) => (
            <li key={a.name}>
              <a href={api.attachmentUrl(docs.id, a.name)} target="_blank" rel="noreferrer">{a.name}</a>
              <span className="muted small"> · {size(a.size)}</span>
              <button type="button" className="link danger" onClick={() => { api.detach(docs.id, a.name).then(docs.refresh).catch((e) => setError(String(e))); }}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <label className={"btn" + (busy ? " disabled" : "")}>
        {busy ? "Adding…" : "Add pages…"}
        <input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.csv,.md,.yaml,.yml,.json" hidden disabled={busy} onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
      </label>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
