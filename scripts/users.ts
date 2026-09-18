/**
 * Who has an account. Run against a data directory, or over ssh on the Fly machine:
 *   bun scripts/users.ts                 # this checkout's data/
 *   bun scripts/users.ts /data           # inside the container
 *   fly ssh console -a taxonomy -C "bun /app/scripts/users.ts /data"
 * Demo visitors are counted, not listed; real accounts are listed with when they signed up (UTC).
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? process.env.TAXONOMY_DATA ?? "data");
const file = join(dir, "auth.sqlite");
if (!existsSync(file)) { console.error(`no accounts database at ${file}`); process.exit(1); }
const db = new Database(file, { readonly: true });
const guests = (db.query("select count(*) as n from users where email like '%@demo.invalid'").get() as { n: number }).n;
const real = db.query("select email, created_at from users where email not like '%@demo.invalid' order by created_at").all() as { email: string; created_at: string }[];
console.log(`${real.length} account${real.length === 1 ? "" : "s"}, ${guests} demo guest${guests === 1 ? "" : "s"}`);
for (const u of real) console.log(`  ${u.created_at.slice(0, 16).replace("T", " ")}  ${u.email}`);
