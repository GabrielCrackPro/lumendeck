import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../store";
import { Card, Toggle, Select, Btn, DisplaysCard, Segmented, InfoNote, ItemTitle } from "../ui";
import { api } from "../../ipc";
import { truncateError } from "../../utilities";
import { checkForAppUpdate, installAppUpdate, announceUpdate } from "../../updater";
import type { ThemeMode } from "@shared/types";
import WhatsNewCard from "../WhatsNewCard";

export default function GeneralTab() {
  const { cfg, save, wallpaperPaused, updateAvailable, setUpdateAvailable } =
    useStore(
      useShallow((s) => ({
        cfg: s.cfg,
        save: s.save,
        wallpaperPaused: s.wallpaperPaused,
        updateAvailable: s.updateAvailable,
        setUpdateAvailable: s.setUpdateAvailable,
      })),
    );
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [confirmSetup, setConfirmSetup] = useState(false);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);

  if (!cfg) return null;

  return (
    /* Settings is a reading surface, not a dashboard: a full-width row puts
       the toggle a foot from its own label once the window is maximized, so
       this column keeps a comfortable measure and centres in the shell. */
    <div className="stagger mx-auto w-full max-w-[1120px] space-y-6 3xl:max-w-[1280px]">
      <Card title="Setup">
        {confirmSetup ? (
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm text-[var(--text-dim)]">
              The guide takes over the window. Your current setup stays exactly
              as it is — you can walk away at any point.
            </div>
            <div className="flex shrink-0 gap-2.5">
              <Btn onClick={() => setConfirmSetup(false)}>Cancel</Btn>
              <Btn
                variant="primary"
                onClick={async () => {
                  setConfirmSetup(false);
                  await save((c) => (c.general.onboarded = false));
                }}
              >
                Start the guide
              </Btn>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm text-[var(--text-dim)]">
              Replay the first-run guide — pick a wallpaper, import media, set
              up lighting and autostart.
            </div>
            <Btn onClick={() => setConfirmSetup(true)}>Run setup again</Btn>
          </div>
        )}
      </Card>

      <WhatsNewCard />

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
        <Toggle
          label="AMOLED mode"
          description="True-black surfaces in dark theme — OLED pixels switch fully off, saving power and making the accent color pop. No effect in light theme."
          checked={cfg.general.amoled ?? false}
          onChange={(v) => save((c) => (c.general.amoled = v))}
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
          onChange={(v) =>
            save((c) => (c.general.lockScreenFollowsWallpaper = v))
          }
        />
      </Card>

      <Card title="Startup & power">
        <Toggle
          label="Launch at startup"
          description="Start LumenDeck with Windows so your lights follow your screen from the boot. Starts in the notification area — open the dashboard from the tray icon."
          checked={cfg.general.autostart}
          onChange={(v) => save((c) => (c.general.autostart = v))}
        />
        {cfg.general.autostart && (
          <Toggle
            label="Show the dashboard at login"
            description="With this off, logging in gives you a clean desktop: LumenDeck applies your wallpaper and lights in the background and waits in the tray. Turn it on and the dashboard opens alongside the rest of your startup apps."
            checked={cfg.general.showDashboardOnLogin ?? false}
            onChange={(v) => save((c) => (c.general.showDashboardOnLogin = v))}
          />
        )}
        <div className="py-2.5">
          <div className="kicker mb-2">Minimize button</div>
          <Segmented
            label="Minimize button"
            options={[
              { id: "tray", label: "Minimize to tray" },
              { id: "taskbar", label: "Minimize to taskbar" },
            ]}
            value={cfg.general.minimizeToTray ?? true ? "tray" : "taskbar"}
            onChange={(v) =>
              save((c) => (c.general.minimizeToTray = v === "tray"))
            }
          />
          <p className="mt-2 text-xs leading-relaxed text-[var(--text-faint)]">
            Both keep the wallpaper and lighting running. Tray hides the
            window entirely — reopen it with a left-click on the tray icon.
          </p>
        </div>
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
        {wallpaperPaused && (
          <div className="mt-3">
            <InfoNote tone="warn">Currently paused by the system.</InfoNote>
          </div>
        )}
      </Card>

      <Card title="Playback engine">
        <Toggle
          label="Software video decoding"
          description="Fallback for machines whose GPU video decoder glitches. Uses more CPU and may stutter on 4K wallpapers. Takes effect after restarting LumenDeck."
          checked={cfg.general.softwareVideoDecode}
          onChange={(v) => save((c) => (c.general.softwareVideoDecode = v))}
        />
        <div className="mt-4 flex items-center justify-between gap-4 border-t border-[var(--line)] pt-4">
          <div className="text-sm text-[var(--text-dim)]">
            Manual edits to{" "}
            <code className="font-mono text-xs">config.json</code> are picked up
            automatically within a few seconds.
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
          Capture the whole look — wallpaper, per-monitor overrides, lighting
          mode and colors — and recall it any time with one click. Great for
          day/night, gaming, or streaming setups.
        </p>
        <SaveScene
          onSave={async (name) => {
            try {
              await api.sceneSave(name);
              const fresh = await api.getConfig();
              useStore.setState({ cfg: fresh });
              useStore.getState().toast("ok", `Scene "${name}" saved`);
            } catch (e) {
              useStore
                .getState()
                .toast("error", `Save failed: ${truncateError(e)}`);
            }
          }}
        />
        {(cfg.scenes ?? []).length > 0 && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {(cfg.scenes ?? []).map((s) => (
              <div
                key={s.id}
                className="group flex items-center gap-2.5 panel-inset px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <ItemTitle className="truncate">{s.name}</ItemTitle>
                  <div className="font-mono text-[10px] text-[var(--text-faint)]">
                    {s.wallpaper.kind} · {s.rgb.mode}
                  </div>
                </div>
                <Btn
                  variant="primary"
                  onClick={async () => {
                    try {
                      await api.sceneApply(s.id);
                      useStore
                        .getState()
                        .toast("ok", `Scene "${s.name}" applied`);
                    } catch (e) {
                      useStore
                        .getState()
                        .toast("error", `Apply failed: ${truncateError(e)}`);
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
                    useStore
                      .getState()
                      .undoDelete(`Deleted scene "${s.name}"`, (next) => {
                        // Pushed back verbatim: the scene carries its own
                        // wallpaper + rgb snapshot, and keeping the id means
                        // anything pointing at it still resolves.
                        next.scenes.push(s);
                      });
                  }}
                >
                  Delete
                </Btn>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card
        title="About & updates"
        right={
          <span className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--text-faint)]">
            v{__APP_VERSION__}
            {__APP_BUILD_MODE__ === "dev" && (
              <span className="rounded-sm bg-amber-500/20 px-1 font-mono text-[8.5px] tracking-[0.15em] text-amber-400">
                DEV
              </span>
            )}
          </span>
        }
      >
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 text-xs leading-relaxed text-[var(--text-dim)]">
            LumenDeck — live wallpapers, ambient lighting, and system theming in
            one place.
            {updateAvailable && (
              <div className="mt-2 text-(--text)">
                Version {updateAvailable.version} is available.
                {updateAvailable.notes && (
                  <span className="text-(--text-dim)">
                    {" "}
                    {updateAvailable.notes}
                  </span>
                )}
              </div>
            )}
          </div>
          <Btn
            size="sm"
            disabled={checking || installing}
            onClick={async () => {
              if (updateAvailable) {
                setInstalling(true);
                setDownloadProgress(0);
                try {
                  await installAppUpdate(setDownloadProgress);
                } catch (e) {
                  useStore
                    .getState()
                    .toast(
                      "error",
                      `Update install failed: ${truncateError(e)}`,
                    );
                } finally {
                  setInstalling(false);
                }
                return;
              }

              setChecking(true);
              try {
                const update = await checkForAppUpdate();
                setUpdateAvailable(update);
                if (update) {
                  // Same offer as the startup check: install from the toast.
                  announceUpdate(update);
                } else {
                  useStore
                    .getState()
                    .toast("ok", `You're up to date (v${__APP_VERSION__}).`);
                }
              } catch (e) {
                useStore
                  .getState()
                  .toast("error", `Update check failed: ${truncateError(e)}`);
              } finally {
                setChecking(false);
              }
            }}
          >
            {installing
              ? downloadProgress == null
                ? "Installing…"
                : `Downloading ${downloadProgress}%`
              : checking
                ? "Checking…"
                : updateAvailable
                  ? `Install v${updateAvailable.version}`
                  : "Check for updates"}
          </Btn>
        </div>
      </Card>

      <Card title="Danger zone">
        {confirmWipe ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
            <div className="text-sm font-semibold text-red-200">
              Wipe ALL LumenDeck data?
            </div>
            <p className="mt-1 text-xs leading-relaxed text-red-200/80">
              Deletes settings, the wallpaper vault, stickers and cached
              thumbnails, then closes the app. Your media files are not touched.
              This cannot be undone.
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
                        .toast(
                          "error",
                          `Factory reset failed: ${truncateError(e)}`,
                        );
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
          Resetting returns every value to the factory default and restarts the
          engine. Wiping removes all data and closes the app — your media files
          stay untouched.
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
