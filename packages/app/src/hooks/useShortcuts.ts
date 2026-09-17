import { useEffect } from "react";

export interface Shortcut { keys: string[]; label: string; run: () => void; /** Works while a dialog is open. */ always?: boolean; }

const editable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/** Single-key shortcuts that stay out of the way of typing, modifiers and open dialogs. */
export function useShortcuts(shortcuts: Shortcut[]): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || editable(e.target)) return;
      const dialog = document.querySelector(".modal-backdrop") !== null;
      const hit = shortcuts.find((s) => s.keys.includes(e.key) && (!dialog || s.always));
      if (!hit) return;
      e.preventDefault();
      hit.run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcuts]);
}

/** How a key reads on screen. */
export const keyLabel = (k: string) => k === "ArrowLeft" ? "←" : k === "ArrowRight" ? "→" : k === "Escape" ? "Esc" : k.length === 1 ? k.toUpperCase() : k;
