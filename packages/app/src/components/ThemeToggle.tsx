import { useState } from "react";
import { applyTheme, readTheme, type Theme } from "../theme.ts";

const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Theme, string> = { system: "◐ Auto", light: "☀ Light", dark: "☾ Dark" };

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  return <button type="button" className="btn theme-toggle" title="Cycle light, dark, system" onClick={() => { const t = NEXT[theme]; applyTheme(t); setTheme(t); }}>{LABEL[theme]}</button>;
}
