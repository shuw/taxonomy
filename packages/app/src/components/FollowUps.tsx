import type { Profile, ProfileEdit } from "@taxonomy/engine";

const SECTION_FOR: [RegExp, string][] = [
  [/^(filer|people|plan)\./, "You"],
  [/^(grants\.|holdings|companies\.)/, "Equity"],
  [/^income\./, "Other income"],
  [/^home\./, "Home"],
  [/^deductions\./, "Giving and deductions"],
  [/^(carryforwards\.|returns)/, "Last return and carryforwards"],
  [/^assumptions\./, "Assumptions"],
];

/** What the intake agent asked you to confirm, until you mark each one done. */
export function FollowUps({ profile, edit }: { profile: Profile; edit: (edits: ProfileEdit[]) => void }) {
  const all = profile.followUps ?? [];
  const open = all.filter((f) => !f.resolved);
  if (open.length === 0) return null;
  const setResolved = (id: string, resolved: boolean) => edit([{ path: ["followUps"], value: all.map((f) => (f.id === id ? { ...f, resolved } : f)) }]);
  const sectionOf = (about?: string) => about && SECTION_FOR.find(([re]) => re.test(about))?.[1];
  return (
    <section className="card followups">
      <h2>Worth a second look</h2>
      <div className="sub">Your agent used its judgment on these. The numbers are already in; check them in the sidebar and tick each one off.</div>
      <ul>
        {open.map((f) => (
          <li key={f.id}>
            <label>
              <input type="checkbox" checked={false} onChange={() => setResolved(f.id, true)} />
              <span>{f.text}{sectionOf(f.about) && <span className="where"> · {sectionOf(f.about)}</span>}</span>
            </label>
          </li>
        ))}
      </ul>
      {all.length > open.length && <div className="muted small">{all.length - open.length} done.</div>}
    </section>
  );
}
