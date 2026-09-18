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

/** A gift is a decision in the scenario; the recurring annual figures under Edit my information stay facts. */
const GIVING: { how: "cash" | "stock" | "daf"; label: string }[] = [{ how: "cash", label: "Cash" }, { how: "stock", label: "Appreciated stock" }, { how: "daf", label: "To a donor-advised fund" }];

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
  // The flyout sits beside the hovered row, and flips left when the screen ends.
  const [fly, setFly] = useState<{ top: number; left: boolean }>({ top: 0, left: false });
  const ref = useRef<HTMLDivElement>(null);
  const openCategory = (i: number, el: HTMLElement) => { setCategory(i); setFly({ top: el.offsetTop, left: window.innerWidth - el.getBoundingClientRect().right < 240 }); };
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
      <button type="button" className={"ev-add" + (open ? " on" : "")} title={`Add to ${year}`} aria-label={`Add to ${year}`} onClick={() => onOpen(!open)}>+</button>
      {open && (
        <div className="ev-menu">
          {kinds.map((k) => <button type="button" key={k.key} onMouseEnter={() => setCategory(null)} onClick={() => onAdd(k.what)}>{k.label}</button>)}
          <button type="button" className={"cat" + (category === -1 ? " on" : "")} aria-haspopup="menu" aria-expanded={category === -1} onMouseEnter={(e) => openCategory(-1, e.currentTarget)} onClick={(e) => openCategory(-1, e.currentTarget)}>Give <span className="chev">›</span></button>
          <div className="ev-menu-sep">Change in {year}</div>
          {FACT_CATEGORIES.map((c, i) => fields.some((f) => c.key.includes(f.section)) && (
            <button type="button" key={c.label} className={"cat" + (category === i ? " on" : "")} aria-haspopup="menu" aria-expanded={category === i} onMouseEnter={(e) => openCategory(i, e.currentTarget)} onClick={(e) => openCategory(i, e.currentTarget)}>{c.label} <span className="chev">›</span></button>
          ))}
          {category !== null && (
            <div className={"ev-submenu" + (fly.left ? " left" : "")} style={{ top: fly.top }}>
              {category === -1
                ? GIVING.map((g) => <button type="button" key={g.how} onClick={() => onAdd({ kind: "give", how: g.how })}>{g.label}</button>)
                : fields.filter((f) => FACT_CATEGORIES[category]!.key.includes(f.section)).map((f) => <button type="button" key={f.path} onClick={() => onAddFact(f.path)}>{f.label}</button>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
