/**
 * Who has an account. Run against a data directory, or over ssh on the Fly machine:
 *   bun scripts/users.ts                 # this checkout's data/
 *   bun scripts/users.ts /data           # inside the container
 *   fly ssh console -a taxonomy -C "bun /app/scripts/users.ts /data"
 * Demo visitors are counted, now and ever, not listed; real accounts are listed with when they signed up
 * and were last seen, in Pacific time (TAXONOMY_TZ for another zone).
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? process.env.TAXONOMY_DATA ?? "data");
const file = join(dir, "auth.sqlite");
if (!existsSync(file)) { console.error(`no accounts database at ${file}`); process.exit(1); }
const db = new Database(file, { readonly: true });
const guests = (db.query("select count(*) as n from users where email like '%@demo.invalid'").get() as { n: number }).n;
const TZ = process.env.TAXONOMY_TZ ?? "America/Los_Angeles";
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
/** "2026-09-18 19:35" in the chosen zone. */
const local = (iso: string) => fmt.format(new Date(iso)).replace(",", "");
const dayOf = (iso: string) => local(iso).slice(0, 10);
let byDay: { day: string; n: number }[] = [];
try {
  const counts = new Map<string, number>();
  for (const r of db.query("select created_at from guest_visits").all() as { created_at: string }[]) counts.set(dayOf(r.created_at), (counts.get(dayOf(r.created_at)) ?? 0) + 1);
  byDay = [...counts].sort().map(([day, n]) => ({ day, n }));
} catch { /* an older database has no visit log */ }
const ever = Math.max(guests, byDay.reduce((s, d) => s + d.n, 0));
// A session's last_seen_at moves at most once an hour, so "last seen" is right to within the hour; no session means signed out everywhere.
const real = db.query(`select u.email, u.created_at, max(s.last_seen_at) as last_seen, count(s.id_hash) as sessions
  from users u left join sessions s on s.user_id = u.id and s.expires_at >= ?
  where u.email not like '%@demo.invalid' group by u.id order by u.created_at`).all(new Date().toISOString()) as { email: string; created_at: string; last_seen: string | null; sessions: number }[];
console.log(`${real.length} account${real.length === 1 ? "" : "s"}; demo guests: ${guests} now, ${ever} ever`);
if (byDay.length) console.log(`  demo visits by day (${TZ}): ` + byDay.map((d) => `${d.day} ×${d.n}`).join(", "));
const stamp = (t: string | null) => (t ? local(t) : "signed out       ");
console.log(`  ${"created".padEnd(16)}  ${"last seen".padEnd(16)}  account   (times in ${TZ})`);
for (const u of real) console.log(`  ${stamp(u.created_at)}  ${stamp(u.last_seen)}  ${u.email}`);
