/**
 * Who has an account. Run against a data directory, or over ssh on the Fly machine:
 *   bun scripts/users.ts                 # this checkout's data/
 *   bun scripts/users.ts /data           # inside the container
 *   fly ssh console -a taxonomy -C "bun /app/scripts/users.ts /data"
 * Demo visitors are counted, now and ever, not listed; real accounts are listed with when they signed up (UTC).
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? process.env.TAXONOMY_DATA ?? "data");
const file = join(dir, "auth.sqlite");
if (!existsSync(file)) { console.error(`no accounts database at ${file}`); process.exit(1); }
const db = new Database(file, { readonly: true });
const guests = (db.query("select count(*) as n from users where email like '%@demo.invalid'").get() as { n: number }).n;
let byDay: { day: string; n: number }[] = [];
try { byDay = db.query("select substr(created_at, 1, 10) as day, count(*) as n from guest_visits group by day order by day").all() as { day: string; n: number }[]; } catch { /* an older database has no visit log */ }
const ever = Math.max(guests, byDay.reduce((s, d) => s + d.n, 0));
const real = db.query("select email, created_at from users where email not like '%@demo.invalid' order by created_at").all() as { email: string; created_at: string }[];
console.log(`${real.length} account${real.length === 1 ? "" : "s"}; demo guests: ${guests} now, ${ever} ever`);
if (byDay.length) console.log("  demo visits by day (UTC): " + byDay.map((d) => `${d.day} ×${d.n}`).join(", "));
for (const u of real) console.log(`  ${u.created_at.slice(0, 16).replace("T", " ")}  ${u.email}`);
