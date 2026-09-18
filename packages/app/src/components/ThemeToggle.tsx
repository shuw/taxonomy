import { useState } from "react";
import { applyTheme, readTheme, type Theme } from "../theme.ts";
import { Icon } from "./Icons.tsx";

const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const ICON: Record<Theme, "theme-auto" | "sun" | "moon"> = { system: "theme-auto", light: "sun", dark: "moon" };
const LABEL: Record<Theme, string> = { system: "Auto", light: "Light", dark: "Dark" };

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  return <button type="button" className="btn theme-toggle with-icon" title="Light, dark or auto" onClick={() => { const t = NEXT[theme]; applyTheme(t); setTheme(t); }} aria-label={`Theme: ${LABEL[theme]}`}><Icon name={ICON[theme]} /><span className="label">{LABEL[theme]}</span></button>;
}
