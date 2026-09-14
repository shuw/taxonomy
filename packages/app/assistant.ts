import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.TAXONOMY_MODEL ?? "claude-opus-5";
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** What the model may propose. The user sees it as a card and applies or discards it. */
export const PROPOSAL_TOOL: Anthropic.Tool = {
  name: "propose_profile_update",
  description:
    "Propose changes to the user's Taxonomy profile. Nothing is written until the user clicks Apply, so use this freely whenever you have extracted concrete numbers. Use `set` for scalar fields, `addGrants` for equity grants read from screenshots or text, `removeGrants` to drop grants by name, `sharePrice` for the company's current per-share value. Never invent numbers; ask when something needed is missing.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One or two sentences telling the user what this changes and anything you assumed." },
      set: {
        type: "array",
        description: "Scalar fields to set, as dot paths: filer.filingStatus, filer.state, plan.startYear, plan.years, income.wages, income.otherOrdinary, income.interest, income.qualifiedDividends, income.longTermGains, income.shortTermGains, deductions.mortgageInterest, deductions.propertyTax, deductions.stateIncomeTax, deductions.charitable, assumptions.fmvGrowth, assumptions.wageGrowth, assumptions.inflation, equity.amtCreditCarryforward, name.",
        items: {
          type: "object",
          properties: { path: { type: "string" }, value: { type: ["number", "string", "boolean"] } },
          required: ["path", "value"],
          additionalProperties: false,
        },
      },
      addGrants: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Short label, e.g. '2023 ISO grant' or 'RSU refresh Mar 2025'." },
            type: { type: "string", enum: ["iso", "nso", "rsu"], description: "NQSO and NSO both mean nso." },
            shares: { type: "number", description: "Total shares or units in the grant." },
            strike: { type: ["number", "null"], description: "Exercise price per share for options; null for RSUs." },
            vested: { type: ["number", "null"], description: "Shares already vested (and, for options, still unexercised) as of the plan start year. Null to derive from the schedule." },
            schedule: {
              type: ["object", "null"],
              description: "Vesting schedule when known.",
              properties: {
                start: { type: "string", description: "Vesting commencement date, YYYY-MM-DD." },
                years: { type: "number" },
                cliffMonths: { type: "number", description: "0 when there is no cliff." },
                cadence: { type: "string", enum: ["monthly", "quarterly", "annual"] },
              },
              required: ["start", "years", "cliffMonths", "cadence"],
              additionalProperties: false,
            },
            vesting: {
              type: "array",
              description: "Explicit shares vesting per calendar year, when the schedule is irregular or only dates are shown. Empty when using `schedule`.",
              items: { type: "object", properties: { year: { type: "integer" }, shares: { type: "number" } }, required: ["year", "shares"], additionalProperties: false },
            },
          },
          required: ["name", "type", "shares", "strike", "vested", "schedule", "vesting"],
          additionalProperties: false,
        },
      },
      removeGrants: { type: "array", items: { type: "string" }, description: "Names of existing grants to remove (for example when replacing them with corrected ones)." },
      sharePrice: { type: ["number", "null"], description: "Company share value per share now (409A or market), or null to leave unchanged." },
    },
    required: ["summary", "set", "addGrants", "removeGrants", "sharePrice"],
    additionalProperties: false,
  },
};

function systemPrompt(profileText: string): Anthropic.TextBlockParam[] {
  return [
    {
      type: "text",
      text: `You are the intake assistant inside Taxonomy, a personal US tax-planning tool. The user pastes screenshots or text from equity portals (Carta, Shareworks, E*Trade, Schwab, Fidelity, Morgan Stanley), offer letters, pay stubs, or just describes their situation, and you turn it into structured profile changes.

How the profile works:
- One YAML file per profile. Money is annual dollars for plan.startYear. filer.filingStatus is one of single, mfj, mfs, hoh. filer.state is a two-letter code.
- equity.sharePrice is the company's current per-share value; it grows by assumptions.fmvGrowth each year.
- equity.grants is a list of grants with type iso, nso (NQSO/NSO are the same thing), or rsu. Options carry a strike. Vesting is either a schedule (start date, years, cliff months, cadence) or explicit per-year counts. \`vested\` is what has already vested by the plan's first day (for options: vested and unexercised).
- Tax treatment the tool models: ISO exercises create an AMT preference (spread) but no regular income; NSO exercises create ordinary wage income equal to the spread; RSUs create ordinary wage income when they vest. Sales are not modeled yet.
- The user controls exercises with sliders, so do not set exercise counts; just describe grants accurately.

Working style:
- Read every number you can from what the user gives you and call propose_profile_update with them. Prefer one proposal covering everything you learned in the message. Put anything you assumed or could not read into the summary.
- Grant dates matter: if a screenshot shows a grant date, vesting start, or a schedule like "1/48 monthly after a 1-year cliff", encode it as a schedule. If it shows only vested/unvested counts, set \`vested\` and put the unvested remainder on a schedule only if the cadence is shown; otherwise list per-year vesting if dates are visible, or ask.
- Exercised shares are gone: for options, \`shares\` should be the unexercised total (vested unexercised + unvested), not the original grant size, unless the user says otherwise.
- Strike and share value are per share. If the portal shows a total value, divide.
- If nothing actionable is present, answer in plain prose and ask one focused question. Keep replies short; the user is looking at a sidebar.
- Never write to the profile yourself; the tool only proposes.`,
      cache_control: { type: "ephemeral" },
    },
    { type: "text", text: `Current profile file:\n\n${profileText}` },
  ];
}

export interface AssistantReply {
  content: Anthropic.ContentBlock[];
  stopReason: string | null;
}

function validateMessages(messages: unknown): Anthropic.MessageParam[] {
  if (!Array.isArray(messages) || messages.length === 0) throw new Error("messages must be a non-empty array");
  let images = 0;
  for (const m of messages as Anthropic.MessageParam[]) {
    if (m.role !== "user" && m.role !== "assistant") throw new Error("bad role");
    if (typeof m.content === "string") continue;
    if (!Array.isArray(m.content)) throw new Error("bad content");
    for (const block of m.content) {
      if (m.role === "user") {
        if (block.type === "image") {
          if (block.source.type !== "base64" || !IMAGE_TYPES.has(block.source.media_type)) throw new Error("unsupported image");
          if (block.source.data.length > MAX_IMAGE_BYTES * 1.4) throw new Error("image too large (5 MB max)");
          if (++images > MAX_IMAGES) throw new Error(`at most ${MAX_IMAGES} images per conversation`);
        } else if (block.type !== "text" && block.type !== "tool_result") throw new Error(`unsupported user block ${block.type}`);
      }
    }
  }
  return messages as Anthropic.MessageParam[];
}

let client: Anthropic | null = null;

export async function runAssistant(profileText: string, rawMessages: unknown): Promise<AssistantReply> {
  const messages = validateMessages(rawMessages);
  client ??= new Anthropic();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: systemPrompt(profileText),
    tools: [PROPOSAL_TOOL],
    messages,
  });
  return { content: response.content as Anthropic.ContentBlock[], stopReason: response.stop_reason };
}

/** A user-facing explanation for failures, without leaking anything sensitive. */
export function describeAssistantError(e: unknown): { status: number; message: string } {
  if (e instanceof Anthropic.AuthenticationError || (e instanceof Error && /authentication method|api key|x-api-key/i.test(e.message))) {
    return {
      status: 401,
      message:
        "The assistant needs Anthropic credentials on the machine running the dev server. Either export ANTHROPIC_API_KEY before `bun run dev`, or sign in with `ant auth login` and start the server from a shell where that profile is active. The key never leaves your machine.",
    };
  }
  if (e instanceof Anthropic.RateLimitError) return { status: 429, message: "Rate limited by the API; try again in a moment." };
  if (e instanceof Anthropic.APIError) return { status: 502, message: `API error ${e.status}: ${e.message}` };
  return { status: 400, message: e instanceof Error ? e.message : String(e) };
}
