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
  Select,
  Slider,
  SettingsLayout,
  ThemePicker,
  type SettingsSectionDef,
} from "../ui";
import { api } from "../../ipc";
import { usePending } from "../../pending";
import { truncateError } from "../../utilities";
import {
  checkForAppUpdate,
  installAppUpdate,
  announceUpdate,
  summaryFor,
  effectiveInterval,
  intervalChoices,
  intervalLabelKey,
} from "../../updater";

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
  IconDownload,
  IconCheck,
} from "../icons";
import { t, useLocale, LOCALE_NAMES } from "../../i18n";
import { CHECK_OUTCOME_LABELS, checkTimeLabel } from "../updateCheck";
import type { Config, DevInfo, TransferKind } from "@shared/types";
import TransferImport from "../TransferImport";
import { useCopy } from "../useCopy";
import { ConfigAvatar } from "../ConfigAvatar";
import { useConfigPicker } from "../useConfigPicker";
import { GALLERY_KIND_LABEL } from "../gallery/kindLabels";
import { RGB_MODE_LABEL } from "../../rgbModeLabels";
import { buildReport } from "../devReport";
import { versionDisagreement, versionLabel } from "../buildIdentity";

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
    label: "settings.profiles",
    blurb: "settings.capture-and-recall-a-whole-look",
    icon: IconLayers,
  },
  {
    id: "transfer",
    label: "settings.import-export",
    blurb: "settings.backup-and-move-your-setup",
    icon: IconDownload,
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

const anchorId = (id: string) => `settings-section-${id}`;

function scrollParentOf(el: HTMLElement): HTMLElement {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
    node = node.parentElement;
  }
  return document.scrollingElement as HTMLElement;
}

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
  const {
    cfg,
    save,
    wallpaperPaused,
    updateAvailable,
    setUpdateAvailable,
    updateCheck,
  } = useStore(
    useShallow((s) => ({
      cfg: s.cfg,
      save: s.save,
      wallpaperPaused: s.wallpaperPaused,
      updateAvailable: s.updateAvailable,
      setUpdateAvailable: s.setUpdateAvailable,
      updateCheck: s.updateCheck,
    })),
  );
  const check = updateCheck ?? { atMs: null, outcome: null };
  const locale = useLocale();
  const updateSummary = summaryFor(updateAvailable?.notes ?? null);
  const { pending, run } = usePending();
  const scenes = cfg?.scenes ?? [];
  const picker = useConfigPicker();
  const [section, setSection] = useState(SECTIONS[0]!.id);
  const sections = useMemo(
    () =>
      SECTIONS.filter(
        (item) =>
          item.id !== "developer" ||
          (cfg?.general.showDeveloperTools ?? true),
      ),
    [cfg?.general.showDeveloperTools],
  );
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [confirmSetup, setConfirmSetup] = useState(false);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  const scrollToSection = useCallback((id: string) => {
    const el = document.getElementById(anchorId(id));
    if (!el) return;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";
    el.scrollIntoView({ behavior, block: "start" });
    setSection(id);
  }, []);

  useEffect(() => {
    const root = pageRef.current?.parentElement;
    if (!root) return;
    const scroller = scrollParentOf(root);
    const ids = sections.map((s) => s.id);

    const sync = () => {
      const line = scroller.getBoundingClientRect().top + 96;
      let current = ids[0]!;
      for (const id of ids) {
        const el = document.getElementById(anchorId(id));
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
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
  }, [sections]);

  useEffect(() => {
    if (!sections.some((item) => item.id === section)) {
      setSection(sections[0]?.id ?? SECTIONS[0]!.id);
    }
  }, [section, sections]);

  if (!cfg) return null;

  const anchor = (id: string, node: ReactNode) => (
    <div
      id={anchorId(id)}
      className="scroll-mt-28 space-y-4 sm:space-y-5 @[48rem]:scroll-mt-4"
    >
      {node}
    </div>
  );
  return (
    <div ref={pageRef} className="@container">
      <SettingsLayout
      sections={sections}
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
          <Card title={t("common.profiles")} icon={<IconLayers />}>

            {scenes.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {scenes.map((s) => {
                  const isRunning = picker.activeId === s.id;
                  return (
                    <li
                      key={s.id}
                      className={`group flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
                        isRunning
                          ? "border-[rgb(var(--glow)/0.4)] bg-[rgb(var(--glow)/0.07)]"
                          : "border-[var(--line)] hover:border-[var(--line-strong)]"
                      }`}
                    >
                      <ConfigAvatar scene={s} size={30} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <ItemTitle className="truncate">{s.name}</ItemTitle>
                          {isRunning && (
                            <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[rgb(var(--glow))]">
                              <IconCheck className="h-3 w-3" />
                              {t("common.profile-applied-now")}
                            </span>
                          )}
                        </div>
                        <div className="truncate font-mono text-[10px] text-[var(--text-faint)]">

                          {t(GALLERY_KIND_LABEL[s.wallpaper.kind])} · {t(RGB_MODE_LABEL[s.rgb.mode])}
                          {s.stickers.length > 0 &&
                            ` · ${t("common.{n}-stickers", { n: s.stickers.length })}`}
                        </div>
                      </div>
                      <Btn
                        variant="ghost"
                        pending={pending.has(`scene-delete-${s.id}`)}
                        disabled={!picker.canDelete}
                        title={
                          picker.canDelete
                            ? t("common.delete")
                            : t("common.keep-one-profile")
                        }
                        onClick={() => {
                          if (!picker.canDelete) return;
                          void run(
                            `scene-delete-${s.id}`,
                            async () => {
                              await api.sceneDelete(s.id);
                              const fresh = await api.getConfig();
                              useStore.setState({ cfg: fresh });
                              useStore
                                .getState()
                                .undoDelete(
                                  t("common.deleted-profile", { name: s.name }),
                                  (next) => {
                                    next.scenes.push(s);
                                  },
                                );
                            },
                            (error) => {
                              useStore.getState().toast(
                                "error",
                                t("common.could-not-delete-profile-{name}-{error}", {
                                  name: s.name,
                                  error: truncateError(error, 80),
                                }),
                              );
                            },
                          );
                        }}
                      >
                        {t("common.delete")}
                      </Btn>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs text-[var(--text-faint)]">
                {t("common.no-profiles-yet-set-up-a-look-you-like-then-cap")}
              </p>
            )}
          </Card>,
        )}


        {anchor(
          "transfer",
          <TransferCard onChanged={(fresh) => useStore.setState({ cfg: fresh })} />,
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


        {cfg.general.showDeveloperTools &&
          anchor(
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

                  {cfg.general.showDeveloperTools && __APP_BUILD_ID__ && (
                    <span
                      className="rounded-sm bg-amber-500/20 px-1 text-amber-400"
                      data-tip={t("common.built-from-commit-{id}", {
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
                      {updateSummary && (
                        <span className="text-(--text-dim)">
                          {" "}
                          {updateSummary}
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
                          announceUpdate(update, { repeat: true });
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


              <div className="mt-1">
                <Select
                  label={t("common.update-check-interval")}
                  value={String(effectiveInterval(cfg?.general.updateCheckMinutes))}
                  options={intervalChoices(cfg?.general.updateCheckMinutes).map((m) => ({
                    id: String(m),
                    label: t(intervalLabelKey(m), { n: m }),
                  }))}
                  onChange={(v) =>
                    save((c) => (c.general.updateCheckMinutes = Number(v)))
                  }
                />

                <div className="mt-2 flex min-w-0 items-center gap-2 text-[11px] text-[var(--text-faint)]">
                  <span className="shrink-0">{t("update.last-check")}</span>
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      check.outcome === "failed"
                        ? "bg-amber-400"
                        : check.outcome === "update"
                          ? "bg-emerald-400"
                          : "bg-[var(--line-strong)]"
                    }`}
                  />
                  <span className="min-w-0 truncate">
                    {check.outcome ? t(CHECK_OUTCOME_LABELS[check.outcome]) : t("update.not-checked-yet")}
                  </span>
                  {check.atMs != null && (
                    <>
                      <span aria-hidden>&middot;</span>
                      <span className="shrink-0 font-mono tabular-nums">
                        {checkTimeLabel(check.atMs, Date.now(), locale)}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </Card>

            <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4">
              <Toggle
                label={t("settings.show-developer-tools")}
                description={t("settings.show-developer-tools-description")}
                checked={cfg.general.showDeveloperTools}
                onChange={(v) =>
                  save((c) => (c.general.showDeveloperTools = v))
                }
              />
            </div>


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

function TransferCard({ onChanged }: { onChanged: (cfg: Config) => void }) {
  const { run } = usePending();

  const exportTo = (kind: TransferKind, name: string) =>
    run(
      `transfer-export-${kind}`,
      async () => {
        const path = await api.transferPickSavePath(name);
        if (!path) return;
        const written = await api.transferExport(kind, path);
        useStore
          .getState()
          .toast("ok", t("settings.exported-to-{path}", { path: written }));
      },
      (e) =>
        useStore
          .getState()
          .toast("error", t("settings.export-failed-{error}", { error: truncateError(e) })),
    );

  return (
    <Card title={t("settings.import-export")} icon={<IconDownload />}>
      <p className="mb-4 text-sm leading-relaxed text-[var(--text-dim)]">
        {t("settings.export-profiles-description")}
      </p>

      <div className="flex flex-wrap gap-2.5">
        <Btn
          onClick={() => void exportTo("profiles", "lumendeck-profiles.json")}
        >
          <IconDownload className="h-4 w-4" />
          {t("settings.export-profiles")}
        </Btn>
        <Btn onClick={() => void exportTo("config", "lumendeck-config.json")}>
          <IconDownload className="h-4 w-4" />
          {t("settings.export-config")}
        </Btn>
      </div>


      <TransferImport onChanged={onChanged} className="mt-3" />

      <p className="mt-4 text-xs leading-relaxed text-[var(--text-faint)]">
        {t("settings.export-config-description")}
      </p>
    </Card>
  );
}

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

  useEffect(() => {
    void load();
  }, [load]);

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

function DeveloperCard() {
  const [info, setInfo] = useState<DevInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const { copy: copyText } = useCopy();
  const { pending: reloadPending, run: runReload } = usePending();

  useEffect(() => {
    let alive = true;
    api
      .devInfo()
      .then((i) => alive && setInfo(i))
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

  const facts: [string, string][] = info?.lastPanic
    ? [...baseFacts, [t("common.dev-last-panic"), info.lastPanic]]
    : baseFacts;

  const copy = async () => {
    if (!info) return;
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

            {facts.length === 0 &&
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-8 animate-pulse rounded-sm bg-[var(--panel-sunken)]" />
              ))}
            {facts.map(([label, value]) => (
              <div key={label} className="flex min-w-0 flex-col gap-0.5">
                <span className="kicker">{label}</span>
                <span className="truncate font-mono text-xs text-[var(--text)]" data-tip={value}>
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
            disabled={reloadPending.has("reload-config")}
            onClick={() =>
              void runReload("reload-config", async () => {
                const fresh = await api.reloadConfig();
                useStore.setState({ cfg: fresh });
              }, (e) =>
                useStore
                  .getState()
                  .toast(
                    "error",
                    t("common.reload-failed-{error}", { error: truncateError(e) }),
                  ),
              )
            }
          >
            <IconRefresh className="h-4 w-4" />
            {t("common.reload-now")}
          </Btn>
        </div>
      </div>
    </Card>
  );
}
