# Taxonomy

A personal tax planning tool for understanding, not filing. Move a lever, watch six years of
federal and state tax respond, and click any number to see why it is what it is.

```sh
bun install
bun run dev            # http://127.0.0.1:5180 — first run asks for the basics and writes data/profiles/<name>.yaml
bun run test           # engine tests
bun run plan           # print the plan for data/profile.yaml in the terminal
```

Profiles are plain YAML files in `data/profiles/`, one per person or what-if. Switch, rename,
duplicate and delete them from the top bar, or edit the files by hand; the app follows.
Money fields accept `620k` and `1.2m`.

Equity grants come in three types, each taxed the way the code treats it: ISO exercises feed AMT,
NSO (NQSO) exercises are ordinary income, RSUs are ordinary income when they vest. Grants take a
vesting schedule (start date, years, cliff, cadence) or explicit per-year counts.

## Assistant

The Assistant button opens a panel where you paste screenshots from Carta, Shareworks, E*Trade
or a pay stub, or just describe your grants. It proposes profile changes as a card; nothing is
written until you click Apply. It calls the Anthropic API from the local dev server, so the
machine running `bun run dev` needs credentials: either `export ANTHROPIC_API_KEY=...` before
starting, or sign in with `ant auth login`. Screenshots go to the API and nowhere else. Set
`TAXONOMY_MODEL` to use a different model (default `claude-opus-5`).

See `docs/PROPOSAL.md` for the approach and what is deliberately simplified.
