/** A marker for something that happens in a year but is not a decision: a dated change or an RSU settlement. */
export interface FactMarker {
  id: string;
  year: number;
  label: string;
  detail: string;
  edit?: () => void;
  /** Index into profile.timeline when this marker is a dated change. */
  entryIndex?: number;
}

/** What the + menu can add. */
export type AddKind = { kind: "exercise"; type: "iso" | "nso"; company?: string } | { kind: "sell" } | { kind: "liquidity" };

/** Same margins as the tax chart, so event columns sit under their bars. */
export const STRIP_MARGIN = { left: 46, right: 12 };
