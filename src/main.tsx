import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Bundled font (no external network request, so no blocked-request errors in previews/offline)
import "@fontsource/fredoka/latin-500.css";
import "@fontsource/fredoka/latin-600.css";
import "@fontsource/fredoka/latin-700.css";
import "./index.css";
import App from "./App";

// Canvas text doesn't trigger font downloads on its own, so preload the weights we draw with.
if (typeof document !== "undefined" && "fonts" in document) {
  for (const wgt of ["500", "600", "700"]) document.fonts.load(`${wgt} 20px Fredoka`).catch(() => undefined);
}

// Last-resort safety net: log unexpected async errors once instead of flooding the console.
const seen = new Set<string>();
window.addEventListener("unhandledrejection", (e) => {
  const msg = String((e.reason && (e.reason as Error).message) || e.reason);
  if (/AudioContext|play\(\)|NotAllowedError/i.test(msg)) { e.preventDefault(); return; }
  if (!seen.has(msg)) { seen.add(msg); console.warn("Unhandled promise rejection:", e.reason); }
  e.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
