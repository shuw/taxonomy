import { useEffect, useRef, useState } from "react";
import type Anthropic from "@anthropic-ai/sdk";
import type { Profile, ProfileEdit } from "@taxonomy/engine";
import { describeProposal, isProposal, proposalToEdits, type Proposal } from "../proposal.ts";

interface Props { profile: Profile; profileText: string; edit: (edits: ProfileEdit[]) => void; onClose: () => void; }

interface PendingImage { id: string; media_type: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; data: string; }
type ProposalStatus = "pending" | "applied" | "discarded";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function AssistantPanel({ profile, profileText, edit, onClose }: Props) {
  const [messages, setMessages] = useState<Anthropic.MessageParam[]>([]);
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<PendingImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, ProposalStatus>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [messages, busy]);

  const addFiles = async (files: FileList | File[]) => {
    const next: PendingImage[] = [];
    for (const f of Array.from(files)) {
      if (!IMAGE_TYPES.has(f.type)) continue;
      if (f.size > 5 * 1024 * 1024) { setError("Images must be under 5 MB."); continue; }
      next.push({ id: crypto.randomUUID(), media_type: f.type as PendingImage["media_type"], data: await fileToBase64(f) });
    }
    setImages((prev) => [...prev, ...next].slice(0, 6));
  };

  const pendingToolUse = (): Anthropic.ToolUseBlock | null => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || typeof last.content === "string") return null;
    return (last.content as Anthropic.ContentBlock[]).find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use") ?? null;
  };

  const send = async () => {
    const text = draft.trim();
    if ((!text && images.length === 0) || busy) return;
    const content: Anthropic.ContentBlockParam[] = [];
    const tu = pendingToolUse();
    if (tu) content.push({ type: "tool_result", tool_use_id: tu.id, content: status[tu.id] === "applied" ? "The user applied this proposal." : "The user has not applied this proposal (yet)." });
    for (const im of images) content.push({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } });
    content.push({ type: "text", text: text || "Here is a screenshot." });
    const next: Anthropic.MessageParam[] = [...messages, { role: "user", content }];
    setMessages(next);
    setDraft("");
    setImages([]);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profileText, messages: next }) });
      const body = (await res.json()) as { content?: Anthropic.ContentBlock[]; error?: string };
      if (!res.ok || !body.content) throw new Error(body.error ?? res.statusText);
      setMessages([...next, { role: "assistant", content: body.content }]);
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setMessages(messages); // let the user retry with the same draft
      setDraft(text);
    } finally {
      setBusy(false);
    }
  };

  const apply = (id: string, p: Proposal) => {
    edit(proposalToEdits(p, profile));
    setStatus((s) => ({ ...s, [id]: "applied" }));
  };

  return (
    <div className="assistant">
      <div className="assistant-head">
        <div>
          <h3>Assistant</h3>
          <div className="muted small" style={{ margin: 0 }}>Paste screenshots from Carta, Shareworks, E*Trade or a pay stub, or just describe your grants. Nothing changes until you apply a proposal.</div>
        </div>
        <button type="button" className="btn icon" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="thread" ref={scroller}>
        {messages.length === 0 && (
          <div className="bubble assistant-bubble">
            <p>Try something like:</p>
            <ul>
              <li>a screenshot of your grants page, or a pasted table</li>
              <li>"40k ISOs at $2 from 2023, fully vested, and a 4-year RSU refresh of 8,000 units from March 2025 with a 1-year cliff"</li>
              <li>"my salary is 620k and the last 409A was $18"</li>
            </ul>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={"bubble " + (m.role === "user" ? "user-bubble" : "assistant-bubble")}>
            {typeof m.content === "string" ? <p>{m.content}</p> : (m.content as Anthropic.ContentBlockParam[]).map((b, j) => {
              if (b.type === "text") return b.text.split(/\n{2,}/).map((para, k) => <p key={`${j}-${k}`}>{para}</p>);
              if (b.type === "image" && b.source.type === "base64") return <img key={j} className="pasted" src={`data:${b.source.media_type};base64,${b.source.data}`} alt="pasted screenshot" />;
              if (b.type === "tool_use" && isProposal(b.input)) {
                const p = b.input;
                const st = status[b.id] ?? "pending";
                return (
                  <div key={j} className={"proposal " + st}>
                    <div className="proposal-title">Proposed changes</div>
                    <p>{p.summary}</p>
                    <ul>{describeProposal(p).map((line, k) => <li key={k}>{line}</li>)}</ul>
                    {st === "pending"
                      ? <div className="proposal-actions"><button type="button" className="btn primary" onClick={() => apply(b.id, p)}>Apply to profile</button><button type="button" className="btn" onClick={() => setStatus((s) => ({ ...s, [b.id]: "discarded" }))}>Discard</button></div>
                      : <div className="muted small" style={{ margin: 0 }}>{st === "applied" ? "Applied." : "Discarded."}</div>}
                  </div>
                );
              }
              return null;
            })}
          </div>
        ))}
        {busy && <div className="bubble assistant-bubble muted">Reading…</div>}
        {error && <div className="error">{error}</div>}
      </div>
      <div className="composer" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void addFiles(e.dataTransfer.files); }}>
        {images.length > 0 && (
          <div className="thumbs">
            {images.map((im) => <span key={im.id} className="thumb"><img src={`data:${im.media_type};base64,${im.data}`} alt="" /><button type="button" onClick={() => setImages((p) => p.filter((x) => x.id !== im.id))} aria-label="Remove image">×</button></span>)}
          </div>
        )}
        <textarea
          id="assistant-draft" value={draft} placeholder="Describe your grants, or paste a screenshot (⌘V)…" rows={3}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => { const files = Array.from(e.clipboardData.files); if (files.length) { e.preventDefault(); void addFiles(files); } }}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(); }}
        />
        <div className="composer-actions">
          <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
          <button type="button" className="btn" onClick={() => fileInput.current?.click()}>Add screenshot</button>
          <span className="spacer" />
          <button type="button" className="btn primary" disabled={busy || (!draft.trim() && images.length === 0)} onClick={() => void send()}>Send</button>
        </div>
      </div>
    </div>
  );
}
