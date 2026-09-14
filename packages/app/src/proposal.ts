import type { EquityGrant, Profile, ProfileEdit } from "@taxonomy/engine";

/** The input shape of the propose_profile_update tool (mirrors packages/app/assistant.ts). */
export interface Proposal {
  summary: string;
  set: { path: string; value: number | string | boolean }[];
  addGrants: {
    name: string;
    type: "iso" | "nso" | "rsu";
    shares: number;
    strike: number | null;
    vested: number | null;
    schedule: { start: string; years: number; cliffMonths: number; cadence: "monthly" | "quarterly" | "annual" } | null;
    vesting: { year: number; shares: number }[];
  }[];
  removeGrants: string[];
  sharePrice: number | null;
}

export function isProposal(x: unknown): x is Proposal {
  const p = x as Proposal;
  return !!p && typeof p.summary === "string" && Array.isArray(p.set) && Array.isArray(p.addGrants) && Array.isArray(p.removeGrants);
}

function toGrant(g: Proposal["addGrants"][number]): EquityGrant {
  const grant: EquityGrant = { name: g.name, type: g.type, shares: g.shares };
  if (g.type !== "rsu") grant.strike = g.strike ?? 0;
  if (g.vested !== null) grant.vested = g.vested;
  if (g.schedule) grant.schedule = { start: g.schedule.start, years: g.schedule.years, cliffMonths: g.schedule.cliffMonths, cadence: g.schedule.cadence };
  else if (g.vesting.length) grant.vesting = Object.fromEntries(g.vesting.map((v) => [v.year, v.shares]));
  return grant;
}

/** Turn a proposal into profile edits against the current profile. */
export function proposalToEdits(p: Proposal, profile: Profile): ProfileEdit[] {
  const edits: ProfileEdit[] = p.set.map((s) => ({ path: s.path.split(".").map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg)), value: s.value }));
  if (p.sharePrice !== null) edits.push({ path: ["equity", "sharePrice"], value: p.sharePrice });
  if (p.addGrants.length || p.removeGrants.length) {
    const removed = new Set(p.removeGrants);
    const grants = [...profile.equity.grants.filter((g) => !removed.has(g.name)), ...p.addGrants.map(toGrant)];
    edits.push({ path: ["equity", "grants"], value: grants });
  }
  return edits;
}

/** Human-readable lines for the proposal card. */
export function describeProposal(p: Proposal): string[] {
  const lines: string[] = [];
  for (const s of p.set) lines.push(`Set ${s.path} to ${typeof s.value === "number" ? s.value.toLocaleString("en-US") : String(s.value)}`);
  if (p.sharePrice !== null) lines.push(`Share price $${p.sharePrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
  for (const g of p.addGrants) {
    const parts = [`${g.type.toUpperCase()} · ${g.shares.toLocaleString("en-US")} sh`];
    if (g.type !== "rsu" && g.strike !== null) parts.push(`strike $${g.strike}`);
    if (g.vested !== null) parts.push(`${g.vested.toLocaleString("en-US")} vested`);
    if (g.schedule) parts.push(`${g.schedule.years}y ${g.schedule.cadence} from ${g.schedule.start}${g.schedule.cliffMonths ? `, ${g.schedule.cliffMonths}mo cliff` : ""}`);
    else if (g.vesting.length) parts.push("vesting " + g.vesting.map((v) => `${v.year}: ${v.shares.toLocaleString("en-US")}`).join(", "));
    lines.push(`Add grant "${g.name}": ${parts.join(" · ")}`);
  }
  for (const name of p.removeGrants) lines.push(`Remove grant "${name}"`);
  return lines;
}
