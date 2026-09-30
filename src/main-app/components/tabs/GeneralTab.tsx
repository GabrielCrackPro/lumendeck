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
import { t, LOCALE_NAMES } from "../../i18n";

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
// Catalog keys, resolved by `SettingsLayout` at render. The section index is
// the first thing anyone sees in Settings, so it has to translate with the rest
// of the page rather than staying as an English column beside Spanish cards.
const SECTIONS: SettingsSectionDef[] = [
  {
    id: "appearance",
    label: "settings.appearance",
    blurb: "settings.theme-accent-and-lock-screen",
    icon: IconPalette,
  },
  {
    id: "startup",
    label: "settings.startup-and-power",
    blurb: "settings.autostart-tray-behaviour-pausing",
    icon: IconZap,
  },
  {
    id: "hotkeys",
    label: "settings.global-hotkeys",
    blurb: "settings.system-wide-key-bindings",
    icon: IconKeyboard,
  },
  {
    id: "displays",
    label: "settings.displays",
    blurb: "settings.per-monitor-wallpaper",
    icon: IconMonitor,
  },
  {
    id: "scenes",
    label: "settings.scene-profiles",
    blurb: "settings.capture-and-recall-a-whole-look",
    icon: IconLayers,
  },
  {
    id: "playback",
    label: "settings.playback-engine",
    blurb: "settings.video-decoding-and-config",
    icon: IconPlay,
  },
  {
    id: "about",
    label: "settings.about-and-updates",
    blurb: "settings.version-release-notes-setup-guide",
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
        label={t("common.auto-adjust-accent-for-readability")}
        description={t("common.dark-wallpaper-tones-and-dim-colors-are-lifted-l")}
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
            label={t("common.adjustment-strength")}
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

/**
 * Language sits in Appearance because it is a preference about how the app
 * reads, not about what it does, and because anyone who cannot read the
 * current language is looking for it in exactly this card.
 *
 * `auto` is the default and the only option that can change on its own: it
 * follows the Windows display language, so a machine set to Spanish reads
 * Spanish the first time the dashboard opens, with nothing to configure. The
 * explicit choices exist for the case that matters more — a Spanish keyboard
 * on an English Windows, or a preference for reading a language that is not
 * the one you work in.
 *
 * Each option is named in its own language. "Español" in the list means the
 * same thing to someone who cannot read the rest of this screen, which is
 * exactly the person who needs to find this control.
 */
function LanguagePicker({ value }: { value: string }) {
  const onChange = (v: string) =>
    useStore.getState().save((c) => (c.general.language = v));
  return (
    <div className="py-2.5">
      <div className="kicker mb-2">{t("common.app-language")}</div>
      <Segmented
        label={t("common.app-language")}
        options={[
          { id: "auto", label: t("common.system") },
          { id: "en", label: LOCALE_NAMES.en },
          { id: "es", label: LOCALE_NAMES.es },
        ]}
        value={value}
        onChange={onChange}
      />
      <p className="mt-2 text-xs leading-relaxed text-[var(--text-faint)]">
        {t("common.system-follows-your-windows-display-language")}
      </p>
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
          <Card title={t("common.appearance")} icon={<IconPalette />}>
            <ThemePicker
              value={cfg.general.theme}
              onChange={(v) => save((c) => (c.general.theme = v))}
            />
            <Toggle
              label={t("common.amoled-mode")}
              description={t("common.true-black-surfaces-in-dark-theme-oled-pixels-sw")}
              checked={cfg.general.amoled ?? false}
              onChange={(v) => save((c) => (c.general.amoled = v))}
            />
            <Toggle
              label={t("common.sync-windows-accent-color-to-wallpaper")}
              description={t("common.the-taskbar-start-menu-and-window-highlights-shi")}
              checked={cfg.general.accentSyncEnabled}
              onChange={(v) => save((c) => (c.general.accentSyncEnabled = v))}
            />
            <AccentAutoShadeRow value={cfg.general.accentAutoShade ?? 1} />
            <LanguagePicker value={cfg.general.language ?? "auto"} />
            <Toggle
              label={t("common.lock-screen-follows-wallpaper")}
              description={t("common.also-apply-wallpaper-changes-to-the-windows-lock")}
              checked={cfg.general.lockScreenFollowsWallpaper}
              onChange={(v) =>
                save((c) => (c.general.lockScreenFollowsWallpaper = v))
              }
            />
          </Card>,
        )}

        {anchor(
          "startup",
          <Card title={t("common.startup-and-power")} icon={<IconZap />}>
            <Toggle
              label={t("common.launch-at-startup")}
              description={t("common.start-lumendeck-with-windows-so-your-lights-foll")}
              checked={cfg.general.autostart}
              onChange={(v) => save((c) => (c.general.autostart = v))}
            />
            {cfg.general.autostart && (
              <Toggle
                label={t("common.show-the-dashboard-at-login")}
                description={t("common.with-this-off-logging-in-gives-you-a-clean-deskt")}
                checked={cfg.general.showDashboardOnLogin ?? false}
                onChange={(v) => save((c) => (c.general.showDashboardOnLogin = v))}
              />
            )}
            <div className="py-2.5">
              <div className="kicker mb-2">{t("common.minimize-button")}</div>
              <Segmented
                label={t("common.minimize-button")}
                options={[
                  { id: "tray", label: t("common.minimize-to-tray") },
                  { id: "taskbar", label: t("common.minimize-to-taskbar") },
                ]}
                value={cfg.general.minimizeToTray ?? true ? "tray" : "taskbar"}
                onChange={(v) =>
                  save((c) => (c.general.minimizeToTray = v === "tray"))
                }
              />
              <p className="mt-2 text-xs leading-relaxed text-[var(--text-faint)]">
                {t("common.both-keep-the-wallpaper-and-lighting-running-tra")}
              </p>
            </div>
            <Toggle
              label={t("common.pause-wallpaper-on-battery")}
              description={t("common.stops-wallpaper-playback-while-the-laptop-is-unp")}
              checked={cfg.general.pauseOnBatterySaver}
              onChange={(v) => save((c) => (c.general.pauseOnBatterySaver = v))}
            />
            <Toggle
              label={t("common.pause-when-a-fullscreen-app-is-active")}
              description={t("common.stops-the-wallpaper-while-something-else-has-the")}
              checked={cfg.general.pauseOnFullscreen}
              onChange={(v) => save((c) => (c.general.pauseOnFullscreen = v))}
            />
            {wallpaperPaused && (
              <div className="mt-3">
                <InfoNote tone="warn">{t("common.currently-paused-by-the-system")}</InfoNote>
              </div>
            )}
          </Card>,
        )}

        {anchor("hotkeys", <HotkeysCard />)}

        {anchor("displays", <DisplaysCard />)}

        {anchor(
          "scenes",
          <Card title={t("common.scene-profiles")} icon={<IconLayers />}>
            <p className="mb-3 text-xs leading-relaxed text-[var(--text-dim)]">                {t("common.capture-the-whole-look-wallpaper-per-monitor-ove")}
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
                            .toast(
                              "error",
                              t("common.apply-failed-{error}", {
                                error: truncateError(e),
                              }),
                            );
                        }
                      }}
                    >
                      {t("common.apply")}
                    </Btn>
                    <Btn
                      variant="ghost"
                      onClick={async () => {
                        await api.sceneDelete(s.id).catch(() => {});
                        const fresh = await api.getConfig();
                        useStore.setState({ cfg: fresh });
                        useStore
                          .getState()
                          .undoDelete(
                            t("common.deleted-scene", { name: s.name }),
                            (next) => {
                            // Pushed back verbatim: the scene carries its own
                            // wallpaper + rgb snapshot, and keeping the id means
                            // anything pointing at it still resolves.
                            next.scenes.push(s);
                            },
                          );
                      }}
                    >
                      {t("common.delete")}
                    </Btn>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-[var(--text-faint)]">
                {t("common.no-scenes-yet-set-up-a-look-you-like-then-captur")}
              </p>
            )}
          </Card>,
        )}

        {anchor(
          "playback",
          <Card title={t("common.playback-engine")} icon={<IconPlay />}>
            <Toggle
              label={t("common.software-video-decoding")}
              description={t("common.fallback-for-machines-whose-gpu-video-decoder-gl")}
              checked={cfg.general.softwareVideoDecode}
              onChange={(v) => save((c) => (c.general.softwareVideoDecode = v))}
            />
            <div className="mt-4 border-t border-[var(--line)] pt-4">
              <div className="text-sm font-medium text-[var(--text)]">
                {t("common.reload-configuration")}
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-faint)]">
                {t("common.manual-edits-to")}{" "}
                <code className="font-mono">config.json</code>{" "}
                {t("common.are-picked-up-automatically-within-a-few-seconds")}
              </p>
              <div className="mt-3">
                <Btn
                  onClick={async () => {
                    const fresh = await api.reloadConfig();
                    useStore.setState({ cfg: fresh });
                  }}
                >
                  {t("common.reload-now")}
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
              title={t("common.about-and-updates")}
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
                  {t("common.lumendeck-live-wallpapers-ambient-lighting-and-s")}
                  {updateAvailable && (
                    <div className="mt-2 text-(--text)">
                      {t("common.version-{version}-is-available", {
                        version: updateAvailable.version,
                      })}
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
                            t("common.update-check-failed-{error}", {
                              error: truncateError(e),
                            }),
                          );
                      } finally {
                        setChecking(false);
                      }
                    }}
                  >
                    {installing
                      ? downloadProgress == null
                        ? t("common.installing")
                        : t("common.downloading-{n}", { n: downloadProgress })
                      : checking
                        ? t("common.checking")
                        : updateAvailable
                          ? t("common.install-v{version}", {
                              version: updateAvailable.version,
                            })
                          : t("common.check-for-updates")}
                  </Btn>
                </div>
              </div>
            </Card>

            {/* The setup guide used to be the very first card on the settings
                page, above everything, for a button most people press zero
                times. It belongs with the version info. */}
            <Card title={t("common.setup-guide")} icon={<IconZap />}>
              {confirmSetup ? (
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 text-sm text-[var(--text-dim)]">
                    {t("common.the-guide-takes-over-the-window-your-current-set")}
                  </div>
                  <div className="flex shrink-0 gap-2.5">
                    <Btn onClick={() => setConfirmSetup(false)}>
                      {t("common.cancel")}
                    </Btn>
                    <Btn
                      variant="primary"
                      onClick={async () => {
                        setConfirmSetup(false);
                        await save((c) => (c.general.onboarded = false));
                      }}
                    >
                      {t("common.start-the-guide")}
                    </Btn>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 text-sm text-[var(--text-dim)]">
                    {t("common.replay-the-first-run-guide-pick-a-wallpaper-impo")}
                  </div>
                  <div className="shrink-0">
                    <Btn onClick={() => setConfirmSetup(true)}>
                      {t("common.run-setup-again")}
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
    <Card title={t("common.danger-zone")}>
      {confirming ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <div className="text-sm font-semibold text-red-200">
            {t("common.wipe-all-lumendeck-data")}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-red-200/80">
            {t("common.deletes-your-settings-the-wallpaper-vault-sticke")}
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
                      .toast(
                        "info",
                        t("common.app-data-wiped-closing-lumendeck"),
                      ),
                  )
                  .catch((e) => {
                    console.error("factory reset failed", e);
                    useStore
                      .getState()
                      .toast(
                        "error",
                        t("common.factory-reset-failed-{error}", {
                          error: truncateError(e),
                        }),
                      );
                  });
              }}
            >
              {t("common.yes-wipe-everything")}
            </Btn>
            <Btn variant="ghost" onClick={onCancel}>
              {t("common.cancel")}
            </Btn>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2.5">
          <Btn variant="danger" onClick={onConfirm}>
            {t("common.wipe-app-data")}
          </Btn>
          <Btn onClick={() => api.quit?.()}>{t("common.quit-lumendeck")}</Btn>
        </div>
      )}
      <p className="mt-4 text-xs leading-relaxed text-[var(--text-faint)]">
        {t("common.wiping-removes-every-setting-your-wallpaper-vaul")}
      </p>
    </Card>
  );
}

/** Scene name input + save button. */
function SaveScene({ onSave }: { onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    const n =
      name.trim() ||
      t("common.scene-{date}", { date: new Date().toLocaleDateString() });
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
        placeholder={t("common.name-this-look-e-g-night-gaming")}
        className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[rgb(var(--glow)/0.5)] focus:outline-none"
      />
      <Btn variant="primary" disabled={saving} onClick={submit}>
        {t(saving ? "common.saving" : "settings.capture-current-look")}
      </Btn>
    </div>
  );
}
