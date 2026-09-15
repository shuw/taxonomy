import { useEffect, useRef, useState } from "react";
import { companiesWithGrants, companyName, timelineFields, type FieldDef, type IntakeSection, type Profile } from "@taxonomy/engine";
import type { AddKind } from "./types.ts";

/** Fields in the order people actually change them; anything unlisted follows in registry order. */
const LIKELY_ORDER = [
  "people.self.salary", "people.self.bonus", "people.self.pretaxContributions", "people.spouse.salary", "people.spouse.bonus", "people.spouse.pretaxContributions", "filer.filingStatus", "filer.state",
  "income.interest", "income.ordinaryDividends", "income.qualifiedDividends", "income.longTermGains", "income.shortTermGains", "income.otherOrdinary",
  "deductions.charitable.cash", "deductions.charitable.appreciatedStock", "deductions.charitable.daf", "home.propertyTax", "deductions.stateIncomeTax", "deductions.medical",
  "assumptions.fmvGrowth", "assumptions.wageGrowth", "assumptions.inflation", "assumptions.bracketRateDelta",
];
const likelyRank = (path: string) => { const i = LIKELY_ORDER.indexOf(path); return i === -1 ? LIKELY_ORDER.length : i; };

const FACT_CATEGORIES: { key: IntakeSection[]; label: string }[] = [
  { key: ["pay", "basics"], label: "Pay and household" },
  { key: ["income"], label: "Other income" },
  { key: ["home"], label: "Home and deductions" },
  { key: ["assumptions"], label: "Assumptions" },
];

/** The decisions the + menu offers for this profile, in menu order. */
export function decisionKinds(profile: Profile): { key: string; label: string; what: AddKind }[] {
  const multi = profile.equity.companies.length > 1;
  const canSell = profile.equity.grants.length > 0 || (profile.equity.holdings?.length ?? 0) > 0;
  const exercise = (type: "iso" | "nso") => companiesWithGrants(profile, type).map((c) => ({ key: `${type}:${c}`, label: `Exercise ${type.toUpperCase()}s${multi ? ` · ${companyName(profile, c)}` : ""}`, what: { kind: "exercise", type, company: multi ? c : undefined } as AddKind }));
  return [
    ...exercise("iso"),
    ...exercise("nso"),
    ...(canSell ? [{ key: "sell", label: "Sell shares", what: { kind: "sell" } as AddKind }] : []),
    ...(profile.equity.companies.length > 0 ? [{ key: "liquidity", label: "Liquidity event (IPO, tender)", what: { kind: "liquidity" } as AddKind }] : []),
  ];
}

interface Props { year: number; profile: Profile; open: boolean; onOpen: (open: boolean) => void; onAdd: (what: AddKind) => void; onAddFact: (path: string) => void; }

/** The + under a year: decisions first, then dated changes by category. */
export function AddMenu({ year, profile, open, onOpen, onAdd, onAddFact }: Props) {
  const [category, setCategory] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const kinds = decisionKinds(profile);
  const fields: FieldDef[] = [...timelineFields()].sort((x, y) => likelyRank(x.path) - likelyRank(y.path));

  useEffect(() => {
    if (!open) { setCategory(null); return; }
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="ev-add-wrap" ref={ref}>
      <button type="button" className={"ev-add" + (open ? " on" : "")} title={`Add something in ${year}`} aria-label={`Add something in ${year}`} onClick={() => onOpen(!open)}>+</button>
      {open && (
        <div className="ev-menu">
          {category === null ? (
            <>
              {kinds.map((k) => <button type="button" key={k.key} onClick={() => onAdd(k.what)}>{k.label}</button>)}
              {kinds.length > 0 && <div className="ev-menu-sep">Change from {year} on</div>}
              {FACT_CATEGORIES.map((c, i) => fields.some((f) => c.key.includes(f.section)) && (
                <button type="button" key={c.label} className="cat" onClick={() => setCategory(i)}>{c.label} <span className="chev">›</span></button>
              ))}
            </>
          ) : (
            <>
              <button type="button" className="cat back" onClick={() => setCategory(null)}>‹ {FACT_CATEGORIES[category]!.label}</button>
              {fields.filter((f) => FACT_CATEGORIES[category]!.key.includes(f.section)).map((f) => <button type="button" key={f.path} onClick={() => onAddFact(f.path)}>{f.label}</button>)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
