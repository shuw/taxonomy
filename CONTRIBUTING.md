# Contributing

Taxonomy is licensed under the GNU Affero General Public License, version 3 (see `LICENSE`).

## Contributor agreement

By sending a change (a pull request, a patch, a suggestion with code in it) you agree that:

1. You wrote it, or have the right to contribute it.
2. It is licensed under the AGPL-3.0 like the rest of the project.
3. You also grant Shu Wu a perpetual, worldwide, royalty-free right to relicense your contribution
   as part of Taxonomy under other terms, including commercial ones. This keeps the option of a
   dual-licensed or hosted product open without having to ask every contributor later. Your
   contribution stays available under the AGPL-3.0 regardless.

That is the whole agreement. Opening a pull request is how you accept it.

## Before you open a pull request

- `bun run test` and `bun run typecheck` pass.
- New tax logic has a test in `packages/engine/test/` and every ledger line has a plain-English reason.
- Visual work was checked in a browser, light and dark.
- Numbers come from a statute, a revenue procedure or a form instruction; say which in the commit.
