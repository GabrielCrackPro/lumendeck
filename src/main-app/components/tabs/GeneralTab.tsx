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
            label="Pause wallpaper on battery"
            description="Stops wallpaper playback while the laptop is unplugged to save power."
            checked={cfg.general.pauseOnBatterySaver}
            onChange={(v) => save((c) => (c.general.pauseOnBatterySaver = v))}
          />
          <Toggle
            label="Pause when a fullscreen app is active"
            checked={cfg.general.pauseOnFullscreen}
            onChange={(v) => save((c) => (c.general.pauseOnFullscreen = v))}
          />
          <Toggle
            label="Software video decoding"
            description="Fallback for machines whose GPU video decoder glitches. Uses more CPU and may stutter on 4K wallpapers. Takes effect after restarting LumenDeck."
            checked={cfg.general.softwareVideoDecode}
            onChange={(v) => save((c) => (c.general.softwareVideoDecode = v))}
          />
          <Toggle
            label="Sync Windows accent color to wallpaper"
            description="The taskbar, Start menu and window highlights shift tone with your wallpaper's dominant color. Your original accent is remembered and restored when this is turned off."
            checked={cfg.general.accentSyncEnabled}
            onChange={(v) => save((c) => (c.general.accentSyncEnabled = v))}
          />
          <Toggle
            label="Lock screen follows wallpaper"
            description="Also apply wallpaper changes to the Windows lock screen. Off by default, so you can keep a personal lock image while your desktop stays dynamic."
            checked={cfg.general.lockScreenFollowsWallpaper}
            onChange={(v) => save((c) => (c.general.lockScreenFollowsWallpaper = v))}
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

        <Card title="Scene profiles">
          <p className="mb-3 text-xs leading-relaxed text-[var(--text-dim)]">
            Capture the whole look — wallpaper, per-monitor overrides, lighting mode and
            colors — and recall it any time with one click. Great for day/night, gaming,
            or streaming setups.
          </p>
          <SaveScene
            onSave={async (name) => {
              try {
                await api.sceneSave(name);
                const fresh = await api.getConfig();
                useStore.setState({ cfg: fresh });
                useStore.getState().toast("ok", `Scene "${name}" saved`);
              } catch (e) {
                useStore.getState().toast("error", `Save failed: ${truncateError(e)}`);
              }
            }}
          />
          {(cfg.scenes ?? []).length > 0 && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {(cfg.scenes ?? []).map((s) => (
                <div
                  key={s.id}
                  className="group flex items-center gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[var(--text)]">
                      {s.name}
                    </div>
                    <div className="font-mono text-[10px] text-[var(--text-faint)]">
                      {s.wallpaper.kind} · {s.rgb.mode}
                    </div>
                  </div>
                  <Btn
                    variant="primary"
                    onClick={async () => {
                      try {
                        await api.sceneApply(s.id);
                        useStore.getState().toast("ok", `Scene "${s.name}" applied`);
                      } catch (e) {
                        useStore.getState().toast("error", `Apply failed: ${truncateError(e)}`);
                      }
                    }}
                  >
                    Apply
                  </Btn>
                  <Btn
                    variant="ghost"
                    onClick={async () => {
                      await api.sceneDelete(s.id).catch(() => {});
                      const fresh = await api.getConfig();
                      useStore.setState({ cfg: fresh });
                    }}
                  >
                    Delete
                  </Btn>
                </div>
              ))}
            </div>
          )}
        </Card>

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

/** Scene name input + save button. */
function SaveScene({ onSave }: { onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    const n = name.trim() || `Scene ${new Date().toLocaleDateString()}`;
    setSaving(true);
    await onSave(n);
    setName("");
    setSaving(false);
  };
  return (
    <div className="flex items-center gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !saving && submit()}
        placeholder="Name this look (e.g. Night gaming)"
        className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[rgb(var(--glow)/0.5)] focus:outline-none"
      />
      <Btn variant="primary" disabled={saving} onClick={submit}>
        {saving ? "Saving…" : "Capture current look"}
      </Btn>
    </div>
  );
}