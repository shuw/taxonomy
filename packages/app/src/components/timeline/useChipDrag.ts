import { useState } from "react";
import type { ScenarioEvent } from "@taxonomy/engine";

export interface DragState { id: string; x: number; y: number; target: number | null; moved: boolean; }

/**
 * Pointer-driven drag of a chip to another year's column. A press that never moves more than a
 * few pixels is a click and selects instead. Works with a mouse or a finger (chips disable touch
 * scrolling); the year select in each inspector is the keyboard path.
 */
export function useChipDrag(columnAt: (clientX: number) => number | null, onMove: (id: string, year: number) => void, onClick: (id: string) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const start = (id: string) => (ev: React.PointerEvent) => {
    if (ev.button !== 0) return;
    try { (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId); } catch {}
    setDrag({ id, x: ev.clientX, y: ev.clientY, target: null, moved: false });
  };
  const move = (ev: React.PointerEvent) => {
    if (!drag || drag.id !== (ev.currentTarget as HTMLElement).dataset.id) return;
    const moved = drag.moved || Math.abs(ev.clientX - drag.x) > 6 || Math.abs(ev.clientY - drag.y) > 6;
    setDrag({ ...drag, x: moved ? ev.clientX : drag.x, y: moved ? ev.clientY : drag.y, target: moved ? columnAt(ev.clientX) : null, moved });
  };
  const end = (e: ScenarioEvent) => (ev: React.PointerEvent) => {
    if (!drag || drag.id !== e.id) return;
    const target = drag.moved ? columnAt(ev.clientX) : null;
    setDrag(null);
    if (drag.moved) { if (target !== null && target !== e.year) onMove(e.id, target); }
    else onClick(e.id);
  };
  const cancel = () => setDrag(null);
  return { drag, start, move, end, cancel };
}
