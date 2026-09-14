# Taxonomy

A personal tax planning tool for understanding, not filing. Move a lever, watch six years of
federal and state tax respond, and click any number to see why it is what it is.

```sh
bun install
cp data/profile.example.yaml data/profile.yaml   # then edit with your numbers
bun run dev            # http://localhost:5173
bun run test           # engine tests
bun run plan           # print the plan for data/profile.yaml in the terminal
```

See `docs/PROPOSAL.md` for the approach and what is deliberately simplified.
