import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { applyTheme, readTheme } from "./theme.ts";

applyTheme(readTheme());

createRoot(document.getElementById("root")!).render(<App />);
