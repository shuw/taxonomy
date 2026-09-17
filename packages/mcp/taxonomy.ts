/**
 * Taxonomy as an MCP server: an agent (Claude Desktop, claude.ai, Claude Code, anything that
 * speaks MCP) reads the plan, explains it, tries changes and proposes scenarios. All tax math
 * is the engine's; the agent never writes YAML. The only writes are scenarios, pending fact
 * changes and intake documents, all reviewed in the app.
 *
 * `server.ts` serves this over stdio (Claude Desktop, Claude Code); `http.ts` over HTTP behind
 * a secret path (claude.ai through a tunnel).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describeChanges, editProfileText, migrateProfileText, parseProfile, tools, type EventInput, type HistoryEntry, type ProfileEdit } from "@taxonomy/engine";
import { appendFileSync } from "node:fs";
import { mkdirSync } from "node:fs";

const root = resolve(import.meta.dir, "../..");
const dataDir = process.env.TAXONOMY_DATA ? resolve(process.env.TAXONOMY_DATA) : join(root, "data");
const dir = join(dataDir, "profiles");
const ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

function listProfiles(): { id: string; name: string }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".yaml")).map((f) => {
    const id = f.slice(0, -5);
    const text = readFileSync(join(dir, f), "utf8");
    let name = id;
    try { name = parseProfile(migrateProfileText(text)).name?.trim() || id; } catch {}
    return { id, name };
  });
}

/** The profile the app is showing, if it has said. */
function currentProfileId(): string | undefined {
  try { const id = readFileSync(join(dataDir, ".current"), "utf8").trim(); return id && existsSync(join(dir, `${id}.yaml`)) ? id : undefined; } catch { return undefined; }
}

/**
 * Which profile a call means: the one named (by id or by name), else the only one, else the one
 * open in the app. With several and no way to choose, the agent has to ask.
 */
function load(ref?: string): { id: string; text: string; profile: ReturnType<typeof parseProfile>; chosenBy: "name" | "only" | "app" } {
  const all = listProfiles();
  if (all.length === 0) throw new Error("no profiles yet; create_profile, or create one in the app");
  let chosen: { id: string; name: string } | undefined;
  let chosenBy: "name" | "only" | "app" = "name";
  if (ref !== undefined) {
    const key = ref.trim().toLowerCase();
    chosen = all.find((p) => p.id === key);
    if (!chosen) {
      // Several profiles can share a name; the one open in the app wins, otherwise the agent has to say which id.
      const byName = all.filter((p) => p.name.toLowerCase() === key);
      const candidates = byName.length ? byName : all.filter((p) => p.name.toLowerCase().startsWith(key));
      const current = currentProfileId();
      chosen = candidates.length === 1 ? candidates[0] : candidates.find((p) => p.id === current);
      if (!chosen && candidates.length > 1) throw new Error(`"${ref}" matches ${candidates.length} profiles: ${candidates.map((p) => `"${p.id}"`).join(", ")}; pass one of those ids as profile`);
    }
    if (!chosen) throw new Error(`no profile "${ref}"; have ${all.map((p) => `"${p.id}" (${p.name})`).join(", ")}`);
  } else if (all.length === 1) {
    chosen = all[0]; chosenBy = "only";
  } else {
    const current = currentProfileId();
    chosen = all.find((p) => p.id === current); chosenBy = "app";
  }
  if (!chosen) throw new Error(`several profiles exist and none is open in the app; pass profile: one of ${all.map((p) => `"${p.id}" (${p.name})`).join(", ")}`);
  const text = migrateProfileText(readFileSync(join(dir, `${chosen.id}.yaml`), "utf8"));
  return { id: chosen.id, text, profile: parseProfile(text), chosenBy };
}

/** Every result says which profile it is about, so the agent can tell the user when there are several. */
function about(f: ReturnType<typeof load>, result: unknown): unknown {
  const note = f.chosenBy === "app" ? `${f.id} (the one open in the app)` : f.id;
  return Array.isArray(result) ? { profile: note, result } : { ...(result as Record<string, unknown>), profile: note };
}

/** The app keeps one line per save in data/history/<id>.jsonl; writes from here are logged the same way, under the client's name. */
function recordChange(id: string, beforeText: string | null, afterText: string, actor: string): void {
  let lines: string[];
  try { lines = describeChanges(beforeText === null ? null : parseProfile(migrateProfileText(beforeText)), parseProfile(afterText)); } catch { lines = ["edited the file"]; }
  if (lines.length === 0) return;
  const entry: HistoryEntry = { at: new Date().toISOString(), actor, lines, before: beforeText ?? undefined };
  try { mkdirSync(join(dataDir, "history"), { recursive: true, mode: 0o700 }); appendFileSync(join(dataDir, "history", `${id}.jsonl`), JSON.stringify(entry) + "\n", { mode: 0o600 }); } catch {}
}

/** Read, edit and write in one go; the app's poll picks the change up within two seconds. */
function write(id: string, edits: ProfileEdit[], actor = currentClient): void {
  const path = join(dir, `${id}.yaml`);
  const before = statSync(path).mtimeMs;
  const beforeText = readFileSync(path, "utf8");
  let text = editProfileText(migrateProfileText(beforeText), edits);
  // A "missing" question whose value just arrived is closed in the same save.
  const settled = tools.answeredFollowUps(parseProfile(text));
  if (settled.length) text = editProfileText(text, settled);
  parseProfile(text);
  if (statSync(path).mtimeMs !== before) throw new Error("the file changed while this was being prepared; try again");
  writeFileSync(path, text, { mode: 0o600 });
  recordChange(id, beforeText, text, actor);
}

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 1) }] });
const fail = (e: unknown) => ({ content: [{ type: "text" as const, text: `Error: ${(e as Error).message ?? String(e)}` }], isError: true });


function slug(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return s || "profile";
}
function createProfile(name: string): { id: string; name: string } {
  const clean = name.trim();
  if (!clean) throw new Error("name is required");
  const taken = listProfiles().find((p) => p.name.trim().toLowerCase() === clean.toLowerCase());
  if (taken) throw new Error(`a profile named "${clean}" already exists (id "${taken.id}"); use it, or pick another name`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const base = slug(clean);
  let id = base;
  for (let n = 2; existsSync(join(dir, `${id}.yaml`)); n++) id = `${base}-${n}`;
  const text = editProfileText(readFileSync(join(root, "data", "profile.example.yaml"), "utf8"), [{ path: ["name"], value: clean }]);
  parseProfile(text);
  writeFileSync(join(dir, `${id}.yaml`), text, { mode: 0o600 });
  recordChange(id, null, text, currentClient);
  return { id, name: clean };
}

const profileArg = z.string().optional().describe("Which profile: an id or a name from list_profiles. Optional: the only profile, or the one open in the app, is used.");
const eventInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("exercise"), type: z.enum(["iso", "nso"]), year: z.number().int(), shares: z.number().min(0), company: z.string().optional().describe("company id or name; defaults to the first company"), date: z.string().optional().describe("YYYY-MM-DD; defaults to January 1 of the year") }),
  z.object({ kind: z.literal("sell"), year: z.number().int(), shares: z.number().min(0), price: z.string().or(z.number()).optional().describe("per share; defaults to the modeled price"), date: z.string().optional().describe("YYYY-MM-DD; defaults to December 31"), lots: z.record(z.number()).optional().describe("lot id to shares, to name lots instead of lowest-tax-first") }),
  z.object({ kind: z.literal("liquidity"), year: z.number().int(), price: z.number().optional().describe("share price at the event; pins that year's price"), company: z.string().optional() }),
  z.object({ kind: z.literal("give"), year: z.number().int(), how: z.enum(["cash", "stock", "daf"]).describe("cash, appreciated shares at fair value, or a donor-advised fund contribution"), amount: z.number().min(0).describe("dollars; for stock, the fair value given") }),
]);
const toEvents = (list: z.infer<typeof eventInput>[]): EventInput[] => list.map((e) => (e.kind === "sell" && typeof e.price === "string" ? { ...e, price: Number(e.price) } : e)) as EventInput[];

let currentClient = "your agent";

export function createServer(opts: { clientLabel?: string } = {}): McpServer {
  const server = new McpServer(
  { name: "taxonomy", version: "0.1.0" },
  { instructions: [
    "Taxonomy is a personal US tax-planning tool. You read its plan, explain it and propose scenarios; the engine does all tax math.",
    "Profiles: a person or a household each has one; what-ifs are scenarios inside a profile. Every tool takes `profile` (id or name). Without it, the only profile or the one open in the app is used, and each result names the profile it is about; when several exist, say which one you are talking about, and ask if the user's words could mean another.",
    "When the user says to connect to (or set up) a Taxonomy profile, call get_context on it right away; the app is watching for that call. Then say in two or three lines what the profile holds and what is still missing (its `outstanding` section), and offer the next step: read a document, or answer a question here.",
    "Filling in a profile is a conversation, not one sweep. Simple facts the user can state (salary, birth years, a bonus, a balance): ask in chat and use facts. Documents: intake(request) for one section at a time, then intake(submit); several submissions are expected. Never stall on something missing; note it and move on.",
    "Start with get_context, then get_plan. Never state a tax figure you did not get from a tool; when asked why, quote the line's reason from explain or analyze(compare_years).",
    "To change the plan: call what_if to show the effect if the user is weighing it, then scenario(add) with a name that reads like the request; the app switches to it and shows what changed.",
    "To change a fact or assumption the user states (a raise, a growth rate, a switch), call facts; it is applied at once, logged, and undoable in the app.",
    "To set up or fill in a profile from documents: create_profile if there is none for this person, intake(request) for the sections, read the documents it names, then intake(submit) with the YAML. Values are written at once with their sources; the app shows what came in.",
    "Shares are counts, prices and amounts are dollars, rates are fractions, years are calendar years. 'Next year' means the year after the one being discussed, or the plan's first year plus one when none was.",
    "When a request is ambiguous ('sell some'), ask one question rather than guessing.",
    "If a call fails with 'No approval received', that is the chat's own tool-permission prompt, not Taxonomy: ask the user to click Allow (or Always allow) on the card in the chat, then retry. Taxonomy never waits for an approval.",
  ].join("\n") },
);

  /** The app reads this to say whether an agent is connected and when it was last used. */
  function heartbeat(profile?: string): void {
    const client = server.server.getClientVersion()?.name ?? opts.clientLabel ?? "unknown client";
    currentClient = client;
    try { mkdirSync(dataDir, { recursive: true }); writeFileSync(join(dataDir, ".agent"), JSON.stringify({ lastSeen: new Date().toISOString(), client, profile }), { mode: 0o600 }); } catch {}
  }
  const run = async <T>(f: () => T) => { heartbeat(); try { return json(await f()); } catch (e) { return fail(e); } };
  /** Load, and record which profile this call was about (the app's setup screen watches for that). */
  const use = (ref?: string) => { const f = load(ref); heartbeat(f.id); return f; };

const factChange = z.object({
  field: z.string().describe("a field path or label from get_context's `fields`, e.g. people.self.salary, assumptions.fmvGrowth, 'Years to plan'"),
  value: z.union([z.string(), z.number(), z.boolean()]).describe("in the field's type; percentages as 0.2, 20 or '20%'; money as 400000 or '400k'"),
  company: z.string().optional().describe("company id or name, for per-company fields such as share price or growth"),
  from: z.number().int().optional().describe("a plan year: the change starts then (a raise, a law change) instead of replacing the fact now"),
  until: z.number().int().optional().describe("with from: the last year it applies (a one-time gain, a year of no bonus). Not for gifts: a gift in one year is a give event in a scenario"),
  source: z.string().optional().describe("where it came from: 'told in chat', or the document"),
});

server.registerTool("list_profiles", { description: "The profiles on this machine (id, name, and which one the app is showing). A profile is one person or household; what-ifs are scenarios within it.", annotations: { title: "List profiles", readOnlyHint: true, destructiveHint: false, openWorldHint: false } }, async () => run(() => { const current = currentProfileId(); return listProfiles().map((p) => ({ ...p, openInApp: p.id === current || undefined })); }));

server.registerTool("create_profile", {
  description: "Start a new profile from the example, named for the person or household. Follow with intake (request, then submit) to fill it from documents; pass the returned id as `profile` from then on.",
  annotations: { title: "Create a profile", readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  inputSchema: { name: z.string() },
}, async ({ name }) => run(() => ({ ...createProfile(name), next: "call intake with action 'request' for this profile, gather the documents, then intake with action 'submit'" })));

server.registerTool("get_context", {
  description: "Who this is, what they hold, the plan years, the scenarios, what is still missing (`outstanding`), the editable fields with current values, and the vocabulary the other tools use. Call first.",
  annotations: { title: "Read the profile", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  inputSchema: { profile: profileArg },
}, async ({ profile }) => run(() => { const f = use(profile); return about(f, tools.context(f.profile)); }));

server.registerTool("get_plan", {
  description: "Every plan year's headline lines (AGI, regular tax, AMT, credit, state, total, cash in, exercise cost, net cash, shares exercised, sold, RSUs settled) and the year's decisions, for a scenario (the active one by default).",
  annotations: { title: "Read the plan", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  inputSchema: { profile: profileArg, scenario: z.string().optional() },
}, async ({ profile, scenario }) => run(() => { const f = use(profile); return about(f, tools.plan(f.profile, scenario)); }));

server.registerTool("explain", {
  description: "One ledger line in one year: its value, the plain-English reason, and the lines it was computed from. Line ids come from get_plan or analyze(compare_years).",
  annotations: { title: "Explain a number", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  inputSchema: { profile: profileArg, year: z.number().int(), line: z.string(), scenario: z.string().optional() },
}, async ({ profile, year, line, scenario }) => run(() => { const f = use(profile); return about(f, tools.explain(f.profile, year, line, scenario)); }));

server.registerTool("analyze", {
  description: [
    "One of the plan's analyses, by `kind`:",
    "compare_years (from, to): the lines that differ most between two years, largest change first, each with the later year's reason. The answer to 'why is this year so high'.",
    "amt_headroom (year, company?): the most ISO shares that can be exercised in a year with no AMT, the AMT per extra share past that, and the AMT from exercising everything.",
    "credit_recovery (year, company?): how the AMT credit from a year's ISO exercise comes back in later years, and when it clears.",
    "hold_or_sell (year, company?): for a year's ISO exercise, hold and sell next year versus sell the same day, with tax, cash needed, proceeds and the net over the plan.",
    "lots (year, date?): shares held going into a year's sales, lot by lot, with basis and whether each is short-term, long-term, qualifying or disqualifying on a date.",
    "sell_to_cover (year): the smallest sale in a year whose proceeds pay that year's whole tax, including the tax on the sale.",
  ].join(" "),
  annotations: { title: "Analyze the plan", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  inputSchema: {
    profile: profileArg,
    kind: z.enum(["compare_years", "amt_headroom", "credit_recovery", "hold_or_sell", "lots", "sell_to_cover"]),
    year: z.number().int().optional().describe("the year in question (all kinds but compare_years)"),
    from: z.number().int().optional().describe("compare_years: the earlier year"),
    to: z.number().int().optional().describe("compare_years: the later year"),
    company: z.string().optional().describe("company id or name, when there are several"),
    date: z.string().optional().describe("lots: YYYY-MM-DD to judge holding periods on"),
    scenario: z.string().optional(),
  },
}, async ({ profile, kind, year, from, to, company, date, scenario }) => run(() => {
  const f = use(profile);
  const need = (v: number | undefined, what: string) => { if (v === undefined) throw new Error(`${kind} needs ${what}`); return v; };
  switch (kind) {
    case "compare_years": return about(f, tools.compareYears(f.profile, need(from, "from"), need(to, "to"), scenario));
    case "amt_headroom": return about(f, tools.amtHeadroom(f.profile, need(year, "year"), company));
    case "credit_recovery": return about(f, tools.recovery(f.profile, need(year, "year"), company) ?? { note: `no ISO exercise in ${year}` });
    case "hold_or_sell": return about(f, tools.holdVersusSell(f.profile, need(year, "year"), company) ?? { note: `no ISO exercise in ${year}` });
    case "lots": return about(f, tools.lots(f.profile, need(year, "year"), date));
    case "sell_to_cover": return about(f, tools.sellToCover(f.profile, need(year, "year")));
  }
}));

server.registerTool("what_if", {
  description: "Try decisions on top of a scenario (the active one by default) without saving: add events, optionally remove existing ones by id. Returns the resulting years and the change in total tax, AMT and net cash against the scenario.",
  annotations: { title: "Try a what-if", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  inputSchema: { profile: profileArg, add: z.array(eventInput), remove: z.array(z.string()).optional(), basedOn: z.string().optional() },
}, async ({ profile, add, remove, basedOn }) => run(() => { const f = use(profile); return about(f, tools.whatIf(f.profile, toEvents(add), remove ?? [], basedOn)); }));

server.registerTool("scenario", {
  description: [
    "Scenarios, by `action`:",
    "add (name, add, remove?, basedOn?, note?): save decisions as a new named scenario based on the active one plus the added events, and switch the app to it; the scenario it was based on stays as it was. Returns the effect.",
    "activate (name): make a scenario the active one, what the app shows.",
    "delete (name): delete a scenario; the last one cannot be deleted.",
    "Every change is logged in the app's history and can be undone there.",
  ].join(" "),
  annotations: { title: "Change scenarios", readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  inputSchema: { profile: profileArg, action: z.enum(["add", "activate", "delete"]), name: z.string(), add: z.array(eventInput).optional(), remove: z.array(z.string()).optional(), basedOn: z.string().optional(), note: z.string().optional() },
}, async ({ profile, action, name, add, remove, basedOn, note }) => run(() => {
  const f = use(profile);
  if (action === "add") {
    const p = tools.proposeScenario(f.profile, name, toEvents(add ?? []), { basedOn, remove, note: note ?? `added by ${currentClient} on ${new Date().toISOString().slice(0, 10)}` });
    write(f.id, [...p.edits, { path: ["activeScenario"], value: p.name }]);
    return about(f, { name: p.name, active: true, years: p.years, totals: p.totals, delta: p.delta });
  }
  if (action === "activate") { write(f.id, tools.setActiveScenario(f.profile, name)); return about(f, { active: name }); }
  write(f.id, tools.deleteScenario(f.profile, name));
  return about(f, { deleted: name });
}));

server.registerTool("facts", {
  description: "Set facts and assumptions the user states: salary, growth, inflation, share price, the Washington switches, years to plan and so on, now or from a given year. Applied at once with the source recorded; the app shows what changed and the history can undo it. Returns before/after rows and the effect on the plan.",
  annotations: { title: "Set facts", readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  inputSchema: { profile: profileArg, changes: z.array(factChange).min(1) },
}, async ({ profile, changes }) => run(() => {
  const f = use(profile);
  const proposed = tools.updateFacts(f.profile, changes);
  // Written as pending, then accepted in the same save: one logged change, the same sources as an accepted proposal.
  const staged = parseProfile(editProfileText(f.text, proposed.edits));
  write(f.id, [...proposed.edits, ...tools.resolvePending(staged, proposed.rows.map((r) => r.id), true)]);
  return about(f, { applied: proposed.rows, effect: proposed.delta });
}));

server.registerTool("intake", {
  description: [
    "Filling the profile from documents, by `action`:",
    "request (sections): the request Taxonomy would hand an agent for the given sections (basics, pay, prior_return, income, equity, home, giving, assumptions). Read it, gather what the documents show, produce the YAML in one go; leave anything the user could type themselves under `unknown` rather than asking.",
    "submit (document, sections?): send that YAML. Partial is fine, one section now and another later. Every value is written at once with its source, questions become follow-ups in the app, and the app shows what came in; the history can undo it.",
    "attach (name, base64): store a page image, PDF or text file behind the numbers, when you have the file itself. Cite it by name in sources; the app links each value to it.",
  ].join(" "),
  annotations: { title: "Fill in from documents", readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  inputSchema: {
    profile: profileArg, action: z.enum(["request", "submit", "attach"]),
    sections: z.array(z.enum(["basics", "pay", "prior_return", "income", "equity", "home", "giving", "assumptions"])).optional(),
    document: z.string().optional().describe("submit: the intake YAML, fenced or not"),
    name: z.string().optional().describe("attach: the file name, e.g. 2025-return-p1.png"),
    base64: z.string().optional().describe("attach: the file's bytes, base64; images, PDFs or text up to 25 MB"),
  },
}, async ({ profile, action, sections, document, name, base64 }) => run(() => {
  const f = use(profile);
  if (action === "request") return about(f, { request: tools.intakeRequest(f.profile, sections?.length ? sections : ["basics", "pay", "prior_return", "income", "equity", "home", "giving"]) });
  if (action === "attach") {
    if (!name || !base64) throw new Error("attach needs name and base64");
    const clean = name.replace(/[\\/]/g, "_").replace(/[^\x20-\x7E]/g, "").replace(/^\.+/, "").trim().slice(0, 120);
    if (!/\.(png|jpe?g|webp|gif|pdf|txt|csv|md|ya?ml|json)$/i.test(clean)) throw new Error("only images, PDFs and text files");
    const bytes = Buffer.from(base64, "base64");
    if (bytes.length === 0 || bytes.length > 25 * 1_048_576) throw new Error("the file is empty or over 25 MB");
    const dirAtt = join(dataDir, "attachments", f.id);
    mkdirSync(dirAtt, { recursive: true, mode: 0o700 });
    writeFileSync(join(dirAtt, clean), bytes, { mode: 0o600 });
    return about(f, { attached: clean, bytes: bytes.length, note: `cite it in sources as "${clean}" (add a page like "${clean} p3" when it has pages)` });
  }
  if (!document) throw new Error("submit needs the document");
  const r = tools.applyIntake(f.profile, document);
  if (r.problems.length) return about(f, { problems: r.problems, warnings: r.warnings, note: "fix the document and submit again" });
  if (r.edits.length) write(f.id, r.edits);
  const after = r.edits.length ? parseProfile(migrateProfileText(readFileSync(join(dir, `${f.id}.yaml`), "utf8"))) : f.profile;
  return about(f, { applied: r.applied, questions: r.questions, warnings: r.warnings, effect: r.edits.length ? tools.effect(f.profile, after) : null });
}));

  return server;
}
