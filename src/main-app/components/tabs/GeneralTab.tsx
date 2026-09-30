import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../store";
import {
  Card,
  Toggle,
  Btn,
  DisplaysCard,
  Segmented,
  InfoNote,
  ItemTitle,
  Slider,
  SettingsLayout,
  ThemePicker,
  type SettingsSectionDef,
} from "../ui";
import { api } from "../../ipc";
import { truncateError } from "../../utilities";
import { checkForAppUpdate, installAppUpdate, announceUpdate } from "../../updater";

import WhatsNewCard from "../WhatsNewCard";
import HotkeysCard from "../HotkeysCard";
import {
  IconPalette,
  IconZap,
  IconKeyboard,
  IconMonitor,
  IconLayers,
  IconPlay,
  IconInfo,
} from "../icons";

/**
 * Every setting lives on one screen, in reading order. The index beside it is
 * an anchor list, not a router: it jumps the eye to a section and then tracks
 * where you already are, which is what makes one long page navigable instead
 * of merely long.
 *
 * Each entry owns a distinct icon. Seven identical chevrons in a row is a
 * list, not a map — the shapes are what let you find "the one with the
 * keyboard on it" without reading seven labels first.
 */
const SECTIONS: SettingsSectionDef[] = [
  {
    id: "appearance",
    label: "Appearance",
    blurb: "Theme, accent and lock screen",
    icon: IconPalette,
  },
  {
    id: "startup",
    label: "Startup & power",
    blurb: "Autostart, tray behaviour, pausing",
    icon: IconZap,
  },
  {
    id: "hotkeys",
    label: "Global hotkeys",
    blurb: "System-wide key bindings",
    icon: IconKeyboard,
  },
  {
    id: "displays",
    label: "Displays",
    blurb: "Per-monitor wallpaper",
    icon: IconMonitor,
  },
  {
    id: "scenes",
    label: "Scene profiles",
    blurb: "Capture and recall a whole look",
    icon: IconLayers,
  },
  {
    id: "playback",
    label: "Playback engine",
    blurb: "Video decoding and config",
    icon: IconPlay,
  },
  {
    id: "about",
    label: "About & updates",
    blurb: "Version, release notes, setup guide",
    icon: IconInfo,
  },
];

/** DOM id for a section anchor. Kept off the raw id so it cannot collide. */
const anchorId = (id: string) => `settings-section-${id}`;

/** The nearest ancestor that actually scrolls, or the page itself. */
function scrollParentOf(el: HTMLElement): HTMLElement {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
    node = node.parentElement;
  }
  return document.scrollingElement as HTMLElement;
}

/**
 * Accent auto-shade control: toggle + strength slider in one row block.
 * Off = raw source colors (hardware/screen colors reach the UI untouched,
 * which can be hard to read on either theme). On = the shade corrector
 * lifts/darkens the accent until it clears the legibility floor, with the
 * slider dialing how far toward that correction the UI commits.
 */
function AccentAutoShadeRow({ value }: { value: number }) {
  const on = value > 0.001;
  return (
    <div>
      <Toggle
        label="Auto-adjust accent for readability"
        description="Dark wallpaper tones and dim colors are lifted (light accents deepened in light theme) until they read clearly on the dashboard. Hardware lighting is never affected — this only changes the interface accent."
        checked={on}
        onChange={(v) =>
          useStore.getState().save((c) => (c.general.accentAutoShade = v ? 1 : 0))
        }
      />
      {on && (
        // Indented: a slider that only exists while its toggle is on should
        // read as subordinate to that toggle, not as a peer control.
        <div className="border-l-2 border-[var(--line)] pl-4">
          <Slider
            label="Adjustment strength"
            value={Math.round(value * 100)}
            min={25}
            max={100}
            step={5}
            format={(v) => `${v}%`}
            onChange={(v) =>
              useStore.getState().save((c) => (c.general.accentAutoShade = v / 100))
            }
          />
        </div>
      )}
    </div>
  );
}

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
  // Appearance first: it is the setting people change most, and it is the
  // one whose effect you notice immediately.
  const [section, setSection] = useState(SECTIONS[0]!.id);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [confirmSetup, setConfirmSetup] = useState(false);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  // Clicking an index entry scrolls the section under the reading line rather
  // than jumping to a raw offset: `scroll-margin-top` on the anchor absorbs
  // the container's top padding so the card header is not flush to the edge.
  const scrollToSection = useCallback((id: string) => {
    const el = document.getElementById(anchorId(id));
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setSection(id);
  }, []);

  // Highlight follows the scroll position, so the index stays truthful while
  // the user scrolls or drags the scrollbar rather than only after a click.
  useEffect(() => {
    const root = pageRef.current?.parentElement;
    if (!root) return;
    const scroller = scrollParentOf(root);
    const ids = SECTIONS.map((s) => s.id);

    const sync = () => {
      const line = scroller.getBoundingClientRect().top + 96;
      let current = ids[0]!;
      for (const id of ids) {
        const el = document.getElementById(anchorId(id));
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      // The last section can be shorter than the gap below the reading line,
      // so at the very bottom of the page it would never win on geometry
      // alone. Scrolling to the end means you are reading it.
      const atEnd =
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
      if (atEnd) current = ids[ids.length - 1]!;
      setSection(current);
    };

    sync();
    scroller.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    return () => {
      scroller.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);

  if (!cfg) return null;

  const anchor = (id: string, node: ReactNode) => (
    <div id={anchorId(id)} className="scroll-mt-6">
      {node}
    </div>
  );

  return (
    <div ref={pageRef}>
      <SettingsLayout
        sections={SECTIONS}
        active={section}
        onSelect={scrollToSection}
      >
        {anchor(
          "appearance",
          <Card title="Appearance" icon={<IconPalette />}>
            <ThemePicker
              value={cfg.general.theme}
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
            <AccentAutoShadeRow value={cfg.general.accentAutoShade ?? 1} />
            <Toggle
              label="Lock screen follows wallpaper"
              description="Also apply wallpaper changes to the Windows lock screen. Off by default, so you can keep a personal lock image while your desktop stays dynamic."
              checked={cfg.general.lockScreenFollowsWallpaper}
              onChange={(v) =>
                save((c) => (c.general.lockScreenFollowsWallpaper = v))
              }
            />
          </Card>,
        )}

        {anchor(
          "startup",
          <Card title="Startup & power" icon={<IconZap />}>
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
              description="Stops the wallpaper while something else has the screen, so a game or a video is not competing with it."
              checked={cfg.general.pauseOnFullscreen}
              onChange={(v) => save((c) => (c.general.pauseOnFullscreen = v))}
            />
            {wallpaperPaused && (
              <div className="mt-3">
                <InfoNote tone="warn">Currently paused by the system.</InfoNote>
              </div>
            )}
          </Card>,
        )}

        {anchor("hotkeys", <HotkeysCard />)}

        {anchor("displays", <DisplaysCard />)}

        {anchor(
          "scenes",
          <Card title="Scene profiles" icon={<IconLayers />}>
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
            {(cfg.scenes ?? []).length > 0 ? (
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
            ) : (
              <p className="mt-3 text-xs text-[var(--text-faint)]">
                No scenes yet. Set up a look you like, then capture it above.
              </p>
            )}
          </Card>,
        )}

        {anchor(
          "playback",
          <Card title="Playback engine" icon={<IconPlay />}>
            <Toggle
              label="Software video decoding"
              description="Fallback for machines whose GPU video decoder glitches. Uses more CPU and may stutter on 4K wallpapers. Takes effect after restarting LumenDeck."
              checked={cfg.general.softwareVideoDecode}
              onChange={(v) => save((c) => (c.general.softwareVideoDecode = v))}
            />
            <div className="mt-4 border-t border-[var(--line)] pt-4">
              <div className="text-sm font-medium text-[var(--text)]">
                Reload configuration
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-faint)]">
                Manual edits to <code className="font-mono">config.json</code>{" "}
                are picked up automatically within a few seconds. Use this if
                you want to force it right now.
              </p>
              <div className="mt-3">
                <Btn
                  onClick={async () => {
                    const fresh = await api.reloadConfig();
                    useStore.setState({ cfg: fresh });
                  }}
                >
                  Reload now
                </Btn>
              </div>
            </div>
          </Card>,
        )}

        {anchor(
          "about",
          <>
            <WhatsNewCard compact />

            <Card
              title="About & updates"
              icon={<IconInfo />}
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
                  LumenDeck — live wallpapers, ambient lighting, and system
                  theming in one place.
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
                <div className="shrink-0">
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
                        if (import.meta.env.DEV) {
                          useStore
                            .getState()
                            .toast("ok", "Dev build — update checks are disabled.");
                          return;
                        }
                        const update = await checkForAppUpdate();
                        setUpdateAvailable(update);
                        if (update) {
                          // Same offer as the startup check: install from the toast.
                          announceUpdate(update);
                        } else {
                          useStore
                            .getState()
                            .toast(
                              "ok",
                              `You're up to date (v${__APP_VERSION__}).`,
                            );
                        }
                      } catch (e) {
                        useStore
                          .getState()
                          .toast(
                            "error",
                            `Update check failed: ${truncateError(e)}`,
                          );
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
              </div>
            </Card>

            {/* The setup guide used to be the very first card on the settings
                page, above everything, for a button most people press zero
                times. It belongs with the version info. */}
            <Card title="Setup guide" icon={<IconZap />}>
              {confirmSetup ? (
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 text-sm text-[var(--text-dim)]">
                    The guide takes over the window. Your current setup stays
                    exactly as it is — you can walk away at any point.
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
                  <div className="min-w-0 text-sm text-[var(--text-dim)]">
                    Replay the first-run guide — pick a wallpaper, import media,
                    set up lighting and autostart.
                  </div>
                  <div className="shrink-0">
                    <Btn onClick={() => setConfirmSetup(true)}>
                      Run setup again
                    </Btn>
                  </div>
                </div>
              )}
            </Card>

            <DangerZone
              confirming={confirmWipe}
              onConfirm={() => setConfirmWipe(true)}
              onCancel={() => setConfirmWipe(false)}
            />
          </>,
        )}
      </SettingsLayout>
    </div>
  );
}

/**
 * The destructive corner of the app.
 *
 * Wiping is irreversible and sits next to Quitting, which is neither. They
 * used to be the same red button side by side, which is a good way to teach
 * someone that red means nothing here — and "Wipe app data" is the only
 * caller of factory_reset, so a misclick is unrecoverable. Quitting is now a
 * plain button, and it is the only control here.
 */
function DangerZone({
  confirming,
  onConfirm,
  onCancel,
}: {
  confirming: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Card title="Danger zone">
      {confirming ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <div className="text-sm font-semibold text-red-200">
            Wipe ALL LumenDeck data?
          </div>
          <p className="mt-1 text-xs leading-relaxed text-red-200/80">
            Deletes your settings, the wallpaper vault, stickers and cached
            thumbnails, then closes the app. Your media files are not touched.
            This cannot be undone.
          </p>
          <div className="mt-3 flex gap-2.5">
            <Btn
              variant="danger"
              onClick={() => {
                onCancel();
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
            <Btn variant="ghost" onClick={onCancel}>
              Cancel
            </Btn>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2.5">
          <Btn variant="danger" onClick={onConfirm}>
            Wipe app data
          </Btn>
          <Btn onClick={() => api.quit?.()}>Quit LumenDeck</Btn>
        </div>
      )}
      <p className="mt-4 text-xs leading-relaxed text-[var(--text-faint)]">
        Wiping removes every setting, your wallpaper vault and your stickers,
        then closes the app. Your media files on disk stay untouched. Quitting
        just closes it — the wallpaper and lighting stop with it.
      </p>
    </Card>
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
