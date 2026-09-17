# Taxonomy

Personal US tax-planning tool for understanding, not filing. Bun + React + a pure TypeScript
engine. Read `docs/ARCHITECTURE.md` first; `docs/DATA-MODEL.md`, `docs/INTAKE.md` and
`docs/LLM-INTERFACE.md` cover the file format, the document intake and the MCP interface.

## Commands

```sh
bun run dev          # app on http://127.0.0.1:5180 (restart: pkill -f packages/app/server.ts; bun run dev)
bun test packages/engine
bun run typecheck    # engine, app and mcp packages
bun run mcp          # the MCP server over stdio (what Claude Desktop runs)
```

No Vite, no bundler config: Bun serves `packages/app/index.html` directly.

## Rules

- `data/profiles/*.yaml` is the user's real financial data. It is gitignored and must never be
  committed, printed into a commit, or edited unless the user asks; keep a backup in the job's
  tmp directory when they do. Tests and headless-browser checks run their own server against a
  throwaway directory, never the user's data: `PORT=5199 TAXONOMY_DATA=/path/to/tmp bun packages/app/server.ts`
  (the MCP server honours `TAXONOMY_DATA` too). The user's own app on :5180 must not see test
  profiles; never create or delete files in `data/profiles` from a test.
- Never print credentials or tokens. There are no model API keys in this project; the LLM
  interface is the user's own agent over MCP.
- Commits are ssh-signed. If the signing agent refuses, retry later; never bypass signing.
- The engine does all tax math. The app and the MCP server never compute tax; they call the
  engine and show or relay its lines, each of which carries its own `why`.
- What an agent writes (scenarios, facts, intake documents) applies at once, and every save by
  either server is logged to `data/history/<id>.jsonl` with the text before it; History in the
  app restores any entry. Do not add a write path that skips the history log.

## Where things go

- New tax logic: `packages/engine/src/*.ts` with a test in `packages/engine/test/`. Every ledger
  line gets a plain-English `why` and its `deps`.
- New agent ability: a pure function in `packages/engine/src/tools.ts` (tested in
  `test/tools.test.ts`), then one `registerTool` in `packages/mcp/server.ts`.
- New scalar fact: one entry in `packages/engine/src/fields.ts`; the intake prompt, review table,
  timeline picker and `update_facts` read the registry.
- UI state that should survive a refresh: `usePersisted` (per profile) or the URL hash for dialogs.

## Style

- Comments and commit messages are for future readers: short, plain, high-level. Prefer fewer
  comments than the surrounding file. No narration of the work done.
- Copy in the UI is short and says what to do. Numbers stay out of prose where a table fits.
  Explanations of how a card works go behind the ⓘ affordance (`components/Info.tsx`), not
  under the title.
- Text sizes come from the type scale at the top of `styles.css` (`--text-xs` … `--number-hero`).
  Never write a pixel font size in a rule; pick a token, and change the scale to change the app.
- Check the UI in headless Chrome (a CDP script against a throwaway profile, screenshots read
  back) before calling visual work done; test dark mode too.
