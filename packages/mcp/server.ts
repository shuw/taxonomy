/**
 * Taxonomy as an MCP server: an agent (Claude Desktop, Claude Code, anything that speaks MCP)
 * reads the plan, explains it, tries changes and proposes scenarios. All tax math is the
 * engine's; the agent never writes YAML. The only writes are a new scenario, switching or
 * deleting one, and applying an intake document through the same review the app uses.
 *
 * Run: bun packages/mcp/server.ts   (stdio; see README "Connect your agent")
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { editProfileText, migrateProfileText, parseProfile, tools, type EventInput, type ProfileEdit } from "@taxonomy/engine";

const root = resolve(import.meta.dir, "../..");
const dir = join(root, "data", "profiles");
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

/** The one profile, or the named one; with several profiles the agent has to say which. */
function load(id?: string): { id: string; text: string; profile: ReturnType<typeof parseProfile> } {
  const all = listProfiles();
  const chosen = id ?? (all.length === 1 ? all[0]!.id : undefined);
  if (!chosen) throw new Error(all.length ? `several profiles exist; pass profile: one of ${all.map((p) => `"${p.id}" (${p.name})`).join(", ")}` : "no profiles yet; create one in the app first");
  if (!ID.test(chosen) || !existsSync(join(dir, `${chosen}.yaml`))) throw new Error(`no profile "${chosen}"; have ${all.map((p) => p.id).join(", ")}`);
  const text = migrateProfileText(readFileSync(join(dir, `${chosen}.yaml`), "utf8"));
  return { id: chosen, text, profile: parseProfile(text) };
}

/** Read, edit and write in one go; the app's poll picks the change up within two seconds. */
function write(id: string, edits: ProfileEdit[]): void {
  const path = join(dir, `${id}.yaml`);
  const before = statSync(path).mtimeMs;
  const text = editProfileText(migrateProfileText(readFileSync(path, "utf8")), edits);
  parseProfile(text);
  if (statSync(path).mtimeMs !== before) throw new Error("the file changed while this was being prepared; try again");
  writeFileSync(path, text);
}

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 1) }] });
const fail = (e: unknown) => ({ content: [{ type: "text" as const, text: `Error: ${(e as Error).message ?? String(e)}` }], isError: true });
const run = async <T>(f: () => T) => { try { return json(await f()); } catch (e) { return fail(e); } };

const profileArg = z.string().optional().describe("Profile id (from list_profiles). Optional when only one profile exists.");
const eventInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("exercise"), type: z.enum(["iso", "nso"]), year: z.number().int(), shares: z.number().min(0), company: z.string().optional().describe("company id or name; defaults to the first company"), date: z.string().optional().describe("YYYY-MM-DD; defaults to January 1 of the year") }),
  z.object({ kind: z.literal("sell"), year: z.number().int(), shares: z.number().min(0), price: z.string().or(z.number()).optional().describe("per share; defaults to the modeled price"), date: z.string().optional().describe("YYYY-MM-DD; defaults to December 31"), lots: z.record(z.number()).optional().describe("lot id to shares, to name lots instead of lowest-tax-first") }),
  z.object({ kind: z.literal("liquidity"), year: z.number().int(), price: z.number().optional().describe("share price at the event; pins that year's price"), company: z.string().optional() }),
]);
const toEvents = (list: z.infer<typeof eventInput>[]): EventInput[] => list.map((e) => (e.kind === "sell" && typeof e.price === "string" ? { ...e, price: Number(e.price) } : e)) as EventInput[];

const server = new McpServer(
  { name: "taxonomy", version: "0.1.0" },
  { instructions: [
    "Taxonomy is a personal US tax-planning tool. You read its plan, explain it and propose scenarios; the engine does all tax math.",
    "Start with get_context, then get_plan. Never state a tax figure you did not get from a tool; when asked why, quote the line's reason from explain or compare_years.",
    "To change the plan: call what_if to show the effect, then propose_scenario with a name that reads like the request. The user accepts it in the app.",
    "To change a fact or assumption the user states (a raise, a growth rate, a switch), call update_facts; it waits for the user's review in the app. When the facts come from documents, use intake_request and apply_intake instead.",
    "Shares are counts, prices and amounts are dollars, rates are fractions, years are calendar years. 'Next year' means the year after the one being discussed, or the plan's first year plus one when none was.",
    "When a request is ambiguous ('sell some'), ask one question rather than guessing.",
  ].join("\n") },
);

server.registerTool("list_profiles", { description: "The profiles on this machine: id and name." }, async () => run(() => listProfiles()));

server.registerTool("get_context", {
  description: "Who this is, what they hold, the plan years, the scenarios, and the vocabulary the other tools use. Call first.",
  inputSchema: { profile: profileArg },
}, async ({ profile }) => run(() => tools.context(load(profile).profile)));

server.registerTool("get_plan", {
  description: "Every plan year's headline lines (AGI, regular tax, AMT, credit, state, total, cash in, exercise cost, net cash, shares exercised, sold, RSUs settled) and the year's decisions, for a scenario (the active one by default).",
  inputSchema: { profile: profileArg, scenario: z.string().optional() },
}, async ({ profile, scenario }) => run(() => tools.plan(load(profile).profile, scenario)));

server.registerTool("explain", {
  description: "One ledger line in one year: its value, the plain-English reason, and the lines it was computed from. Line ids come from get_plan or compare_years.",
  inputSchema: { profile: profileArg, year: z.number().int(), line: z.string(), scenario: z.string().optional() },
}, async ({ profile, year, line, scenario }) => run(() => tools.explain(load(profile).profile, year, line, scenario)));

server.registerTool("compare_years", {
  description: "The lines that differ most between two years, largest change first, each with the later year's reason. The answer to 'why is this year so high'.",
  inputSchema: { profile: profileArg, from: z.number().int(), to: z.number().int(), scenario: z.string().optional() },
}, async ({ profile, from, to, scenario }) => run(() => tools.compareYears(load(profile).profile, from, to, scenario)));

server.registerTool("amt_headroom", {
  description: "The most ISO shares that can be exercised in a year with no AMT, the AMT per extra share past that, and the AMT from exercising everything. Per company when there are several.",
  inputSchema: { profile: profileArg, year: z.number().int(), company: z.string().optional() },
}, async ({ profile, year, company }) => run(() => tools.amtHeadroom(load(profile).profile, year, company)));

server.registerTool("credit_recovery", {
  description: "How the AMT credit from a year's ISO exercise comes back in later years, oldest credit first, and when it clears.",
  inputSchema: { profile: profileArg, year: z.number().int(), company: z.string().optional() },
}, async ({ profile, year, company }) => run(() => tools.recovery(load(profile).profile, year, company) ?? { note: `no ISO exercise in ${year}` }));

server.registerTool("hold_or_sell", {
  description: "For a year's ISO exercise: hold and sell the next year versus sell the same day, with tax, cash needed, proceeds and the net over the plan.",
  inputSchema: { profile: profileArg, year: z.number().int(), company: z.string().optional() },
}, async ({ profile, year, company }) => run(() => tools.holdVersusSell(load(profile).profile, year, company) ?? { note: `no ISO exercise in ${year}` }));

server.registerTool("lots", {
  description: "Shares held going into a year's sales, lot by lot, with each lot's basis and whether it is short-term, long-term, qualifying or disqualifying on a date.",
  inputSchema: { profile: profileArg, year: z.number().int(), date: z.string().optional() },
}, async ({ profile, year, date }) => run(() => tools.lots(load(profile).profile, year, date)));

server.registerTool("sell_to_cover", {
  description: "The smallest sale in a year whose proceeds pay that year's whole tax, including the tax on the sale.",
  inputSchema: { profile: profileArg, year: z.number().int() },
}, async ({ profile, year }) => run(() => tools.sellToCover(load(profile).profile, year)));

server.registerTool("what_if", {
  description: "Try decisions on top of a scenario (the active one by default) without saving: add events, optionally remove existing ones by id. Returns the resulting years and the change in total tax, AMT and net cash against the scenario.",
  inputSchema: { profile: profileArg, add: z.array(eventInput), remove: z.array(z.string()).optional(), basedOn: z.string().optional() },
}, async ({ profile, add, remove, basedOn }) => run(() => tools.whatIf(load(profile).profile, toEvents(add), remove ?? [], basedOn)));

server.registerTool("propose_scenario", {
  description: "Save decisions as a new named scenario, based on the active one (or basedOn) plus the added events, minus any removed by id. The active scenario is untouched; the app shows the proposal for the user to accept. Returns the effect.",
  inputSchema: { profile: profileArg, name: z.string(), add: z.array(eventInput), remove: z.array(z.string()).optional(), basedOn: z.string().optional(), note: z.string().optional() },
}, async ({ profile, name, add, remove, basedOn, note }) => run(() => {
  const f = load(profile);
  const p = tools.proposeScenario(f.profile, name, toEvents(add), { basedOn, remove, note });
  write(f.id, p.edits);
  return { name: p.name, years: p.years, totals: p.totals, delta: p.delta };
}));

server.registerTool("set_active_scenario", {
  description: "Make a scenario the active one (what the app shows).",
  inputSchema: { profile: profileArg, name: z.string() },
}, async ({ profile, name }) => run(() => { const f = load(profile); write(f.id, tools.setActiveScenario(f.profile, name)); return { active: name }; }));

server.registerTool("delete_scenario", {
  description: "Delete a scenario. The last one cannot be deleted.",
  inputSchema: { profile: profileArg, name: z.string() },
}, async ({ profile, name }) => run(() => { const f = load(profile); write(f.id, tools.deleteScenario(f.profile, name)); return { deleted: name }; }));

const factChange = z.object({
  field: z.string().describe("a field path or label from get_context's `fields`, e.g. people.self.salary, assumptions.fmvGrowth, 'Years to plan'"),
  value: z.union([z.string(), z.number(), z.boolean()]).describe("in the field's type; percentages as 0.2, 20 or '20%'; money as 400000 or '400k'"),
  company: z.string().optional().describe("company id or name, for per-company fields such as share price or growth"),
  from: z.number().int().optional().describe("a plan year: the change starts then (a raise, a law change) instead of replacing the fact now"),
  source: z.string().optional().describe("where it came from: 'told in chat', or the document"),
});

server.registerTool("update_facts", {
  description: "Propose changes to facts or assumptions (salary, growth, inflation, share price, the Washington switches, years to plan, ...), now or from a given year. Nothing takes effect until the user accepts the change in the app; returns the before/after rows and what accepting would do to the plan.",
  inputSchema: { profile: profileArg, changes: z.array(factChange).min(1) },
}, async ({ profile, changes }) => run(() => {
  const f = load(profile);
  const r = tools.updateFacts(f.profile, changes);
  write(f.id, r.edits);
  return { pending: r.rows, effect: r.delta, note: "waiting for the user to accept in the app" };
}));

server.registerTool("pending_changes", {
  description: "Changes to facts still waiting for the user's review, with their combined effect on the plan.",
  inputSchema: { profile: profileArg },
}, async ({ profile }) => run(() => tools.pendingReview(load(profile).profile)));

server.registerTool("withdraw_changes", {
  description: "Take back pending fact changes the agent proposed (all of them when no ids are given). Accepting is the user's, in the app.",
  inputSchema: { profile: profileArg, ids: z.array(z.string()).optional() },
}, async ({ profile, ids }) => run(() => { const f = load(profile); write(f.id, tools.resolvePending(f.profile, ids, false)); return { withdrawn: ids ?? "all" }; }));

server.registerTool("intake_request", {
  description: "The request Taxonomy would hand an agent to fill in facts from documents for the given sections (basics, pay, prior_return, income, equity, home, assumptions). Read it, gather the documents, produce the YAML it asks for, then call apply_intake.",
  inputSchema: { profile: profileArg, sections: z.array(z.enum(["basics", "pay", "prior_return", "income", "equity", "home", "assumptions"])) },
}, async ({ profile, sections }) => run(() => ({ request: tools.intakeRequest(load(profile).profile, sections) })));

server.registerTool("apply_intake", {
  description: "Apply an intake YAML document to the profile: each value is validated, diffed against the current facts and recorded with its source, and the agent's questions become follow-ups the user answers in the app. This is the only way facts change from a conversation.",
  inputSchema: { profile: profileArg, document: z.string().describe("the intake YAML, fenced or not") },
}, async ({ profile, document }) => run(() => {
  const f = load(profile);
  const r = tools.applyIntake(f.profile, document);
  if (r.problems.length) return r;
  if (r.edits.length) write(f.id, r.edits);
  return { applied: r.applied, followUps: r.followUps, warnings: r.warnings };
}));

const transport = new StdioServerTransport();
await server.connect(transport);
