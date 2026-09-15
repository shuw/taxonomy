export type Theme = "system" | "light" | "dark";
const KEY = "taxonomy.theme";

export function readTheme(): Theme {
  try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : "system"; } catch { return "system"; }
}

/** Stamp the choice on the root element; "system" removes the stamp so the OS setting applies. */
export function applyTheme(t: Theme): void {
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  try { if (t === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch {}
}
