import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { useStore } from "./store";
import { readableOnTheme } from "./accent";
import "./index.css";

// Paint the real accent before React mounts. The CSS default for --glow is a
// hardcoded blue, and the in-app seeding (Shell's useGlow) only runs after the
// splash — so splash, onboarding and the first frames all wore the wrong
// color. One IPC round-trip here themes everything from the very first paint;
// the store seed below also satisfies useGlow so it skips its own fetch.
invoke<[number, number, number] | null>("system_accent")
  .then(async (c) => {
    if (!c) return;
    useStore.getState().setSystemAccent(c);
    // Readability pass assumes dark theme (the default and the splash's
    // palette before the config loads); useGlow re-picks against the real
    // theme + user's auto-shade strength once the config is in. AMOLED is
    // read here because it costs nothing extra from the same call, and the
    // seed is what a true-black user sees before the first React render.
    let strength = 1;
    let amoled = false;
    try {
      const cfg = await invoke<{
        general?: { accentAutoShade?: number; amoled?: boolean };
      }>("get_config");
      strength = Math.max(0, Math.min(1, cfg.general?.accentAutoShade ?? 1));
      amoled = cfg.general?.amoled ?? false;
    } catch {
      // Config not readable yet: full adjustment is the safe default.
    }
    document.documentElement.style.setProperty(
      "--glow",
      readableOnTheme(c, "dark", strength, amoled).join(" "),
    );
  })
  .catch(() => {
    // No backend (or non-Windows): the CSS default remains; Shell's useGlow
    // retries the IPC once it mounts.
  });

createRoot(document.getElementById("root")!).render(<App />);
