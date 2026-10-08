import { useEffect, useState } from "react";
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
  Row,
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
import { IconCheck, IconSparkle, IconUpload, IconUser } from "./icons";
import {
  detectSetup,
  foundCount,
  resolutionLabel,
  setupIsComplete,
  type DetectedFact,
} from "./onboardingDetect";
import type { Config, GalleryEntry, RgbMode } from "@shared/types";
import { t } from "../i18n";

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
    <div className="flex items-center justify-center gap-1.5">
      {Array.from({ length: STEP_COUNT }, (_, i) => {
        const outstanding = i < step && needsAttention?.(i) === true;
        return (
          <button
            key={i}
            onClick={() => onJump(i)}
            disabled={i >= step}
            aria-label={t(STEP_LABELS[i] ?? STEP_LABELS[0]!)}
            title={i < step ? t(STEP_LABELS[i] ?? STEP_LABELS[0]!) : undefined}
            className={`h-1.5 rounded-full transition-all duration-[var(--motion-base)] ease-[var(--ease-standard)] ${
              i === step
                ? "w-7 bg-[rgb(var(--glow))] shadow-[0_0_10px_rgb(var(--glow)/0.7)]"
                : i < step
                  ? outstanding
                    ? "w-1.5 cursor-pointer bg-amber-400/70 hover:bg-amber-400"
                    : "w-1.5 cursor-pointer bg-[rgb(var(--glow)/0.45)] hover:bg-[rgb(var(--glow)/0.75)]"
                  : "w-1.5 cursor-default bg-[var(--line-strong)]"
            }`}
          />
        );
      })}
    </div>
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
      onClick={onPick}
      disabled={disabled}
      title={entry.name}
      className={`group relative flex w-full flex-col overflow-hidden rounded-xl border bg-[var(--panel-strong)] text-left transition-all duration-[var(--motion-slow)] ease-[var(--ease-standard)] hover:-translate-y-0.5 hover:shadow-[var(--shadow)] disabled:pointer-events-none disabled:opacity-50 ${
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

  const importFile = async () => {
    setBusy(true);
    try {
      const files = await api.pickMediaFiles();
      const first = resolvePicked(files)[0];
      if (!first) return;
      const before = useStore.getState().cfg?.gallery ?? [];
      const list = await api.galleryImportPaths([first.path]);
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

  const importFolder = async () => {
    setBusy(true);
    try {
      const folder = await api.pickMediaFolder();
      if (!folder) return;
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
    <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
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
      <div key={id} className="border-t border-[var(--line)] first:border-t-0">
        <Row label={label} hint={hint ?? undefined}>
          <Chip tone={f?.ok ? "ok" : "idle"} pulse={detecting}>
            {f?.ok ? t("onboarding.ready") : t("onboarding.none")}
          </Chip>
        </Row>
      </div>
    );
  };

  return (
    <div className="grain relative h-screen overflow-y-auto">
      <div className="aura" />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-6 py-10">
        {





 }
        <div className="mb-3 flex items-center justify-between gap-4">
          <span className="flex min-w-0 items-center gap-2.5">
            <AppMark size={22} pulse={step === 0} />
            <AppWordmark size={22} />
          </span>
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-faint)]">
            {t("onboarding.step-{n}-of-{total}", { n: step + 1, total: STEP_COUNT })}
          </span>
        </div>

        {
 }
        <div className="mb-4 flex items-center gap-3">
          <IconSparkle className="h-4 w-4 shrink-0 text-[rgb(var(--glow))]" />
          <span className="kicker truncate">{t(STEP_LABELS[step] ?? STEP_LABELS[0]!)}</span>
          <span className="ml-auto shrink-0">
            <Stepper
              step={step}
              onJump={goTo}
              needsAttention={(i) => i === 1 && !openrgbRunning}
            />
          </span>
        </div>

        {

 }
        <section
          key={step}
          className={`glass p-7 step-enter-${direction === 1 ? "forward" : "back"}`}
        >
          {step === 0 && (
            <>
              <h1 className="lednum text-lg text-[var(--text)]">
                {detecting || !facts
                  ? t("onboarding.checking")
                  : t("onboarding.we-checked-your-setup")}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-dim)]">
                {t("onboarding.here-is-what-we-found")}
              </p>

              {
 }
              <div className="mt-5">
                <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] px-4">
                  <div className="flex items-center justify-between gap-3 py-2">
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

              <InfoNote className="mt-3">
                {t("onboarding.detection-only-reads-your-machine")}
              </InfoNote>

              {






 }
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
              <h1 className="lednum text-lg text-[var(--text)]">
                {t("onboarding.requirements-title")}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-dim)]">
                {t("onboarding.requirements-led")}
              </p>

              <div className="mt-5 rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] px-4">
                <Row label={t("common.openrgb")} hint={requirementCopy.hint}>
                  <Chip
                    tone={openrgbRunning ? "ok" : openrgbPath ? "warn" : "idle"}
                    pulse={fetching}
                  >
                    {requirementCopy.chip}
                  </Chip>
                </Row>

                <div className="border-t border-[var(--line)] py-3">
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
                      {


 }
                      {openrgbPath && (
                        <p className="mt-2 break-all font-mono text-[10px] text-[var(--text-faint)]">
                          {openrgbPath}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>

              {


 }
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
              <h1 className="lednum text-lg text-[var(--text)]">
                {t("onboarding.welcome-to-lumendeck")}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-dim)]">
                {t("onboarding.live-wallpapers-that-light-up-your-room-and-your")}
              </p>

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
              <h1 className="lednum text-lg text-[var(--text)]">
                {t("onboarding.bring-in-your-media")}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-dim)]">
                {t("onboarding.fill-the-vault-with-videos-images-or-folders-you")}
              </p>

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
                      {

 }
                      {vaultGrid(added)}
                      <p className="mt-2.5 text-dim-sm">
                        {t("onboarding.pick-a-thumbnail-to-put-it-on-your-screen")}
                      </p>
                    </>
                  )}

                  <div className="space-y-2.5">
                    {urlMode ? (
                      <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
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
                          onClick={importFile}
                          disabled={busy}
                          title={t("onboarding.import-a-file")}
                          hint={t("onboarding.a-video-or-image-from-your-pc")}
                          action={t("onboarding.pick")}
                        />
                        <ImportButton
                          onClick={importFolder}
                          disabled={busy}
                          title={t("onboarding.import-a-folder")}
                          hint={t("onboarding.every-video-and-image-inside-in-one-go")}
                          action={t("onboarding.pick")}
                        />
                        <ImportButton
                          onClick={() => setUrlMode(true)}
                          disabled={busy}
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
              <h1 className="lednum text-lg text-[var(--text)]">
                {t("onboarding.sync-your-rgb-lighting")}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-dim)]">
                {t("onboarding.connect-to-openrgb-to-have-your-devices-follow-t")}
              </p>

              <div className="mt-5">
                <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
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

                  {
 }
                  {rgb.connected && rgb.devices.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--line)] pt-3">
                      {rgb.devices.map((d) => (
                        <Chip key={d.id} tone="accent">
                          {t("common.{mode}-{leds}-leds", { mode: d.name, leds: d.leds })}
                        </Chip>
                      ))}
                    </div>
                  )}
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
              <h1 className="lednum text-lg text-[var(--text)]">
                {t("onboarding.your-lighting-mood")}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-dim)]">
                {t("onboarding.pick-how-your-devices-behave-ambient-follows-the")}
              </p>

              <div className="mt-5">
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {moodModes().map((m) => {
                    const active = cfg.rgb.mode === m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => save((c) => (c.rgb.mode = m.id as RgbMode))}
                        className={`rounded-xl border p-3.5 text-left transition-all duration-[var(--motion-fast)] ease-[var(--ease-standard)] active:scale-[0.98] ${
                          active
                            ? "border-[rgb(var(--glow)/0.6)] bg-[rgb(var(--glow)/0.08)] ring-1 ring-[rgb(var(--glow)/0.3)]"
                            : "border-[var(--line)] hover:border-[var(--line-strong)]"
                        }`}
                      >
                        <ItemTitle>{t(m.label)}</ItemTitle>
                        <div className="mt-0.5 text-[11px] leading-snug text-[var(--text-faint)]">
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
              <h1 className="lednum text-lg text-[var(--text)]">
                {t("onboarding.common-settings")}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-dim)]">
                {t("onboarding.the-toggles-most-people-change-you-can-fine-tune")}
              </p>

              <div className="mt-5">
                {
 }
                <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] px-4">
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
                  <div className="border-t border-[var(--line)]" />
                  <Toggle
                    label={t("onboarding.launch-at-startup")}
                    description={t("onboarding.start-lumendeck-with-windows")}
                    checked={cfg.general.autostart}
                    onChange={(v) => save((c) => (c.general.autostart = v))}
                  />
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
                </div>
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
              <h1 className="lednum text-lg text-[var(--text)]">
                {facts === null
                  ? t("onboarding.checking")
                  : complete
                    ? t("onboarding.your-setup-is-ready")
                    : t("onboarding.still-needs-attention")}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-dim)]">
                {t("onboarding.ready-in-under-a-minute")}
              </p>

              <div className="mt-5">
                {


 }
                <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] px-4">
                  <Row label={t("onboarding.summary-displays")}>
                    <span className="font-mono text-[11px] text-[var(--text-dim)]">
                      {fact("displays")?.ok
                        ? res || t("onboarding.resolution-unknown")
                        : t("onboarding.none")}
                    </span>
                  </Row>
                  <Row label={t("onboarding.summary-lighting")}>
                    <span className="font-mono text-[11px] text-[var(--text-dim)]">
                      {fact("lighting")?.ok
                        ? t("onboarding.{n}-devices-detected", {
                            n: fact("lighting")!.count,
                          })
                        :
                          rgb.connected
                            ? t("onboarding.no-lighting-found")
                            : t("onboarding.no-openrgb-server")}
                    </span>
                  </Row>
                  <Row label={t("onboarding.summary-mode")}>
                    <span className="font-mono text-[11px] text-[var(--text-dim)]">
                      {t(mode.label)}
                    </span>
                  </Row>
                  <Row label={t("onboarding.summary-vault")}>
                    <span className="font-mono text-[11px] text-[var(--text-dim)]">
                      {cfg.gallery.length > 0
                        ? t("onboarding.{n}-items-found", { n: cfg.gallery.length })
                        : t("onboarding.empty-vault")}
                    </span>
                  </Row>
                  <Row label={t("onboarding.summary-wallpaper")}>
                    <span className="flex min-w-0 items-center gap-2">
                      {

 }
                      {activeEntry && (
                        <span className="block w-14 shrink-0 overflow-hidden rounded-md border border-[var(--line)]">
                          <PickTile entry={activeEntry} active compact onPick={() => {}} />
                        </span>
                      )}
                      <span className="max-w-[9rem] truncate font-mono text-[11px] text-[var(--text-dim)]">
                        {activeEntry?.name ?? t("onboarding.none")}
                      </span>
                    </span>
                  </Row>
                  <Row label={t("onboarding.summary-autostart")}>
                    <span className="font-mono text-[11px] text-[var(--text-dim)]">
                      {cfg.general.autostart ? t("onboarding.on") : t("onboarding.off")}
                    </span>
                  </Row>
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
          {

 }
          <button
            onClick={finish}
            disabled={busy}
            className="font-mono text-[10px] tracking-widest text-[var(--text-faint)] uppercase transition-colors hover:text-[var(--text-dim)] disabled:opacity-50"
          >
            {t("onboarding.skip-set-up-later-in-settings")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportButton({
  onClick,
  disabled,
  title,
  hint,
  action,
}: {
  onClick: () => void;
  disabled: boolean;
  title: string;
  hint: string;
  action: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-left transition-all hover:border-[rgb(var(--glow)/0.5)] disabled:opacity-50"
    >
      <span>
        <ItemTitle as="span">{title}</ItemTitle>
        <span className="mt-0.5 block text-xs text-[var(--text-faint)]">{hint}</span>
      </span>
      <span className="font-mono text-[10px] uppercase tracking-widest text-[rgb(var(--glow))]">
        {action}
      </span>
    </button>
  );
}