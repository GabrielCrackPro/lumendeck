import {
  useCallback,
  useEffect,
  useMemo,
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
import { usePending } from "../../pending";
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
  IconClipboard,
  IconFolder,
  IconRefresh,
  IconSparkle,
  IconClose,
  IconTrash,
  IconAlert,
  IconTerminal,
  IconCopy,
} from "../icons";
import { t, LOCALE_NAMES } from "../../i18n";
import type { DevInfo } from "@shared/types";
import { useCopy } from "../useCopy";
import { buildReport } from "../devReport";
import { versionDisagreement, versionLabel } from "../buildIdentity";

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
    id: "developer",
    label: "settings.developer",
    blurb: "settings.build-facts-configuration-and-logs",
    icon: IconTerminal,
  },
  {
    id: "about",
    label: "settings.about-and-updates",
    blurb: "settings.version-release-notes-setup-guide",
    icon: IconInfo,
  },
];

/**
 * DOM id for a section anchor. Kept off the raw id so it cannot collide.
 *
 * The anchor is also the section's own stacking context: several sections hold
 * more than one card, and `space-y-6` is a no-op for the single-card ones, so
 * the rhythm comes from here instead of from the page-level gap. Without it the
 * cards inside `about` butt against each other while every card above them has
 * breathing room.
 */
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
  // Scene rows each drive a save/apply/delete of their own entry, keyed by id
  // so two rows can work without blocking one another.
  const { pending, run } = usePending();
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
    <div id={anchorId(id)} className="scroll-mt-6 space-y-6">
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
              label={t("common.show-color-hex-codes")}
              description={t("common.show-the-hex-code-beside-each-colour-swatch")}
              checked={cfg.general.showColorHex ?? true}
              onChange={(v) => save((c) => (c.general.showColorHex = v))}
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
                await run(
                  "scene-save",
                  async () => {
                    await api.sceneSave(name);
                    const fresh = await api.getConfig();
                    useStore.setState({ cfg: fresh });
                    useStore
                      .getState()
                      .toast("ok", t("common.scene-{name}-saved", { name }));
                  },
                  (e) =>
                    useStore
                      .getState()
                      .toast(
                        "error",
                        t("common.save-failed-{error}", { error: truncateError(e) }),
                      ),
                );
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
                      pending={pending.has(`scene-apply-${s.id}`)}
                      onClick={() => {
                        void run(
                          `scene-apply-${s.id}`,
                          () => api.sceneApply(s.id),
                          (e) =>
                            useStore
                              .getState()
                              .toast(
                                "error",
                                t("common.apply-failed-{error}", {
                                  error: truncateError(e),
                                }),
                              ),
                        ).then((ok) => {
                          if (ok) {
                            useStore
                              .getState()
                              .toast("ok", t("common.scene-{name}-applied", { name: s.name }));
                          }
                        });
                      }}
                    >
                      {t("common.apply")}
                    </Btn>
                    <Btn
                      variant="ghost"
                      pending={pending.has(`scene-delete-${s.id}`)}
                      onClick={() => {
                        void run(`scene-delete-${s.id}`, async () => {
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
                        });
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
          </Card>,
        )}

        {/* Everything here is a thing you reach for when the app is already
            misbehaving, not a preference you choose up front: what build you
            are on, where the files are, what the log says. It used to be
            scattered — the config reload sat inside Video playback, which is
            why editing config.json was discoverable only if you knew it was
            two cards below a video toggle. */}
        {anchor(
          "developer",
          <>
            <DeveloperCard />
            <LogViewerCard />
          </>,
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
                  {/* The commit belongs here, not only in the Developer card.
                      This is the line someone copies into a bug report, and a
                      bare "v0.2.7" cannot say which build produced the bug —
                      two local builds of the same version look identical
                      unless one of them says it was dirty. */}
                  {__APP_BUILD_ID__ && (
                    <span
                      className="rounded-sm bg-amber-500/20 px-1 text-amber-400"
                      title={t("common.built-from-commit-{id}", {
                        id: __APP_BUILD_ID__,
                      })}
                    >
                      {__APP_BUILD_ID__}
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
                              t("common.update-install-failed-{error}", {
                                error: truncateError(e),
                              }),
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
                            .toast("ok", t("common.dev-build-no-updates"));
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
                              t("common.up-to-date-v{version}", { version: __APP_VERSION__ }),
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
            <Card title={t("common.setup-guide")} icon={<IconSparkle />}>
              {confirmSetup ? (
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 text-sm text-[var(--text-dim)]">
                    {t("common.the-guide-takes-over-the-window-your-current-set")}
                  </div>
                  <div className="flex shrink-0 gap-2.5">
                    <Btn onClick={() => setConfirmSetup(false)}>{t("common.cancel")}</Btn>
                    <Btn
                      variant="primary"
                      onClick={async () => {
                        setConfirmSetup(false);
                        await save((c) => (c.general.onboarded = false));
                      }}
                    >
                      <IconSparkle className="h-4 w-4" />
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
                      <IconRefresh className="h-4 w-4" />
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
    <Card title={t("common.danger-zone")} icon={<IconAlert />}>
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
              <IconClose className="h-4 w-4" />
              {t("common.cancel")}
            </Btn>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2.5">
          <Btn variant="danger" onClick={onConfirm}>
            <IconTrash className="h-4 w-4" />
            {t("common.wipe-app-data")}
          </Btn>
          <Btn onClick={() => api.quit?.()}>
            <IconClose className="h-4 w-4" />
            {t("common.quit-lumendeck")}
          </Btn>
        </div>
      )}
      <p className="mt-4 text-xs leading-relaxed text-[var(--text-faint)]">
        {t("common.wiping-removes-every-setting-your-wallpaper-vaul")}
      </p>
    </Card>
  );
}

/**
 * The log, and the button that puts it in front of the user.
 *
 * Every "attach your log to a bug report" instruction assumes the user can find
 * `%APPDATA%`, and that a 5 MB text file is something they can open. Neither
 * holds. So this shows the tail inline — the part where a failure actually
 * happened is always at the end — and offers Explorer for the full file.
 *
 * Error lines are picked out because that is what a person reads this for: the
 * timestamp is already on the line and the level is already colour-coded, so
 * the one thing missing was "skip to the part that matters".
 */
function LogViewerCard() {
  const [lines, setLines] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const { run } = usePending();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLines(await api.logTail(500));
    } catch (e) {
      useStore.getState().toast("error", t("common.log-failed-{error}", { error: truncateError(e) }));
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load once on mount: a card that needs a click before it has anything to say
  // is a card most people never open.
  useEffect(() => {
    void load();
  }, [load]);

  // Bounded again on this side, so the filter cannot produce an unbounded render
  // from an already-bounded list.
  const shown = useMemo(() => {
    if (!lines) return [];
    if (!onlyErrors) return lines;
    return lines.filter((l) => /\s(ERROR|WARN)\s/.test(l)).slice(-200);
  }, [lines, onlyErrors]);

  return (
    <Card
      title={t("common.log-file")}
      icon={<IconClipboard />}
      right={
        <div className="flex items-center gap-1.5">
          <Btn size="sm" variant="ghost" onClick={() => void load()} disabled={loading}>
            <IconRefresh className="h-4 w-4" />
            {loading ? t("common.loading") : t("common.refresh")}
          </Btn>
          <Btn
            size="sm"
            variant="ghost"
            onClick={() => {
              void run("reveal-log", () => api.revealLog());
            }}
          >
            <IconFolder className="h-4 w-4" />
            {t("common.open-folder")}
          </Btn>
        </div>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-[var(--text-dim)]">
        {t("common.attach-this-file-when-you-report-a-problem")}
      </p>

      <div className="mb-2 flex items-center gap-2">
        <Toggle
          label={t("common.problems-only")}
          checked={onlyErrors}
          onChange={setOnlyErrors}
        />
        <span className="ml-auto font-mono text-[10px] text-[var(--text-faint)]">
          {shown.length > 0
            ? t("common.showing-{n}-lines", { n: shown.length })
            : t("common.nothing-to-show")}
        </span>
      </div>

      <pre
        className="max-h-64 overflow-auto rounded-xl border border-[var(--line)] bg-black/25 p-3 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap"
        tabIndex={0}
      >
        {shown.length === 0
          ? t("common.nothing-has-been-logged-yet")
          : shown.join("\n")}
      </pre>
    </Card>
  );
}

/**
 * Build facts, configuration reload, and one button to hand them to an issue.
 *
 * Everything here is read from the running process through `dev_info`, not from
 * the frontend's build-time constants. That matters for exactly one of the
 * fields — the log level, which the backend resolves from `RUST_LOG` at
 * startup and the frontend cannot see — but a diagnostics panel that reports a
 * value it guessed is worse than no panel, because it is believed.
 *
 * "Copy details" exists because the alternative is a user transcribing six
 * values from a screenshot into GitHub, which is where bug reports die.
 */
function DeveloperCard() {
  const [info, setInfo] = useState<DevInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const { copy: copyText } = useCopy();

  useEffect(() => {
    let alive = true;
    api
      .devInfo()
      .then((i) => alive && setInfo(i))
      // A missing command means an old backend against a new frontend, which
      // is exactly the situation this section exists to diagnose. Showing the
      // failure is more useful than a panel that silently stays empty.
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const baseFacts: [string, string][] = info
    ? [
        [t("common.dev-version"), versionLabel(info.version)],
        [
          t("common.dev-build-from"),
          info.buildDirty
            ? t("common.dev-build-dirty")
            : t("common.dev-build-clean"),
        ],
        [t("common.dev-commit"), info.buildId],
        [
          t("common.dev-build"),
          info.debug ? t("common.dev-build-dev") : t("common.dev-build-release"),
        ],
        [t("common.dev-log-level"), info.logLevel.toLowerCase()],
        [t("common.dev-platform"), navigator.platform || t("common.dev-unknown")],
        [t("common.dev-config-file"), info.configPath],
        [t("common.dev-log-file"), info.logPath],
      ]
    : [];

  // A row only when there is something to say. "None" every session trains the
  // reader to skip the line, and the one session where it matters is the one
  // where it is not empty.
  const facts: [string, string][] = info?.lastPanic
    ? [...baseFacts, [t("common.dev-last-panic"), info.lastPanic]]
    : baseFacts;

  const copy = async () => {
    if (!info) return;
    // `baseFacts`, not `facts`: the report appends the panic line raw, and
    // stating it twice in one paste reads as two crashes.
    await copyText(
      buildReport(info.reportHeader, baseFacts, info.lastPanic),
      t("common.dev-details-copied"),
    );
  };

  return (
    <Card
      title={t("common.developer")}
      icon={<IconTerminal />}
      right={
        info && (
          <Btn size="sm" variant="ghost" onClick={() => void copy()}>
            <IconCopy className="h-4 w-4" />
            {t("common.dev-copy-details")}
          </Btn>
        )
      }
    >
      {failed ? (
        <InfoNote tone="warn">{t("common.dev-facts-unavailable")}</InfoNote>
      ) : (
        <>
          {info && versionDisagreement(info.version, __APP_VERSION__) && (
            // The badge shows the bundle's version and this row shows the
            // binary's. `check-versions.mjs` keeps them equal, so reaching here
            // means that guard failed — and a version skew is otherwise invisible,
            // because every command still works and every value looks plausible.
            <InfoNote tone="warn" className="mb-3">
              {t(
                "common.bundle-{bundle}-running-binary-{running}-other-windows-may-be-running-older-code",
                {
                  running: versionLabel(info.version),
                  bundle: versionLabel(__APP_VERSION__),
                },
              )}
            </InfoNote>
          )}
          <div className="panel-inset grid gap-x-6 gap-y-3 p-3.5 sm:grid-cols-2">
            {/* Placeholder rows rather than a spinner: the grid is two columns of four,
              so reserving that shape stops the card jumping when the facts land. */}
            {facts.length === 0 &&
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-8 animate-pulse rounded-sm bg-[var(--panel-sunken)]" />
              ))}
            {facts.map(([label, value]) => (
              <div key={label} className="flex min-w-0 flex-col gap-0.5">
                <span className="kicker">{label}</span>
                <span className="truncate font-mono text-xs text-[var(--text)]" title={value}>
                  {value}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mt-4 border-t border-[var(--line)] pt-4">
        <div className="text-sm font-medium text-[var(--text)]">
          {t("common.reload-configuration")}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-faint)]">
          {t("common.manual-edits-to")} <code className="font-mono">config.json</code>{" "}
          {t("common.are-picked-up-automatically-within-a-few-seconds")}
        </p>
        <div className="mt-3">
          <Btn
            onClick={async () => {
              const fresh = await api.reloadConfig();
              useStore.setState({ cfg: fresh });
            }}
          >
            <IconRefresh className="h-4 w-4" />
            {t("common.reload-now")}
          </Btn>
        </div>
      </div>
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
