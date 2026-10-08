import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { installContextMenuSuppression } from "@shared/contextMenu";
import App from "./App";
import { useStore } from "./store";
import { readableOnTheme } from "./accent";
import "./index.css";

installContextMenuSuppression();

invoke<[number, number, number] | null>("system_accent")
  .then(async (c) => {
    if (!c) return;
    useStore.getState().setSystemAccent(c);
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
