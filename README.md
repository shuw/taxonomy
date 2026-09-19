# Taxonomy

A personal tax planning tool for understanding, not filing. Move a lever, watch six years of
federal and state tax respond, and click any number to see why it is what it is.

Try it without installing anything: <https://taxonomy.fly.dev/demo>.

## Run it

Needs [Bun](https://bun.sh) 1.2 or later; nothing else.

1. `bun install`
2. `bun run dev`, then open <http://127.0.0.1:5180> and make an account (it stays on your machine).
   `bun run dev:solo` runs without accounts, one set of profiles for whoever opens the page.
3. Name a profile and connect Claude, or skip and fill the sidebar in by hand.

```sh
bun run test           # engine and app tests
bun run plan           # print the plan for data/profile.yaml in the terminal
```

Profiles are YAML files in `data/profiles/`, one per person or household. Switch, rename,
duplicate and delete them from the top bar, or edit the files by hand; the app follows.
Money fields accept `620k` and `1.2m`.

Equity grants come in three types, taxed the way the code treats them: ISO exercises feed AMT,
NSO exercises are ordinary income, RSUs are ordinary income when they vest. A grant takes a
vesting schedule (start, years, cliff, cadence) or explicit per-year counts.

## Connect Claude

Taxonomy is also an MCP server, so the Claude you already use can read the plan, explain any
number with the engine's reason, try what-ifs, propose scenarios and fill the profile in from
documents. The checklist lives on the new-profile screen and behind the Claude button in the
top bar. Pick a client:

- **claude.ai.** Open the custom-connector dialog, paste the name and the address the app shows,
  pick "No sign in" for authentication. Locally the app starts the HTTP server for you and needs
  a tunnel (`ngrok http 5182`; paste the address it prints). Hosted, the address is ready.
- **Claude Code.** In this folder the repository's `.mcp.json` registers the server. Hosted, run
  the `claude mcp add --transport http` line the app shows.
- **Claude Desktop** (local only). One button writes the `taxonomy` entry into its config, with a
  backup of the file; restart Claude Desktop once.

The address contains a secret: anyone who has it can read and change your profiles. Then say
the sentence the app shows, "Connect to my Taxonomy profile "Me"", and every step turns green
when Claude calls in.

What Claude sends:

- **Proposals** arrive as scenarios in a banner with their effect on tax and cash: Accept,
  Compare or Discard.
- **Facts and documents** are written at once with their sources. The Claude button shows what
  came in; History can undo any of it.
- **Open questions** it could not answer sit on the main screen under "A few things to fill in"
  and close once a value arrives. Its judgment calls show as ⓘ beside the value.

The agent never does tax math; the engine does. Ten tools in all, so claude.ai's per-tool
approvals stay few. Design notes are in `docs/LLM-INTERFACE.md` and `docs/INTAKE.md`.

Without a connector, **Paste a reply** gives you the same request as text for any agent that can
see your documents; paste back the YAML it returns and review each change before it is written.

## History and documents

Every save is logged with when, who (you, or the Claude client that called in) and what changed
in plain words. **History** in the top bar lists them and can restore the file to just before
any entry. The log is `data/history/<id>.jsonl`; the pages a profile's numbers came from live in
`data/attachments/<id>/`, linked from each sourced value.

## The demo

`/demo` opens the app as Ada, a made-up engineer at a made-up startup with ISOs, NSOs and RSUs,
a raise next year, gifts and an exercise that trips AMT (`data/demo.yaml`). Hosted, each
visitor gets a throwaway account that lasts a day; locally the profile is added to your list.

"Demo mode" at the bottom of the sidebar shows every amount in a made-up currency, for
screenshots and screen shares. The file is untouched.

## Self-host

The app binds 127.0.0.1 and has accounts whenever `TAXONOMY_AUTH=1` is set (the `dev` script
sets it) or it is bound to any other address. Each user gets their own `users/<id>/` under the
data directory with profiles, history, documents and connector secret, and nothing is shared.
Without accounts (`dev:solo`), everything lives directly in the data directory.

| Variable | Meaning |
|---|---|
| `TAXONOMY_DATA` | Data directory (default `data/`). Back this one directory up. |
| `TAXONOMY_PUBLIC_HOST` | The public host, e.g. `tax.example.com`; what connector addresses use. |
| `TAXONOMY_MAX_USERS` | Seats before sign-up says the server is full (1000). |
| `TAXONOMY_SIGNUP=closed` | Only the first account can be made. Set it when hosting for one household. |
| `TAXONOMY_SECURE_COOKIES=1` | Behind a TLS proxy: mark the session cookie Secure. |
| `TAXONOMY_TRUST_PROXY=1` | Behind a proxy only: throttle sign-ins by the last `X-Forwarded-For` entry. `fly` also believes `Fly-Client-IP`; the shipped `fly.toml` sets it. |

Sign-up is open by default. Passwords are argon2id hashes and sessions 30-day HttpOnly cookies,
in `auth.sqlite` in the data directory. Connectors reach `https://<host>/<secret>/mcp`, so keep
proxy access logs private; a client that can send headers can use `Authorization: Bearer
<secret>` against `/mcp` instead.

### Docker

The `Dockerfile` sets the proxy flags, listens on 8080 and keeps data in `/data`.

1. `docker build -t taxonomy .`
2. Run it with a volume:
   ```sh
   docker run -d --name taxonomy -p 127.0.0.1:8080:8080 -v taxonomy-data:/data \
     -e TAXONOMY_PUBLIC_HOST=tax.example.com -e TAXONOMY_SIGNUP=closed taxonomy
   ```
3. Put TLS in front. A one-line Caddyfile does it: `tax.example.com { reverse_proxy 127.0.0.1:8080 }`.

### Fly.io

One machine, one volume; `--ha=false` keeps Fly from starting a second machine that could not
share it.

1. `fly launch --copy-config --no-deploy` and pick an app name; it rewrites `app` and the region
   in `fly.toml`.
2. `fly volumes create data --size 1 -r <region>`, the region from `fly.toml`.
3. `fly deploy --ha=false`
4. Set `TAXONOMY_PUBLIC_HOST` in `fly.toml` to `<app name>.fly.dev` (or a custom domain after
   `fly certs add`) and deploy again.

Add `TAXONOMY_SIGNUP = "closed"` under `[env]` to keep the server to yourself. Fly snapshots the
volume daily (`fly volumes snapshots list data`).

## Licence

AGPL-3.0: run it, change it, share it; a modified copy served to others must publish its source.
See `LICENSE`, and `CONTRIBUTING.md` for the one-paragraph contributor agreement.

## Profile schema

Facts, choices and dates are separate things. `people`, `income`, `carryforwards`, `returns`,
`equity`, `home` and `deductions` are facts for the first plan year; `timeline` holds dated
changes to any of them; `scenarios` holds named lists of decisions (exercises, sales, liquidity
events, gifts) and `activeScenario` picks one; `sources` records where each number came from.
Older files are migrated on first read. The full description is in `docs/DATA-MODEL.md`, and
every scalar field is declared once in `packages/engine/src/fields.ts`. The overall design is in
`docs/ARCHITECTURE.md`.
