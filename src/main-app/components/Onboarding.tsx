import { lazy, Suspense, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useEffectiveTheme } from "../theme";
import { amoledDefault } from "./onboardingAmoled";
import { useStore } from "../store";
import { api } from "../ipc";
import {
  AppMark,
  AppWordmark,
  Btn,
  Chip,
  InfoNote,
  ItemTitle,
  ThemePicker,
  Toggle,
  displayName,
  type MonitorEntry,
} from "./ui";
import { RGB_MODES } from "@shared/constants";
import { truncateError } from "../utilities";
import { newlyAddedEntries, resolvePicked } from "./gallery/mediaKind";
import { GalleryThumb } from "./gallery/GalleryThumb";
import { autoIndexEnabled, buildAfterImport } from "./gallery/autoIndex";
import TransferImport from "./TransferImport";
import { reconcileImportedConfig } from "./onboardingImport";
import { readCache } from "./gallery/vaultIndex";
import {
  IconCheck,
  IconFolder,
  IconImage,
  IconMonitor,
  IconPalette,
  IconUpload,
  IconUser,
  IconZap,
} from "./icons";
import type { ReactNode } from "react";
import { Modal } from "./Modal";
import TitleBar from "./TitleBar";
import {
  detectSetup,
  foundCount,
  resolutionLabel,
  setupIsComplete,
  type DetectedFact,
} from "./onboardingDetect";
import type { Config, GalleryEntry, RgbMode } from "@shared/types";
import { t } from "../i18n";

const MediaPickerModal = lazy(() =>
  import("./MediaPickerModal").then((module) => ({
    default: module.MediaPickerModal,
  })),
);

const STEP_LABELS: Record<number, string> = {
  0: "onboarding.caption-detect",
  1: "onboarding.caption-requirements",
  2: "onboarding.caption-wallpaper",
  3: "onboarding.caption-import",
  4: "onboarding.caption-lighting",
  5: "onboarding.caption-mood",
  6: "onboarding.caption-config",
  7: "onboarding.caption-done",
};

const STEP_COUNT = 8;

function StepHeading({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <header className="mb-5 flex items-start gap-3.5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[rgb(var(--glow)/0.22)] bg-[rgb(var(--glow)/0.08)] text-[rgb(var(--glow))]">
        {icon}
      </span>
      <div className="min-w-0 pt-0.5">
        <h1 className="lednum text-base leading-snug text-[var(--text)] sm:text-lg">
          {title}
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[var(--text-dim)]">
          {description}
        </p>
      </div>
    </header>
  );
}

function SummaryItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2.5">
      <span className="kicker block truncate !text-[var(--text-faint)]">{label}</span>
      <div className="mt-1.5 min-w-0 text-xs text-[var(--text-dim)]">{children}</div>
    </div>
  );
}

function Stepper({
  step,
  onJump,
  needsAttention,
}: {
  step: number;
  onJump: (n: number) => void;
  needsAttention?: (n: number) => boolean;
}) {
  return (
    <nav aria-label={t("onboarding.setup-progress")} className="w-full">
      <ol className="flex w-max items-center gap-1.5 lg:w-full lg:flex-col lg:items-stretch lg:gap-1">
      {Array.from({ length: STEP_COUNT }, (_, i) => {
        const outstanding = i < step && needsAttention?.(i) === true;
        return (
          <li key={i} className="shrink-0 lg:w-full">
            <button
              onClick={() => onJump(i)}
              disabled={i >= step}
              aria-label={t(STEP_LABELS[i] ?? STEP_LABELS[0]!)}
              aria-current={i === step ? "step" : undefined}
              title={t(STEP_LABELS[i] ?? STEP_LABELS[0]!)}
              className={`group flex h-9 min-w-9 items-center justify-center gap-3 rounded-lg px-1 transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--glow)/0.6)] lg:h-auto lg:w-full lg:justify-start lg:px-2.5 lg:py-2 ${
                i === step
                  ? "bg-[rgb(var(--glow)/0.1)] text-[var(--text)] ring-1 ring-[rgb(var(--glow)/0.28)]"
                  : i < step
                    ? outstanding
                      ? "text-amber-300 hover:bg-amber-500/10"
                      : "text-[var(--text-dim)] hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
                    : "cursor-default text-[var(--text-faint)]"
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-semibold transition-colors ${
                  i === step
                    ? "border-[rgb(var(--glow)/0.55)] bg-[rgb(var(--glow)/0.16)] text-[rgb(var(--glow))]"
                    : i < step
                      ? outstanding
                        ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
                        : "border-[rgb(var(--glow)/0.25)] bg-[rgb(var(--glow)/0.08)] text-[rgb(var(--glow))]"
                      : "border-[var(--line-strong)] bg-[var(--panel)] text-[var(--text-faint)]"
                }`}
              >
                {i < step && !outstanding ? (
                  <IconCheck className="h-3.5 w-3.5" />
                ) : (
                  i + 1
                )}
              </span>
              <span className="hidden min-w-0 flex-1 truncate text-left text-xs font-medium lg:block">
                {t(STEP_LABELS[i] ?? STEP_LABELS[0]!)}
              </span>
              {outstanding && (
                <span className="hidden h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300 lg:block" />
              )}
            </button>
          </li>
        );
      })}
      </ol>
    </nav>
  );
}

function StepNav({
  onBack,
  backLabel,
  backDisabled,
  nextLabel,
  onNext,
  nextDisabled,
  nextTitle,
}: {
  onBack?: () => void;
  backLabel: string;
  backDisabled?: boolean;
  nextLabel: string;
  onNext: () => void;
  nextDisabled?: boolean;
  nextTitle?: string;
}) {
  return (
    <div className="mt-6 flex items-center justify-between gap-3">
      {onBack ? (
        <Btn variant="ghost" onClick={onBack} disabled={backDisabled}>
          {backLabel}
        </Btn>
      ) : (
        <span />
      )}
      <Btn
        variant="primary"
        onClick={onNext}
        disabled={nextDisabled}
        title={nextTitle}
      >
        {nextLabel}
      </Btn>
    </div>
  );
}

function PickTile({
  entry,
  active,
  compact,
  disabled,
  onPick,
}: {
  entry: GalleryEntry;
  active: boolean;
  compact?: boolean;
  disabled?: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      aria-pressed={active}
      title={entry.name}
      className={`group relative flex w-full flex-col overflow-hidden rounded-xl border bg-[var(--panel-strong)] text-left transition-all duration-[var(--motion-slow)] ease-[var(--ease-standard)] hover:-translate-y-0.5 hover:shadow-[var(--shadow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--glow)/0.7)] disabled:pointer-events-none disabled:opacity-50 ${
        active
          ? "border-[rgb(var(--glow)/0.7)] ring-2 ring-[rgb(var(--glow)/0.22)]"
          : "border-[var(--line)] hover:border-[var(--line-strong)]"
      }`}
    >
      <div className="relative aspect-video w-full overflow-hidden">
        <div className="absolute inset-0 transition-transform duration-[var(--motion-slow)] ease-[var(--ease-standard)] group-hover:scale-[1.05]">
          <GalleryThumb entry={entry} />
        </div>
        {active && !compact && (
          <span className="absolute right-1.5 top-1.5">
            <Chip tone="accent">{t("onboarding.applied-now")}</Chip>
          </span>
        )}
      </div>
      {!compact && (
        <div className="flex items-center justify-between gap-2 px-2.5 py-2">
          <span className="min-w-0 truncate text-[12px] text-[var(--text-dim)]">
            {entry.name}
          </span>
          {!active && (
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-[rgb(var(--glow))]">
              {t("onboarding.apply")}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const { cfg, save, rgb } = useStore(
    useShallow((s) => ({ cfg: s.cfg, save: s.save, rgb: s.rgb })),
  );
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const goTo = (next: number) => {
    setDirection(next >= step ? 1 : -1);
    setStep(next);
  };
  const [busy, setBusy] = useState(false);
  const [urlMode, setUrlMode] = useState(false);
  const [pickerMode, setPickerMode] = useState<"files" | "folder" | null>(null);
  const [url, setUrl] = useState("");
  const [added, setAdded] = useState<GalleryEntry[]>([]);
  const [importSource, setImportSource] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [facts, setFacts] = useState<DetectedFact[] | null>(null);
  const [detecting, setDetecting] = useState(true);
  const [primary, setPrimary] = useState<{ w: number; h: number } | null>(null);
  const [monitors, setMonitors] = useState<MonitorEntry[]>([]);
  const [openrgbPath, setOpenrgbPath] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [amoledTouched, setAmoledTouched] = useState(false);
  const theme = useEffectiveTheme(cfg?.general.theme);
  const toast = (tone: "error" | "ok", msg: string) =>
    useStore.getState().toast(tone, msg);

  useEffect(() => {
    const next = amoledDefault(theme, amoledTouched);
    if (next === null || !cfg || (cfg.general.amoled ?? false) === next) return;
    save((c) => {
      c.general.amoled = next;
    });
  }, [theme, amoledTouched, cfg, save]);

  const runDetect = async () => {
    setDetecting(true);
    const [mons, vol] = await Promise.all([
      api.monitors().catch(() => [] as MonitorEntry[]),
      api.volumeGet().catch(() => null),
    ]);
    const s = useStore.getState();
    const prim = mons.find((m) => m.primary) ?? mons[0];
    setPrimary(prim ? { w: prim.w, h: prim.h } : null);
    setMonitors(mons);
    setFacts(
      detectSetup({
        monitorCount: mons.length,
        primaryWidth: prim?.w ?? null,
        primaryHeight: prim?.h ?? null,
        rgbConnected: s.rgb.connected,
        rgbDeviceCount: s.rgb.devices.length,
        vaultCount: s.cfg?.gallery.length ?? 0,
        audioAvailable: Array.isArray(vol) && vol.length === 2 && typeof vol[0] === "number",
      }),
    );
    setDetecting(false);
  };

  useEffect(() => {
    void runDetect();
  }, []);

  useEffect(() => {
    if (step === 1) void readOpenrgb();
  }, [step]);

  if (!cfg) return null;

  const finish = () => {
    setBusy(true);
    save((c) => {
      c.general.onboarded = true;
    }).finally(() => {
      setBusy(false);
      onDone();
    });
  };

  const createProfile = async () => {
    const name = profileName.trim();
    if (name.length === 0) {
      toast("error", t("onboarding.profile-name-required"));
      return;
    }
    setBusy(true);
    try {
      await api.sceneSave(name);
      useStore.setState({ cfg: await api.getConfig() });
    } catch (e) {
      toast("error", t("common.save-failed-{error}", { error: truncateError(e) }));
      setBusy(false);
      return;
    }
    setBusy(false);
    finish();
  };

  const applyWallpaperAndContinue = async () => {
    setBusy(true);
    try {
      const target = activeEntry ?? cfg.gallery[0];
      if (target) await api.galleryApply(target.id);
      goTo(3);
    } catch (e) {
      toast("error", t("onboarding.apply-failed-{error}", { error: truncateError(e) }));
    } finally {
      setBusy(false);
    }
  };

  const indexNewMedia = async (fresh: Config, count: number) => {
    if (!autoIndexEnabled(fresh.wallpaper)) return;
    if (count <= 0) return;
    try {
      await buildAfterImport({
        added: count,
        building: false,
        entries: fresh.gallery,
        index: readCache(),
      });
    } catch {
      // See above: the media is in the vault, only the measurement is missing.
    }
  };

  const importFiles = async (paths: string[]) => {
    setBusy(true);
    try {
      const picked = resolvePicked(paths);
      if (picked.length === 0) return;
      const before = useStore.getState().cfg?.gallery ?? [];
      const list = await api.galleryImportPaths(picked.map((file) => file.path));
      const addedEntries = newlyAddedEntries(before, list);
      setAdded((prev) => [...prev, ...addedEntries]);
      const fresh = await api.getConfig();
      useStore.setState({ cfg: fresh });
      await indexNewMedia(fresh, addedEntries.length);
      toast("ok", t("common.added-to-vault"));
    } catch (e) {
      toast("error", t("onboarding.import-failed-{error}", { error: truncateError(e) }));
    } finally {
      setBusy(false);
    }
  };

  const importFolder = async (folder: string) => {
    setBusy(true);
    try {
      const before = useStore.getState().cfg?.gallery ?? [];
      const list = await api.galleryImportFolder(folder);
      const addedEntries = newlyAddedEntries(before, list);
      setAdded((prev) => [...prev, ...addedEntries]);
      setImportSource(folder);
      const fresh = await api.getConfig();
      useStore.setState({ cfg: fresh });
      await indexNewMedia(fresh, addedEntries.length);
      toast("ok", t("onboarding.imported-{n}-items", { n: addedEntries.length }));
    } catch (e) {
      toast("error", t("onboarding.folder-import-failed-{error}", { error: truncateError(e) }));
    } finally {
      setBusy(false);
    }
  };

  const applyChoice = async (id: string) => {
    setBusy(true);
    try {
      await api.galleryApply(id);
      toast("ok", t("common.wallpaper-applied"));
      useStore.setState({ cfg: await api.getConfig() });
    } catch (e) {
      toast("error", t("onboarding.apply-failed-{error}", { error: truncateError(e) }));
    } finally {
      setBusy(false);
    }
  };

  const importUrl = async () => {
    if (!url.trim()) return;
    setBusy(true);
    try {
      const before = useStore.getState().cfg?.gallery ?? [];
      const entry = await api.galleryAddFromUrl(url.trim());
      const addedEntries = newlyAddedEntries(before, [entry]);
      setAdded((prev) => [...prev, ...addedEntries]);
      setUrl("");
      setUrlMode(false);
      const fresh = await api.getConfig();
      useStore.setState({ cfg: fresh });
      await indexNewMedia(fresh, addedEntries.length);
      toast("ok", t("onboarding.downloaded-{name}", { name: entry.name }));
    } catch (e) {
      toast("error", t("onboarding.url-import-failed-{error}", { error: truncateError(e) }));
    } finally {
      setBusy(false);
    }
  };

  const fact = (id: DetectedFact["id"]) => facts?.find((f) => f.id === id);

  const readOpenrgb = async () => {
    try {
      const st = await api.openrgbStatus();
      setOpenrgbPath(st.installedAt);
    } catch {
      // A status read that fails is not worth blocking setup over; the step
      // falls back to offering the download, which is what it would have
      // offered on a machine with nothing installed anyway.
    }
  };

  const startOpenrgbAt = async (exe: string) => {
    await api.openrgbLaunch(exe);
    await api.rgbRefresh();
    useStore.getState().setRgb(await api.rgbStatus());
    await runDetect();
  };

  const installOpenrgb = async () => {
    setFetching(true);
    try {
      const exe = await api.openrgbInstall();
      setOpenrgbPath(exe);
      await startOpenrgbAt(exe);
      toast("ok", t("onboarding.openrgb-started"));
    } catch (e) {
      toast("error", t("onboarding.openrgb-install-failed-{error}", { error: truncateError(e) }));
    } finally {
      setFetching(false);
    }
  };

  const launchOpenrgb = async () => {
    if (!openrgbPath) return;
    setFetching(true);
    try {
      await startOpenrgbAt(openrgbPath);
      toast("ok", t("onboarding.openrgb-started"));
    } catch (e) {
      toast("error", t("onboarding.openrgb-launch-failed-{error}", { error: truncateError(e) }));
    } finally {
      setFetching(false);
    }
  };

  const openrgbRunning = rgb.connected && rgb.devices.length > 0;

  const willDownload = !openrgbPath && !openrgbRunning;

  const requirementCopy = {
    hint: openrgbRunning
      ? t("onboarding.openrgb-running")
      : openrgbPath
        ? t("onboarding.openrgb-installed-not-running")
        : t("onboarding.openrgb-not-installed"),
    chip: openrgbRunning
      ? t("onboarding.ready")
      : openrgbPath
        ? t("onboarding.on")
        : t("onboarding.none"),
    action: fetching
      ? openrgbPath
        ? t("onboarding.openrgb-starting")
        : t("onboarding.openrgb-installing")
      : openrgbPath
        ? t("onboarding.start-openrgb")
        : t("onboarding.download-and-start-openrgb"),
  } as const;

  const otherDisplays = monitors.filter((m) => !m.primary);
  const res = resolutionLabel(primary?.w ?? null, primary?.h ?? null);
  const complete = facts !== null && setupIsComplete(facts);
  const activeEntry =
    cfg.gallery.find(
      (g) => g.kind === cfg.wallpaper.kind && g.source === cfg.wallpaper.source,
    ) ?? null;
  const mode =
    RGB_MODES.find((m) => m.id === cfg.rgb.mode) ?? RGB_MODES[0]!;

  const moodModes = () =>
    RGB_MODES.filter(
      (m) =>
        m.group === "reactive" ||
        m.id === "breathe" ||
        (m.id === "audioReactive" && fact("audio")?.ok),
    );

  const vaultGrid = (entries: GalleryEntry[]) => (
    <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
      {entries.map((g) => (
        <PickTile
          key={g.id}
          entry={g}
          active={cfg.wallpaper.kind === g.kind && cfg.wallpaper.source === g.source}
          disabled={busy}
          onPick={() => void applyChoice(g.id)}
        />
      ))}
    </div>
  );

  const factRow = (id: DetectedFact["id"], label: string, hint: string | null) => {
    const f = fact(id);
    return (
      <div key={id} className="min-w-0 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-xs font-semibold text-[var(--text)]">{label}</span>
          <Chip tone={f?.ok ? "ok" : "idle"} pulse={detecting}>
            {f?.ok ? t("onboarding.ready") : t("onboarding.none")}
          </Chip>
        </div>
        {hint && (
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-faint)]">
            {hint}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="grain relative flex h-screen flex-col overflow-hidden">
      <div className="aura" />
      <TitleBar />
      <div className="relative z-10 min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col justify-center px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <div className="mb-5 flex items-center justify-between gap-4">
          <span className="flex min-w-0 items-center gap-2.5">
            <AppMark size={22} pulse={step === 0} />
            <AppWordmark size={22} />
          </span>
          <span className="shrink-0 rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-dim)]">
            {t("onboarding.step-{n}-of-{total}", { n: step + 1, total: STEP_COUNT })}
          </span>
        </div>

        <div className="mb-3 overflow-x-auto pb-1 lg:hidden">
          <Stepper
            step={step}
            onJump={goTo}
            needsAttention={(i) => i === 1 && !openrgbRunning}
          />
        </div>

        <div className="grid min-w-0 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-6">
          <aside className="hidden rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-3 lg:block">
            <Stepper
              step={step}
              onJump={goTo}
              needsAttention={(i) => i === 1 && !openrgbRunning}
            />
          </aside>

          <main className="min-w-0">
            <div className="mb-3 flex items-center gap-3 px-1">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[rgb(var(--glow))] shadow-[0_0_8px_rgb(var(--glow)/0.65)]" />
              <span className="kicker truncate lg:hidden">{t(STEP_LABELS[step] ?? STEP_LABELS[0]!)}</span>
              <div
                className="ml-auto h-1 w-20 shrink-0 overflow-hidden rounded-full bg-[var(--line-strong)] sm:w-28"
                role="progressbar"
                aria-label={t("onboarding.setup-progress")}
                aria-valuemin={1}
                aria-valuemax={STEP_COUNT}
                aria-valuenow={step + 1}
              >
                <div
                  className="h-full rounded-full bg-[rgb(var(--glow))] transition-[width] duration-[var(--motion-base)]"
                  style={{ width: `${((step + 1) / STEP_COUNT) * 100}%` }}
                />
              </div>
            </div>

            <section
              key={step}
              className={`glass p-5 sm:p-7 lg:p-8 step-enter-${direction === 1 ? "forward" : "back"}`}
            >
          {step === 0 && (
            <>
              <StepHeading
                icon={<IconMonitor className="h-5 w-5" />}
                title={
                  detecting || !facts
                    ? t("onboarding.checking")
                    : t("onboarding.we-checked-your-setup")
                }
                description={t("onboarding.here-is-what-we-found")}
              />

              <div className="mt-5">
                <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] p-3 sm:p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <Chip tone={complete ? "ok" : "idle"} pulse={detecting}>
                      {facts
                        ? t("onboarding.{found}-of-{total}-detected", {
                            found: foundCount(facts),
                            total: facts.length,
                          })
                        : t("onboarding.checking")}
                    </Chip>
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={() => void runDetect()}
                      disabled={detecting}
                    >
                      {t("onboarding.check-again")}
                    </Btn>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                  {factRow(
                    "displays",
                    t("onboarding.displays"),
                    fact("displays")?.ok
                      ? [
                          res
                            ? fact("displays")!.count > 1
                              ? `${t("onboarding.primary-display")} · ${res}`
                              : res
                            : t("onboarding.resolution-unknown"),
                          ...otherDisplays.map((m, i) =>
                            `${displayName(m, i + 1, cfg.general.screenNames)} · ${resolutionLabel(m.w, m.h)}`,
                          ),
                        ].join("  ·  ")
                      : t("onboarding.no-displays-found"),
                  )}
                  {factRow(
                    "lighting",
                    t("onboarding.lighting-devices"),
                    fact("lighting")?.ok
                      ? t("onboarding.{n}-lighting-devices-found", {
                          n: fact("lighting")!.count,
                        })
                      : rgb.connected
                        ? t("onboarding.no-lighting-found")
                        : t("onboarding.no-openrgb-server"),
                  )}
                  {factRow(
                    "vault",
                    t("onboarding.vault-contents"),
                    fact("vault")?.ok
                      ? t("onboarding.{n}-items-found", { n: fact("vault")!.count })
                      : t("onboarding.empty-vault"),
                  )}
                  {factRow(
                    "audio",
                    t("onboarding.audio-output"),
                    fact("audio")?.ok ? null : t("onboarding.no-audio-found"),
                  )}
                  </div>
                </div>
              </div>

              <InfoNote className="mt-3">
                {t("onboarding.detection-only-reads-your-machine")}
              </InfoNote>


              <div className="mt-5 border-t border-[var(--line)] pt-5">
                <div className="flex items-center gap-3">
                  <IconUpload className="h-5 w-5 text-[rgb(var(--glow))]" />
                  <h2 className="lednum text-base text-[var(--text)]">
                    {t("onboarding.already-set-up-on-another-machine")}
                  </h2>
                </div>
                <TransferImport
                  className="mt-3"
                  description={t("onboarding.import-a-previous-setup-description")}
                  onChanged={(fresh) => {
                    const { store, landing } = reconcileImportedConfig(fresh, openrgbRunning);
                    useStore.setState({ cfg: store });
                    setAmoledTouched(true);
                    setAdded([]);
                    setImportSource(null);
                    void runDetect();
                    goTo(landing === "receipt" ? 7 : landing === "requirements" ? 1 : 6);
                  }}
                />
              </div>

              <StepNav
                onBack={finish}
                backLabel={t("onboarding.skip-setup")}
                backDisabled={detecting}
                nextLabel={t("onboarding.continue")}
                onNext={() => goTo(1)}
                nextDisabled={detecting}
              />
            </>
          )}

          {step === 1 && (
            <>
              <StepHeading
                icon={<IconZap className="h-5 w-5" />}
                title={t("onboarding.requirements-title")}
                description={t("onboarding.requirements-led")}
              />

              <div className="mt-5 rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
                    openrgbRunning
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : "border-[var(--line)] bg-[var(--panel-sunken)] text-[rgb(var(--glow))]"
                  }`}>
                    <IconZap className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <ItemTitle>{t("common.openrgb")}</ItemTitle>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--text-faint)]">
                      {requirementCopy.hint}
                    </p>
                  </div>
                  <Chip
                    tone={openrgbRunning ? "ok" : openrgbPath ? "warn" : "idle"}
                    pulse={fetching}
                  >
                    {requirementCopy.chip}
                  </Chip>
                </div>

                <div className="mt-4 border-t border-[var(--line)] pt-4">
                  {openrgbRunning ? (
                    <div className="flex items-start gap-2 text-[12px] leading-relaxed text-[var(--text-dim)]">
                      <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      <span>{t("onboarding.openrgb-running-note")}</span>
                    </div>
                  ) : (
                    <>
                      <Btn
                        variant="primary"
                        className="w-full"
                        pending={fetching}
                        disabled={fetching}
                        onClick={() =>
                          void (openrgbPath ? launchOpenrgb() : installOpenrgb())
                        }
                      >
                        {requirementCopy.action}
                      </Btn>

                      {openrgbPath && (
                        <p className="mt-2 break-all font-mono text-[10px] text-[var(--text-faint)]">
                          {openrgbPath}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>


              {willDownload && (
                <InfoNote className="mt-3">{t("onboarding.requirements-verified")}</InfoNote>
              )}

              <StepNav
                onBack={() => goTo(0)}
                backLabel={t("onboarding.back")}
                nextLabel={t("onboarding.continue")}
                onNext={() => goTo(2)}
                nextDisabled={fetching}
              />
            </>
          )}

          {step === 2 && (
            <>
              <StepHeading
                icon={<IconImage className="h-5 w-5" />}
                title={t("onboarding.welcome-to-lumendeck")}
                description={t("onboarding.live-wallpapers-that-light-up-your-room-and-your")}
              />

              <div className="mt-5">
                <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] p-4">
                  {cfg.gallery.length > 0 ? (
                    <>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="kicker">
                          {t("onboarding.{n}-wallpapers-in-your-vault", {
                            n: cfg.gallery.length,
                          })}
                        </div>
                      </div>
                      {vaultGrid(cfg.gallery)}
                      <p className="mt-2.5 text-dim-sm">
                        {t("onboarding.we'll-apply-your-first-one-now-browse-the-vault")}
                      </p>
                    </>
                  ) : (
                    <div>
                      <ItemTitle>{t("onboarding.your-vault-is-empty")}</ItemTitle>
                      <div className="mt-1 text-xs text-[var(--text-faint)]">
                        {t("onboarding.import-from-the-wallpaper-tab-after-setup-or-kee")}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <StepNav
                onBack={() => goTo(1)}
                backLabel={t("onboarding.back")}
                nextLabel={
                  cfg.gallery.length > 0 && !activeEntry
                    ? t("onboarding.use-my-first-wallpaper")
                    : t("onboarding.continue")
                }
                onNext={() => void applyWallpaperAndContinue()}
                nextDisabled={busy}
              />
            </>
          )}

          {step === 3 && (
            <>
              <StepHeading
                icon={<IconFolder className="h-5 w-5" />}
                title={t("onboarding.bring-in-your-media")}
                description={t("onboarding.fill-the-vault-with-videos-images-or-folders-you")}
              />

              <div className="mt-5">
                <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] p-4">
                  {added.length > 0 && (
                    <>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="kicker">
                          {importSource
                            ? t("onboarding.imported-from-{name}", {
                                name: importSource.split(/[\\/]/).filter(Boolean).pop() ?? importSource,
                              })
                            : t("onboarding.set-one-as-your-wallpaper-now")}
                        </div>
                        <span className="font-mono text-[10px] text-[var(--text-faint)]">
                          {t("onboarding.{n}-items-found", { n: added.length })}
                        </span>
                      </div>

                      {vaultGrid(added)}
                      <p className="mt-2.5 text-dim-sm">
                        {t("onboarding.pick-a-thumbnail-to-put-it-on-your-screen")}
                      </p>
                    </>
                  )}

                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {urlMode ? (
                      <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 sm:col-span-2">
                        <div className="flex gap-2">
                          <input
                            autoFocus
                            type="url"
                            placeholder="https://example.com/wallpaper.mp4"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && importUrl()}
                            className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--panel-sunken)] px-3 py-2 text-sm outline-none focus:border-[rgb(var(--glow)/0.5)]"
                          />
                          <Btn
                            variant="primary"
                            size="sm"
                            disabled={busy || !url.trim()}
                            onClick={importUrl}
                          >
                            {t("onboarding.download")}
                          </Btn>
                          <Btn variant="ghost" size="sm" onClick={() => setUrlMode(false)}>
                            {t("onboarding.cancel")}
                          </Btn>
                        </div>
                        <p className="mt-2 text-dim-sm">
                          {t("onboarding.direct-link-to-an-mp4-webm-video-or-png-jpg-webp")}
                        </p>
                      </div>
                    ) : (
                      <>
                        <ImportButton
                          onClick={() => setPickerMode("files")}
                          disabled={busy}
                          icon={<IconImage className="h-4 w-4" />}
                          title={t("onboarding.import-a-file")}
                          hint={t("onboarding.a-video-or-image-from-your-pc")}
                          action={t("onboarding.pick")}
                        />
                        <ImportButton
                          onClick={() => setPickerMode("folder")}
                          disabled={busy}
                          icon={<IconFolder className="h-4 w-4" />}
                          title={t("onboarding.import-a-folder")}
                          hint={t("onboarding.every-video-and-image-inside-in-one-go")}
                          action={t("onboarding.pick")}
                        />
                        <ImportButton
                          onClick={() => setUrlMode(true)}
                          disabled={busy}
                          icon={<IconUpload className="h-4 w-4" />}
                          title={t("onboarding.from-a-url")}
                          hint={t("onboarding.download-a-wallpaper-from-a-direct-link")}
                          action={t("onboarding.link")}
                        />
                      </>
                    )}
                  </div>
                </div>
              </div>

              <StepNav
                onBack={() => goTo(2)}
                backLabel={t("onboarding.back")}
                nextLabel={
                  added.length > 0 ? t("onboarding.continue") : t("onboarding.skip-later")
                }
                onNext={() => goTo(4)}
                nextDisabled={busy}
              />
            </>
          )}

          {step === 4 && (
            <>
              <StepHeading
                icon={<IconZap className="h-5 w-5" />}
                title={t("onboarding.sync-your-rgb-lighting")}
                description={t("onboarding.connect-to-openrgb-to-have-your-devices-follow-t")}
              />

              <div className="mt-5">
                <div className={`relative overflow-hidden rounded-xl border bg-[var(--panel-strong)] p-4 sm:p-5 ${
                  rgb.connected
                    ? "border-emerald-500/25"
                    : "border-[var(--line)]"
                }`}>
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_100%_0%,rgb(var(--glow)/0.1),transparent_55%)]"
                  />
                  <div className="relative">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
                        rgb.connected
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                          : "border-[var(--line)] bg-[var(--panel-sunken)] text-[var(--text-faint)]"
                      }`}>
                        <IconZap className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                      <ItemTitle>
                        {rgb.connected
                          ? t("onboarding.{n}-devices-detected", { n: rgb.devices.length })
                          : t("onboarding.openrgb-not-detected")}
                      </ItemTitle>
                      <div className="mt-0.5 text-xs text-[var(--text-faint)]">
                        {rgb.connected
                          ? t("onboarding.you're-set-devices-will-follow-the-modes-on-the")
                          : t("onboarding.start-openrgb-with-the-server-enabled-then-retry")}
                      </div>
                      </div>
                    </div>
                    {!rgb.connected && (
                      <Btn
                        size="sm"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await api.rgbRefresh();
                            useStore.setState({ cfg: await api.getConfig() });
                            useStore.getState().setRgb(await api.rgbStatus());
                            await runDetect();
                          } catch {
                            // status stays offline; the copy above reflects it
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {t("onboarding.retry")}
                      </Btn>
                    )}
                  </div>


                  {rgb.connected && rgb.devices.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-1.5 border-t border-[var(--line)] pt-3">
                      {rgb.devices.map((d) => (
                        <Chip key={d.id} tone="accent">
                          {t("common.{mode}-{leds}-leds", { mode: d.name, leds: d.leds })}
                        </Chip>
                      ))}
                    </div>
                  )}
                  </div>
                </div>
              </div>

              <StepNav
                onBack={() => goTo(3)}
                backLabel={t("onboarding.back")}
                nextLabel={
                  rgb.connected ? t("onboarding.continue") : t("onboarding.skip-this-step")
                }
                onNext={() => goTo(5)}
                nextDisabled={busy}
              />
            </>
          )}

          {step === 5 && (
            <>
              <StepHeading
                icon={<IconPalette className="h-5 w-5" />}
                title={t("onboarding.your-lighting-mood")}
                description={t("onboarding.pick-how-your-devices-behave-ambient-follows-the")}
              />

              <div className="mt-5">
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {moodModes().map((m) => {
                    const active = cfg.rgb.mode === m.id;
                    return (
                      <button
                        type="button"
                        key={m.id}
                        aria-pressed={active}
                        onClick={() => save((c) => (c.rgb.mode = m.id as RgbMode))}
                        className={`group rounded-xl border p-3.5 text-left transition-all duration-[var(--motion-fast)] ease-[var(--ease-standard)] active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--glow)/0.65)] ${
                          active
                            ? "border-[rgb(var(--glow)/0.6)] bg-[rgb(var(--glow)/0.08)] ring-1 ring-[rgb(var(--glow)/0.3)]"
                            : "border-[var(--line)] bg-[var(--panel)] hover:border-[var(--line-strong)] hover:bg-[var(--panel-strong)]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <ItemTitle>{t(m.label)}</ItemTitle>
                          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                            active
                              ? "border-[rgb(var(--glow)/0.55)] bg-[rgb(var(--glow)/0.15)] text-[rgb(var(--glow))]"
                              : "border-[var(--line-strong)] text-transparent"
                          }`}>
                            <IconCheck className="h-3 w-3" />
                          </span>
                        </div>
                        <div className="mt-2 text-[11px] leading-relaxed text-[var(--text-faint)]">
                          {t(m.hint)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {fact("audio")?.ok && (
                <InfoNote className="mt-3">
                  {t("onboarding.audio-reactive-is-offered")}
                </InfoNote>
              )}

              <StepNav
                onBack={() => goTo(4)}
                backLabel={t("onboarding.back")}
                nextLabel={t("onboarding.continue")}
                onNext={() => goTo(6)}
                nextDisabled={busy}
              />
            </>
          )}

          {step === 6 && (
            <>
              <StepHeading
                icon={<IconPalette className="h-5 w-5" />}
                title={t("onboarding.common-settings")}
                description={t("onboarding.the-toggles-most-people-change-you-can-fine-tune")}
              />

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <section className="rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] px-4">
                  <ThemePicker
                    value={cfg.general.theme}
                    onChange={(v) => save((c) => (c.general.theme = v))}
                  />
                  <Toggle
                    label={t("onboarding.amoled-mode")}
                    description={
                      theme === "dark" && (cfg.general.amoled ?? false)
                        ? t("onboarding.amoled-switched-on-for-dark")
                        : t("onboarding.true-black-dashboard-in-dark-theme-ideal-for-ole")
                    }
                    checked={cfg.general.amoled ?? false}
                    onChange={(v) => {
                      setAmoledTouched(true);
                      save((c) => (c.general.amoled = v));
                    }}
                  />
                </section>
                <section className="rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] px-4">
                  <Toggle
                    label={t("onboarding.launch-at-startup")}
                    description={t("onboarding.start-lumendeck-with-windows")}
                    checked={cfg.general.autostart}
                    onChange={(v) => save((c) => (c.general.autostart = v))}
                  />
                  <div className="border-t border-[var(--line)]" />
                  <Toggle
                    label={t("onboarding.pause-on-fullscreen-apps")}
                    description={t("onboarding.pause-on-fullscreen-description")}
                    checked={cfg.general.pauseOnFullscreen}
                    onChange={(v) => save((c) => (c.general.pauseOnFullscreen = v))}
                  />
                  <Toggle
                    label={t("onboarding.pause-on-battery")}
                    description={t("onboarding.freeze-the-wallpaper-while-unplugged-recommended")}
                    checked={cfg.general.pauseOnBatterySaver}
                    onChange={(v) => save((c) => (c.general.pauseOnBatterySaver = v))}
                  />
                </section>
                <section className="rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] px-4 md:col-span-2 md:grid md:grid-cols-2 md:gap-4">
                  <Toggle
                    label={t("onboarding.windows-accent-follows-wallpaper")}
                    description={t("onboarding.taskbar-and-window-highlights-shift-tone-with-yo")}
                    checked={cfg.general.accentSyncEnabled}
                    onChange={(v) => save((c) => (c.general.accentSyncEnabled = v))}
                  />
                  <Toggle
                    label={t("onboarding.stickers-on-all-monitors")}
                    description={t("onboarding.mirror-wallpaper-stickers-onto-every-display")}
                    checked={cfg.sticker?.allMonitors ?? true}
                    onChange={(v) =>
                      save((c) => (c.sticker = { ...c.sticker, allMonitors: v }))
                    }
                  />
                </section>
              </div>

              <StepNav
                onBack={() => goTo(5)}
                backLabel={t("onboarding.back")}
                nextLabel={t("onboarding.next")}
                onNext={() => goTo(7)}
                nextDisabled={busy}
              />
            </>
          )}

          {step === 7 && (
            <>
              <StepHeading
                icon={<IconCheck className="h-5 w-5" />}
                title={
                  facts === null
                    ? t("onboarding.checking")
                    : complete
                      ? t("onboarding.your-setup-is-ready")
                      : t("onboarding.still-needs-attention")
                }
                description={t("onboarding.ready-in-under-a-minute")}
              />

              <div className="mt-5">
                <div className="grid gap-2 sm:grid-cols-2">
                  <SummaryItem label={t("onboarding.summary-displays")}>
                    {fact("displays")?.ok ? res || t("onboarding.resolution-unknown") : t("onboarding.none")}
                  </SummaryItem>
                  <SummaryItem label={t("onboarding.summary-lighting")}>
                    {fact("lighting")?.ok
                      ? t("onboarding.{n}-devices-detected", { n: fact("lighting")!.count })
                      : rgb.connected
                        ? t("onboarding.no-lighting-found")
                        : t("onboarding.no-openrgb-server")}
                  </SummaryItem>
                  <SummaryItem label={t("onboarding.summary-mode")}>{t(mode.label)}</SummaryItem>
                  <SummaryItem label={t("onboarding.summary-vault")}>
                    {cfg.gallery.length > 0
                      ? t("onboarding.{n}-items-found", { n: cfg.gallery.length })
                      : t("onboarding.empty-vault")}
                  </SummaryItem>
                  <SummaryItem label={t("onboarding.summary-wallpaper")}>
                    <span className="flex min-w-0 items-center gap-2">
                      {activeEntry && (
                        <span className="block w-14 shrink-0 overflow-hidden rounded-md border border-[var(--line)]">
                          <span className="block aspect-video">
                            <GalleryThumb entry={activeEntry} />
                          </span>
                        </span>
                      )}
                      <span className="min-w-0 truncate">{activeEntry?.name ?? t("onboarding.none")}</span>
                    </span>
                  </SummaryItem>
                  <SummaryItem label={t("onboarding.summary-autostart")}>
                    {cfg.general.autostart ? t("onboarding.on") : t("onboarding.off")}
                  </SummaryItem>
                </div>
              </div>

              <div className="mt-5 border-t border-[var(--line)] pt-5">
                <div className="flex items-center gap-3">
                  <IconUser className="h-5 w-5 text-[rgb(var(--glow))]" />
                  <h2 className="lednum text-base text-[var(--text)]">
                    {t("onboarding.name-your-profile")}
                  </h2>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-[var(--text-dim)]">
                  {t("onboarding.profiles-are-one-click-away-from-this-look")}
                </p>
                <input
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !busy && void createProfile()}
                  placeholder={t("common.name-this-look-e-g-night-gaming")}
                  className="mt-4 w-full rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[rgb(var(--glow)/0.5)] focus:outline-none"
                />
              </div>

              <StepNav
                onBack={finish}
                backLabel={t("onboarding.skip-setup")}
                backDisabled={busy}
                nextLabel={busy ? t("onboarding.saving-your-look") : t("onboarding.create-profile")}
                onNext={() => void createProfile()}
                nextDisabled={busy || profileName.trim().length === 0}
                nextTitle={
                  profileName.trim().length === 0 && !busy
                    ? t("onboarding.profile-name-required")
                    : undefined
                }
              />
            </>
          )}
        </section>

        <div className="mt-4 text-center">
          <button
            onClick={finish}
            disabled={busy}
            className="font-mono text-[10px] tracking-widest text-[var(--text-faint)] uppercase transition-colors hover:text-[var(--text-dim)] disabled:opacity-50"
          >
            {t("onboarding.skip-set-up-later-in-settings")}
          </button>
        </div>
        {pickerMode && (
          <Modal
            title={t(
              pickerMode === "files"
                ? "gallery.select-wallpapers"
                : "gallery.choose-wallpaper-folder",
            )}
            onClose={() => setPickerMode(null)}
            style={{ maxWidth: "56rem", maxHeight: "calc(100dvh - 2rem)" }}
            className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
          >
            <Suspense fallback={<div className="min-h-48" />}>
              <MediaPickerModal
                initialMode={pickerMode}
                onImportFiles={(paths) => {
                  setPickerMode(null);
                  void importFiles(paths);
                }}
                onImportFolder={(path) => {
                  setPickerMode(null);
                  void importFolder(path);
                }}
              />
            </Suspense>
          </Modal>
        )}
          </main>
        </div>
      </div>
      </div>
    </div>
  );
}

function ImportButton({
  onClick,
  disabled,
  icon,
  title,
  hint,
  action,
}: {
  onClick: () => void;
  disabled: boolean;
  icon: ReactNode;
  title: string;
  hint: string;
  action: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex min-h-28 w-full flex-col items-start justify-between rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-[rgb(var(--glow)/0.45)] hover:bg-[var(--panel-strong)] motion-reduce:transform-none motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--glow)/0.6)] disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="flex w-full items-start justify-between gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--panel-sunken)] text-[rgb(var(--glow))] transition-colors group-hover:border-[rgb(var(--glow)/0.3)]">
          {icon}
        </span>
        <span className="shrink-0 rounded-full bg-[rgb(var(--glow)/0.08)] px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-[rgb(var(--glow))]">
          {action}
        </span>
      </span>
      <span className="mt-3 block min-w-0">
        <ItemTitle as="span">{title}</ItemTitle>
        <span className="mt-0.5 block text-xs leading-relaxed text-[var(--text-faint)]">{hint}</span>
      </span>
    </button>
  );
}