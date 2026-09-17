# Taxonomy

A personal tax planning tool for understanding, not filing. Move a lever, watch six years of
federal and state tax respond, and click any number to see why it is what it is.

```sh
bun install
bun run dev            # http://127.0.0.1:5180 — first run asks for the basics and writes data/profiles/<name>.yaml
bun run test           # engine tests
bun run plan           # print the plan for data/profile.yaml in the terminal
```

Profiles are plain YAML files in `data/profiles/`, one per person or household. Switch, rename,
duplicate and delete them from the top bar, or edit the files by hand; the app follows.
Money fields accept `620k` and `1.2m`.

Equity grants come in three types, each taxed the way the code treats it: ISO exercises feed AMT,
NSO (NQSO) exercises are ordinary income, RSUs are ordinary income when they vest. Grants take a
vesting schedule (start date, years, cliff, cadence) or explicit per-year counts.

## Filling the profile from documents

The **Fill from documents** button opens a two-step modal. A toggle picks the mode. **With Claude
Desktop** (recommended): say "Update my Taxonomy profile from my documents" and it fetches the
request itself, reads the documents, and sends the numbers back into the app. **Copy a request**
is the same request as text: copy it into any agent that can see your documents
(Claude with connectors, a CLI agent pointed at a folder of PDFs, ChatGPT with uploads) and
paste back the YAML it returns. Either way the app validates it, shows every proposed change
beside the current value with the source the agent cited, and writes only the rows you accept. Sources stay with each number and
show as chips in the sidebar. If the intake includes last year's return, a calibration card
shows how closely the engine reproduces it.

The overall design is in `docs/ARCHITECTURE.md`. The document format is in `docs/INTAKE.md`; the parser, prompt and mapping live in
`packages/engine/src/intake/` and are tested against a fixture.

## Connect your agent

Taxonomy is also an MCP server, so the Claude you already use can read the plan, explain any
number with the engine's reason, try what-ifs and propose scenarios. Setup is a checklist with
one button per step: **Add to Claude Desktop** writes the entry into `claude_desktop_config.json`
(only the `taxonomy` key, with a backup of the file), **Open Claude Desktop** brings it up, and
the sentence to say is there to copy. It appears on the new-profile screen, in "Fill from
documents", and behind the Claude button in the top bar, which shows who is connected and when,
and opens a panel of things to say that fit where the profile is. A picker there covers the
three clients: **Claude Desktop** (one button), **Claude Code** (the repository's `.mcp.json`
registers it; or `claude mcp add taxonomy -- bun packages/mcp/server.ts`), and **claude.ai**,
which needs the server reachable from the internet: the app starts the HTTP server
(`bun run mcp:http`, localhost only, behind a secret path), you run `ngrok http 5182` (free
account; a fixed domain keeps the address stable) and paste the address it prints, and the app
shows the full address to add as a custom connector in claude.ai settings. Cloudflare's quick
tunnel or Tailscale Funnel work the same way. Only the exact secret address answers, and your
laptop must be on. A hosted deployment would report its own address and skip the tunnel step. Proposals arrive as new scenarios and
show up as a banner with their effect on total tax and cash: Accept, Compare against the current
plan, or Discard. The agent never does tax math. Facts and assumptions it hears ("assume 20% growth", "salary
goes to 400k in 2028") and documents it reads are written at once with their sources; the
Claude button in the top bar shows what came in, and History can undo any of it.
`create_profile` lets it start a profile from scratch. Ten tools in all, so claude.ai's
per-tool approvals stay few. The dialogs show whether an agent has
called in and when. The design is in `docs/LLM-INTERFACE.md`.

## What the intake leaves open

Two kinds of item come out of an intake. Facts nobody supplied (a birth year, a mortgage rate,
the AMT credit a return implies) are asked on the main screen under "A few things to fill in"
and close themselves once a sourced value arrives. Judgment calls the agent made are notes, for
reading rather than approving: each shows as ⓘ beside the value it concerns and in "Edit my
information" → "Notes from Claude", grouped by section with the value alongside. Probable gaps
versus last year are the app's own comparison, and sit under "Last return" with a one-click
fill or "Not needed" on each. Nothing on the main screen asks for a tick.

## Demo mode

"Demo mode" at the bottom of the sidebar (or `?demo=1` in the address) shows every amount in a
made-up currency at a fixed scale, for screenshots and screen shares. Charts, the ledger, reasons
and the Ask text all follow; money inputs become read-only. The file is untouched.

## History

Every save is recorded: when, who (you, or the Claude client that called in) and what changed
in plain words ("Your base salary: $320,000 → $400,000", "Claude sent a document (pay) for
review", "Scenario 'sell half' created"). **History** in the top bar lists
them newest first, and any entry can restore the file to the way it was just before that
change; the restore is recorded too. The log lives in `data/history/<id>.jsonl` (gitignored),
one line per save with the previous text alongside.

**Documents.** The Last return tab keeps the pages a profile's numbers came from
(`data/attachments/<id>/`, gitignored). Add them there or let Claude attach them; a value whose
source names a stored file links to it.

## Profile schema (version 3)

Facts, choices and dates are separate things. `people`, `income`, `carryforwards`, `returns`,
`equity` (companies with a share price and optional price path; grants by the portal's three
counts; holdings with cost and AMT basis), `home` and `deductions` are facts for the first plan
year. `timeline` holds dated changes to any of them. `scenarios` holds named lists of decisions (events
on the plan's timeline: exercises, sales and liquidity events) and `activeScenario`
picks one; "Save as…" in the scenario menu in the top bar snapshots the current decisions. `sources`
records provenance by path, with grants, holdings and companies keyed by id. Older files are
migrated on first read. The full description is in `docs/DATA-MODEL.md`; every scalar field is
declared once in `packages/engine/src/fields.ts`, which drives the intake prompt, the review
table, the assistant and the timeline picker.

## Creating a profile

"New profile" in the top bar is a two-step wizard: name it, then connect Claude. The file is
created when you leave step 1 so Claude has something to connect to, and removed again if you
go back. Say "Connect to my Taxonomy profile "Me"" and every step turns green the moment Claude
calls in; "Open my plan" takes you in. From there Claude fills the profile in with you, a
document or a question at a time, and everything it sends waits for your review. "Paste a reply" is the fallback for people
without a connector, with the review table right in the wizard. Either way the profile is a file
you can keep editing from "Edit my information" or in a text editor.
