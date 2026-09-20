import { useEffect, useState } from "react";
import { useStore } from "../../store";
import { Card, Toggle, Select, Btn } from "../ui";
import { IconMonitor } from "../icons";
import { api } from "../../ipc";
import type { ThemeMode } from "@shared/types";

export default function GeneralTab() {
  const { cfg, save, wallpaperPaused } = useStore();
  const [mons, setMons] = useState<
    { device: string; x: number; y: number; w: number; h: number; primary: boolean }[]
  >([]);

  useEffect(() => {
    api.monitors().then(setMons).catch(() => setMons([]));
  }, []);

  if (!cfg) return null;

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6">
      <div className="stagger space-y-6">
        <Card title="Appearance">
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
        </Card>

        <Card title="Behavior">
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

        <Card title="Displays">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {mons.map((m, i) => (
              <div
                key={`${m.device}-${i}`}
                className={`flex items-center gap-3 rounded-2xl border px-4 py-3.5 ${
                  m.primary
                    ? "border-[rgb(var(--glow)/0.35)] bg-[rgb(var(--glow)/0.07)]"
                    : "border-[var(--line)] bg-[var(--panel-strong)]"
                }`}
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                    m.primary ? "bg-[rgb(var(--glow)/0.15)]" : "bg-[var(--panel)]"
                  }`}
                >
                  <IconMonitor className="h-5 w-5 text-[var(--text-dim)]" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-[var(--text)]">
                    {m.device.replace(/\\/g, "") || `Display ${i + 1}`}
                    {m.primary && (
                      <span className="ml-2 font-mono text-[9px] uppercase tracking-widest text-[rgb(var(--glow))]">
                        primary
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-[11px] text-[var(--text-faint)]">
                    {m.w} × {m.h} @ ({m.x}, {m.y})
                  </div>
                </div>
              </div>
            ))}
            {mons.length === 0 && (
              <div className="col-span-2 text-sm text-[var(--text-faint)]">Detecting displays…</div>
            )}
          </div>
        </Card>

        <Card title="Danger zone">
          <div className="flex flex-wrap gap-2.5">
            <Btn
              variant="danger"
              onClick={() => {
                if (confirm("Reset all LumenDeck settings to defaults?")) {
                  location.reload();
                }
              }}
            >
              Reset settings
            </Btn>
            <Btn variant="danger" onClick={() => api.quit?.()}>
              Quit LumenDeck
            </Btn>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-[var(--text-faint)]">
            Resetting returns every value to the factory default and restarts the engine.
          </p>
        </Card>
      </div>
    </div>
  );
}