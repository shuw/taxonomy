/**
 * One table of what is colored how. Charts, chips, badges and legends all read from it, so a
 * series and the chip for the decision that drives it cannot drift apart. The hues live in
 * styles.css as --series-* tokens (one set per theme); this file only says which goes with what.
 *
 * Families: federal taxes are blues, AMT is orange, state taxes are amber and red, the two
 * non-tax outflows are slate (exercise cost) and magenta (gifts), and green is only ever "kept".
 */
export const PALETTE = {
  regular: "var(--series-regular)",
  surtax: "var(--series-surtax)",
  amt: "var(--series-amt)",
  state: "var(--series-state)",
  state2: "var(--series-state-2)",
  exercise: "var(--series-violet)",
  giving: "var(--series-giving)",
  kept: "var(--series-kept)",
  pinned: "var(--series-pinned)",
  accent2: "var(--accent-2)",
} as const;
export type PaletteKey = keyof typeof PALETTE;

/** The color of each decision or grant type, wherever it appears: an ISO chip is AMT orange because that is the tax it drives. */
export const KIND_COLOR: Record<string, PaletteKey> = {
  iso: "amt",
  nso: "exercise",
  rsu: "kept",
  sell: "kept",
  liquidity: "accent2",
  give: "giving",
};
export const kindColor = (kind: string): string => PALETTE[KIND_COLOR[kind] ?? "pinned"];

/** Inline style for a chip or badge, so the CSS has one rule instead of one per kind. */
export const kindStyle = (kind: string) => ({ "--kind": kindColor(kind) }) as React.CSSProperties;
