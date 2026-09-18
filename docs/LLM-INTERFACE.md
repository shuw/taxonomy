# Talking to Taxonomy

Goal: say a scenario instead of building it chip by chip, and ask questions about the tax
picture and get answers grounded in the engine's numbers, not the model's guesses.

Examples of what this should handle:

- "Exercise 2,000 ISOs next year and sell half of them the year after."
- "What's the most I can exercise in 2027 without AMT?"
- "Why is 2027 so much higher than 2026?"
- "If we IPO in 2028 at $900, what does selling everything in 2029 look like?"
- "Compare that to selling only enough to cover the tax."
- "How long until the 2027 credit comes back?"

## The shape that fits this codebase

Three things already decided elsewhere shape the design:

1. **The file is the interface.** The app follows `data/profiles/<id>.yaml` with a poll and a
   write precondition, and every decision is an event in a scenario. Anything that writes valid
   events to the file shows up in the app within two seconds.
2. **Agent-agnostic, no keys in the app.** Intake works by generating a request the user hands to
   their own agent. There are no model credentials on this machine and the user has said the
   future is what they can play with in the tool, not a second assistant inside it.
3. **Every number carries its reason.** The ledger's `why` strings and `deps` chains already
   exist. A language model that can read them can explain the tax honestly; one that cannot will
   make things up.

So the model should not compute anything and should not write YAML. It should call **tools**
that the engine already implements, and its only way to change the plan should be to
**propose a scenario** that the app then shows as a diff.

## Architecture

```
 user ──talks──▶ their agent (Claude Code / Claude Desktop / claude.ai)
                       │  MCP (stdio or local HTTP)
                       ▼
             packages/mcp  ── tool layer ──▶ packages/engine (pure)
                       │                        data/profiles/*.yaml (read; scenario writes only)
                       ▼
             the app notices the file change and shows "Proposed by your agent" with a diff
```

One tool layer, two possible fronts:

- **Phase 1: MCP server.** The user talks in the Claude they already use. Claude Code and Claude
  Desktop speak MCP over stdio (`packages/mcp/server.ts`); claude.ai reaches the same tools over
  HTTP (`packages/mcp/http.ts`, localhost only, behind a secret path) through a Tailscale Funnel
  the user starts with one command, added in claude.ai as a custom connector. No keys, no new
  UI surface, and the conversation can also drive intake ("read my new pay stub and update the
  salary").
- **Phase 3 (optional): in-app chat** over the same tools with a bring-your-own key, plus
  dictation through the browser's speech API. Only worth it if talking outside the app proves
  too disconnected in practice.

Phase 2 sits between: the app grows the small pieces that make proposals from an agent feel
native.

## The tools as claude.ai sees them

Ten tools, so the permission prompts stay few. Six only read; four write. Writes apply at once:
a fact is set with its source, a document's values are written with theirs, a scenario is added
and made active. Every save is logged in the app's history with the text before it, and the
Claude button in the top bar shows what came in since the user last looked, so the review step
of the first design is gone; undo from History is the safety net.

| Tool | Does |
|---|---|
| `list_profiles`, `create_profile` | which profile, or a new one |
| `get_context` | facts, holdings, scenarios, outstanding items, pending changes, editable fields, vocabulary |
| `get_plan`, `explain` | the years' headline lines; one line's reason and inputs |
| `analyze` | `kind`: compare_years, amt_headroom, credit_recovery, hold_or_sell, lots, sell_to_cover |
| `what_if` | try decisions without saving (exercise, sell, liquidity, give) |
| `scenario` | `action`: add, activate, delete |
| `facts` | set facts and assumptions the user states; `from` dates a change, `until` bounds it (a one-year gift has `until` = `from`) |
| `intake` | `action`: request, submit, attach (a page image, PDF or text file, kept beside the profile and linked from the values that cite it) |

The engine functions below keep their own names; the table is the packaging.

## The tool layer

Typed inputs and outputs, JSON in and out, every mutation validated by `parseProfile` and
logged to the profile's history. Ten tools; four take a `kind` or `action` so the set stays
small without losing anything.

**Orient**
- `list_profiles()` → ids, names, and which one the app is showing. Every other tool takes
  `profile` as an id or a name (a prefix is enough); without it the only profile, or the one
  open in the app (the app tells the server on every switch), is used, and every result names
  the profile it is about so the agent can say so when there are several.
- `create_profile(name)` → a new profile from the example, for an agent starting from scratch;
  names are unique.
- `get_context(profile)` → the compact facts, holdings, the plan years, the companies with ISO
  grants, the scenarios and which is active, the editable fields with current values, the
  vocabulary (event kinds and their fields), and `outstanding`: unanswered follow-ups, empty
  essentials, and `gaps`, the one list of what the plan cannot model as entered (figures last
  year's return had, grants with unvested shares and no schedule, option lots exercised inside
  the plan window), each saying whether the app closes it in one click.
- `get_plan(profile, scenario?)` → per year: the headline lines in whole dollars (rates keep
  four decimals), `effectiveRateWithSpread` (total tax over AGI plus the ISO bargain element),
  the reasons for the AMT, credit-used and credit-carried lines in `why`, and the year's events.

**Explain**
- `explain(profile, year, lineId)` → the line, its `why`, and its `deps` one level down with
  their values, so the model can walk the chain when asked "why".
- `analyze(profile, kind, ...)` with `kind` one of `compare_years` (the lines that differ most
  between two years), `amt_headroom` (the crossover and the sweep's reading), `credit_recovery`,
  `hold_or_sell`, `lots` (what is held and when each lot turns long-term or qualifying),
  `sell_to_cover`.

**Try and decide**
- `what_if(profile, events[])` → the active scenario plus the given events, run without saving:
  the years, the totals, the delta per year against the base, and `warnings` when an event asked
  for more shares than were vested or held (it runs with what there is) or named an event id that
  does not exist. Events are exercise, sell,
  liquidity and give; zero-share and zero-amount events are refused.
- `scenario(profile, action, ...)` with `action` `add` (writes the scenario and makes it active),
  `activate`, or `delete`.

**Facts and documents**
- `facts(profile, changes[])` → each change names a registry field (path or label, with
  `company` for per-company fields), a value in the field's type, an optional `from` year for a
  dated change and `until` for one that ends. The change is checked against the registry,
  coerced, and written at once with its source; a one-year gift is a `give` event, not a fact.
- `intake(profile, action, ...)` with `action` `request` (the same request the app hands an
  agent, for the sections asked), `submit` (the intake YAML: checked for shape, every value
  written at once with its source, questions kept as follow-ups, the change in the plan returned as `delta`),
  or `attach` (a page image, PDF or text file kept beside the profile and linked from the
  values that cite it).

**Every result carries `changedAt`**, the profile file's last save, read after any write the call made; when it moves between two calls, the app changed the profile and the agent should read it again.

**Writes apply at once.** Nothing waits for review. Both servers log every save with the text
before it, the app's Claude button counts what arrived, and History restores any entry. The
app's own paste-a-reply intake still uses a review table, because there the user is the one
transcribing.

**The handshake.** The new-profile wizard ends when Claude connects: the user says "Connect to
my Taxonomy profile "Me"", the agent calls `get_context` on it, and the heartbeat (which
records which profile each call was about) tells the wizard. Intake is then iterative through
`intake(submit)` and `facts`, one section at a time.

## The agent's instructions

Shipped with the server as its tool descriptions and a short system note, so any client gets
them:

- Never state a tax number you did not get from a tool. Quote the line's reason when asked why.
- Every scenario change is a proposal: call `what_if` to show the effect, then
  `scenario(add)` with a name that reads like the request ("sell half in 2029").
- Units and vocabulary: shares are counts, prices are per share, years are calendar years,
  "next year" is relative to the plan's first year unless the user names one. ISO, NSO, RSU,
  double-trigger, qualifying disposition, AMT credit: use the tool's words.
- When a request is ambiguous ("sell some"), ask one question rather than guessing.

## What the app adds (phase 2)

- A **proposal banner** when a scenario the app did not create appears in the file: name, the
  events, the delta in total tax and net cash against the active scenario, and Accept (make it
  active), Compare (pin the current one and switch) or Discard (delete it). The file poll already
  detects the change; the banner is a few dozen lines on top of the scenario bar.
- **Scenario origin**: scenarios carry an optional `note` ("proposed by agent, 2026-09-15"),
  shown in the scenario picker.
- ~~An "Ask" affordance on the plan card that copies a grounded question to the clipboard.~~
  Built, then dropped on 2026-09-16 once the connector path was in place: with MCP there is no
  chat that needs the numbers pasted in.

## Phase 3, only if wanted: in-app chat

- A panel beside the ledger, streaming, with proposals rendered as the same diff cards the
  banner uses and a "make it so" button.
- Bring-your-own key through the server's environment; the model calls the same tool layer
  in-process. No transcripts are stored in the profile file.
- Dictation with the browser's speech recognition into the same box; a microphone button, not a
  separate mode.

## Risks and how the design meets them

| Risk | Answer |
|---|---|
| The model invents a number | It has no numbers except tool results; the instructions forbid stating others, and the app never trusts the model, only the file. |
| The model writes something invalid | Tools take structured arguments; the server validates with `parseProfile` before writing and returns the error. |
| A write replaces the user's plan | Every write is logged with the text before it; the app shows what arrived and History restores any entry. Scenarios are named, so the previous one is still there. |
| Two writers on the file | The write precondition (mtime, 409) already exists; the MCP server uses the same path. |
| Ambiguous language | Tools return the facts the model needs to resolve it (holdings, vested counts, years), and the instructions say ask when unsure. |
| The chat window is far from the chart | Phase 2's banner and diff live in the app; phase 3 exists if that is still not enough. |
| Several people on one hosted server | Each account has its own store and its own connector secret; the HTTP server picks the store by the secret and never by anything the client can name. The secret sits in the URL because claude.ai's dialog only takes a URL, so proxy access logs must stay private; clients that can send headers use `Authorization: Bearer` on `/mcp`. |

## Testing

The tool layer is pure TypeScript over the engine and is unit-tested like the engine: each tool
against the example profile, with `what_if` and `scenario(add)` checked for exact event
output and file safety. A small set of scripted conversations (utterance, expected tool calls,
expected proposal) can be run by hand against a live client and kept as documentation of what
the interface is supposed to understand.

## Status (2026-09-17)

Built: `packages/engine/src/tools.ts` with tests; `packages/mcp/taxonomy.ts` (the ten tools),
`server.ts` over stdio for Claude Desktop and Claude Code (the repository `.mcp.json`), and
`http.ts` for claude.ai behind a secret path, exposed through a tunnel the user runs; the
new-profile wizard with the handshake; the Claude panel in the top bar; History with restore;
attachments. Writes apply at once with History as the undo. Phase 3, chat inside the app, is
still a decision to make after using this for a while.
