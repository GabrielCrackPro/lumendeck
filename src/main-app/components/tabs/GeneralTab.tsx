import { useState } from "react";
import { useStore } from "../../store";
import { Card, Toggle, Select, Btn, DisplaysCard } from "../ui";
import { api } from "../../ipc";
import { truncateError } from "../../utilities";
import type { ThemeMode } from "@shared/types";

export default function GeneralTab() {
  const { cfg, save, wallpaperPaused } = useStore();
  const [confirmWipe, setConfirmWipe] = useState(false);

  if (!cfg) return null;

  return (    <div className="stagger space-y-6">
      <Card title="General">
          <Select<ThemeMode>
            label="Theme"
            value={cfg.general.theme}
            options={[
              { id: "dark", label: "Dark" },
              { id: "light", label: "Light" },
              { id: "system", label: "Follow system" },
            ]}
            onChange={(v) => save((c) => (c.general.theme = v))}
          />
          <div className="border-t border-[var(--line)]" />
          <Toggle
            label="Launch at startup"
            description="Start LumenDeck with Windows so your lights follow your screen from the boot."
            checked={cfg.general.autostart}
            onChange={(v) => save((c) => (c.general.autostart = v))}
          />
          <Toggle
            label="Pause wallpaper on battery saver"
            checked={cfg.general.pauseOnBatterySaver}
            onChange={(v) => save((c) => (c.general.pauseOnBatterySaver = v))}
          />
          <Toggle
            label="Pause when a fullscreen app is active"
            checked={cfg.general.pauseOnFullscreen}
            onChange={(v) => save((c) => (c.general.pauseOnFullscreen = v))}
          />
          {wallpaperPaused && (
            <div className="mt-3 text-sm text-amber-500">Currently paused by the system.</div>
          )}
          <div className="mt-5 flex items-center justify-between gap-4 border-t border-[var(--line)] pt-5">
            <div className="text-sm text-[var(--text-dim)]">
              Manual edits to <code className="font-mono text-xs">config.json</code> are
              picked up automatically within a few seconds.
            </div>
            <Btn
              onClick={async () => {
                const fresh = await api.reloadConfig();
                useStore.setState({ cfg: fresh });
              }}
            >
              Reload now
            </Btn>
          </div>
        </Card>

        <DisplaysCard />

        <Card title="Danger zone">
          {confirmWipe ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
              <div className="text-sm font-semibold text-red-200">Wipe ALL LumenDeck data?</div>
              <p className="mt-1 text-xs leading-relaxed text-red-200/80">
                Deletes settings, the wallpaper vault, stickers and cached thumbnails, then
                closes the app. Your media files are not touched. This cannot be undone.
              </p>
              <div className="mt-3 flex gap-2.5">
                <Btn
                  variant="danger"
                  onClick={() => {
                    setConfirmWipe(false);
                    api
                      .factoryReset()
                      .then(() =>
                        useStore
                          .getState()
                          .toast("info", "App data wiped — closing LumenDeck…"),
                      )
                      .catch((e) => {
                        console.error("factory reset failed", e);
                        useStore
                          .getState()
                          .toast("error", `Factory reset failed: ${truncateError(e)}`);
                      });
                  }}
                >
                  Yes, wipe everything
                </Btn>
                <Btn variant="ghost" onClick={() => setConfirmWipe(false)}>
                  Cancel
                </Btn>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2.5">
              <Btn variant="danger" onClick={() => setConfirmWipe(true)}>
                Wipe app data
              </Btn>
              <Btn variant="danger" onClick={() => api.quit?.()}>
                Quit LumenDeck
              </Btn>
            </div>
          )}
          <p className="mt-4 text-xs leading-relaxed text-[var(--text-faint)]">
            Resetting returns every value to the factory default and restarts the engine.
            Wiping removes all data and closes the app — your media files stay untouched.
          </p>
        </Card>
    </div>
  );
}