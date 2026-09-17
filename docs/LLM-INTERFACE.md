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

Typed inputs and outputs, JSON in and out, every mutation validated by `parseProfile`. Grouped
by what the model needs to do.

**Orient**
- `list_profiles()` → ids, names, and which one the app is showing. Every other tool takes
  `profile` as an id or a name (prefix is enough); without it the only profile, or the one open
  in the app (the app tells the server on every switch), is used, and every result names the
  profile it is about so the agent can say so when there are several. `get_context(profile)` → the compact facts the intake
  already builds (`knownFacts`), the plan years, the companies with ISO grants, the scenarios and
  which is active, and the vocabulary (event kinds and their fields).
- `get_plan(profile, scenario?)` → per year: the ledger's headline lines (AGI, regular tax, AMT,
  credit used and on hand, state tax, total, cash in, exercise cost, net cash) plus the events.

**Explain**
- `explain(profile, year, lineId)` → the line, its `why`, and its `deps` one level down with their
  values, so the model can walk the chain when asked "why".
- `compare_years(profile, a, b)` → the lines that differ most between two years, sorted by
  absolute change. This is the answer to "why is 2027 so high".
- `amt_headroom(profile, year, company?)` → `amtCrossover` and the sweep's reading sentence.
- `credit_recovery(profile, year, company?)`, `hold_or_sell(profile, year, company?)`,
  `lots(profile, year)` with each lot's status on a date, `sell_to_cover(profile, year)`.

**Try**
- `what_if(profile, events[])` → runs the active scenario plus or minus the given events
  without writing anything, returns the per-year headline lines and the deltas against the
  active scenario. "Half of them" resolves here: the tool takes shares, and `get_plan` told the
  model how many there are.
- `propose_scenario(profile, name, events[], basedOn?)` → writes a new scenario to the file (the
  only write), returns the deltas, and leaves `activeScenario` alone. The app shows the proposal.
- `set_active_scenario(profile, name)`, `delete_scenario(profile, name)`.

**Intake**
- `create_profile(name)` → a new profile from the example, for an agent starting from scratch.
- `intake_request(profile, sections)` → the same request the app hands an agent, for an agent
  that is already connected and can see the documents.
- `submit_intake(profile, document, sections?)` → checks the intake YAML for shape and appends
  it to the profile's `pendingIntake` list. Each document gets its own card in the app ("Claude
  sent pay"); Review opens the same review table as a pasted reply, pre-filled, and only
  accepted rows are written. Several submissions are expected: intake is a conversation, one
  section at a time, not one sweep. The copy-and-paste path is the fallback.
- `get_context` carries an `outstanding` section (unanswered follow-ups, empty essentials,
  documents and changes awaiting review) so the agent can ask for the simple things in chat and
  route them through `update_facts`. Its `gaps` list is the one place for "what the plan cannot
  model as entered": figures last year's return had, grants with unvested shares and no
  schedule, option lots exercised inside the plan window. Each says whether the app closes it
  in one click (the "Probably missing" list under Last return).
- `get_plan` reports whole dollars (rates keep four decimals), adds `effectiveRateWithSpread`
  (total tax over AGI plus the ISO bargain element, the fairer rate in an exercise year), and
  carries the reasons for the AMT, credit-used and credit-carried lines in `why`, so the usual
  "why is the credit only $16k" needs no second call. Events with zero shares are refused.

**The handshake.** The new-profile wizard ends when Claude connects: the user says "Connect to
my Taxonomy profile "Me"", the agent calls `get_context` on it, and the heartbeat (which now
records the profile each call was about) lets the wizard see a call about its draft since it
started. Every step shows green and an "Open my plan" button takes the user in; filling in
happens from there. A call about a different
profile is shown as such and does not complete the step.
- The server touches `data/.agent` on every call (with the client's name) so the app can say
  "Connected · Claude Desktop · 3 minutes ago" in the intake and connect dialogs.
- Setup is one click per step: `POST /api/agent/desktop` merges the `taxonomy` entry into Claude
  Desktop's config (backup kept, other entries untouched, invalid JSON refused), and
  `POST /api/agent/open` brings Claude Desktop to the front. For claude.ai, `POST /api/agent/remote`
  starts or stops the local HTTP server; the app never runs the tunnel itself, it shows the
  `tailscale funnel --bg <port>` command, reads Funnel's status, and composes the connector URL;
  any other tunnel's address can be pasted instead (Funnel needs the tailnet's policy to grant
  the `funnel` node attribute, which not every user can change; ngrok's free fixed domain is the
  stable alternative). This is the route claude.ai's own team points at: connectors dial out from
  Anthropic's servers, localhost URLs are refused at setup, and a server on the connector path
  must either use claude.ai's OAuth flow or need no auth, which the secret path satisfies.
  All same-origin only. The
  new-profile screen, "Fill from documents" and the "Connect your agent" tab share the checklist;
  the intake dialogs toggle between "With Claude Desktop" and "Copy a request".

**Facts and assumptions from a sentence**
- `update_facts(profile, changes[])` → each change names a registry field (path or label, with
  `company` for per-company fields and `from` for a change that starts in a later year), is
  coerced to the field's type, and is written to `pending` in the file. The app shows the rows
  with before and after values and the combined effect; nothing counts until accepted, row by row
  or all at once. Accepting records the source ("your agent", the date, what the user said);
  a dated change becomes a timeline entry. `pending_changes` and `withdraw_changes` round it out.

Deliberately absent: writing facts directly from free-form chat. A model that misheard "620" as "62"
should not be able to change a salary from a sentence; it has to produce the structured, sourced
intake document, and the review is what gets written.

## The agent's instructions

Shipped with the server as its tool descriptions and a short system note, so any client gets
them:

- Never state a tax number you did not get from a tool. Quote the line's reason when asked why.
- Every scenario change is a proposal: call `what_if` to show the effect, then
  `propose_scenario` with a name that reads like the request ("sell half in 2029").
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
| A proposal silently replaces the user's plan | Proposals are new scenarios; the active one changes only through Accept. |
| Two writers on the file | The write precondition (mtime, 409) already exists; the MCP server uses the same path. |
| Ambiguous language | Tools return the facts the model needs to resolve it (holdings, vested counts, years), and the instructions say ask when unsure. |
| The chat window is far from the chart | Phase 2's banner and diff live in the app; phase 3 exists if that is still not enough. |

## Testing

The tool layer is pure TypeScript over the engine and is unit-tested like the engine: each tool
against the example profile, with `what_if` and `propose_scenario` checked for exact event
output and file safety. A small set of scripted conversations (utterance, expected tool calls,
expected proposal) can be run by hand against a live client and kept as documentation of what
the interface is supposed to understand.

## Status (2026-09-15)

Phases 1 and 2 are built: `packages/engine/src/tools.ts` with tests, `packages/mcp/server.ts`
over stdio (16 tools including the two intake tools), the repository `.mcp.json` for Claude
Code, a "Connect your agent" tab in the information dialog with the Claude Desktop config
generated by `GET /api/agent` (absolute `bun` path so Desktop finds it), the proposal banner
(Accept, Compare, Discard, or hide for later), the scenario note in the top bar, and
`update_facts` with its review card for facts and assumptions stated in conversation. Phase 3 is
still a decision to make after using this for a while.
