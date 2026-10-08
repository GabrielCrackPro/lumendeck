// First-run onboarding, rebuilt around the reference screens.
//
// The shape comes from those screens rather than from a step-by-step form:
// every panel is the same three parts — a caption naming what this step is
// doing, a column of rows carrying labels and values, and a fixed footer with
// the secondary action on the left and the primary on the right. What changes
// between steps is only the rows and the action the footer offers.
//
//  0. Detect      — read the machine, show what was found, all of it skippable
//  1. Requirements — install or start OpenRGB, the one hard dependency
//  2. Wallpaper   — put something on the screen, from the vault
//  3. Import      — pull media into the vault (file / folder / URL)
//  4. Lighting    — the devices found, or skip (wallpaper-only is valid)
//  5. Mood        — a starting lighting mode
//  6. Config      — the toggles most people change
//  7. Done        — a read-only receipt, then a name for the look
//
// Skippable at any point; the app is fully usable without finishing.
//
// Two judgements deliberately live outside this file. "Found" is decided in
// onboardingDetect.ts, because the same facts drive both the detect rows and
// the closing receipt and two JSX copies would eventually disagree. The
// AMOLED default is in onboardingAmoled.ts, for the same reason, plus the rule
// that it stops writing once the user has touched the toggle.
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
// The vault's own tile imagery. A wallpaper chosen by its filename is chosen
// by the one piece of information that says nothing about how it looks.
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

/**
 * The caption each step carries, mirroring the reference screens where the
 * panel above the card names the operation being performed.
 *
 * A lookup table rather than seven literal `t()` calls: the caption sits in the
 * header, outside the per-step blocks, so there is nowhere to put a literal.
 * The i18n checker resolves table values by name, which is what keeps these
 * from reading as dead keys.
 */
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

/**
 * The stepper.
 *
 * Segments rather than numbered circles: eight circles eat more width than they
 * earn and make a setup meant to take a minute feel long. Only steps already
 * visited are clickable — re-entering one costs nothing to offer, and someone
 * who realises they skipped lighting should not have to press Back six times.
 * Forward jumps stay off, because skipping ahead would leave the closing
 * summary describing a step nobody saw.
 *
 * `needsAttention` marks a step whose work is not finished — the requirements
 * step with nothing installed — so it stays visibly outstanding rather than
 * being scrolled past and forgotten.
 */
function Stepper({
  step,
  onJump,
  needsAttention,
}: {
  step: number;
  onJump: (n: number) => void;
  /** Steps that are behind us but still unfinished. */
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

/**
 * The footer, identical on every step: secondary left, primary right.
 *
 * Extracted because it was seven near-identical copies that had already drifted
 * twice. `onBack` is optional because the first step has no step behind it —
 * its left action is "leave setup", which is a different thing and says so.
 */
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
  /**
   * Hover text for the primary button.
   *
   * The only way to explain a *disabled* button — it cannot take a click, so
   * nothing else will ever say why.
   */
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

/**
 * One wallpaper, as it looks in the vault.
 *
 * Deliberately not `GalleryCard`: that carries selection, starring, renaming,
 * per-display badges and a drawer opener, none of which mean anything during
 * first run. What is worth keeping is the shape — media on top, a name strip
 * below, and a ring on whichever wallpaper is actually live — so what is picked
 * here is recognisable in the vault afterwards.
 */
function PickTile({
  entry,
  active,
  compact,
  disabled,
  onPick,
}: {
  entry: GalleryEntry;
  /** This wallpaper is on the displays right now. */
  active: boolean;
  /** The summary's thumbnail, which has no room for a name strip. */
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
  /* Which way the last step change went, so the panel can enter from the side
     you travelled towards. A separate setter for `step` would let a caller
     move the wizard without recording a direction, and the animation would
     then silently disagree with the movement — so every jump goes through
     `goTo` below instead. */
  const [direction, setDirection] = useState<1 | -1>(1);
  const goTo = (next: number) => {
    setDirection(next >= step ? 1 : -1);
    setStep(next);
  };
  const [busy, setBusy] = useState(false);
  const [urlMode, setUrlMode] = useState(false);
  const [url, setUrl] = useState("");
  // What this run added, kept as entries rather than ids so the tiles can show
  // the media itself.
  const [added, setAdded] = useState<GalleryEntry[]>([]);
  // Where the last batch came from, so the grid can say what was just added
  // rather than leaving the user to remember which folder they just opened.
  // The last path segment only: `basename` drops the extension, which is right
  // for "clip.mp4" and wrong for a folder called "2024.backups".
  const [importSource, setImportSource] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  // null means the pass has not reported yet, which renders as "checking"
  // rather than as four rows of nothing.
  const [facts, setFacts] = useState<DetectedFact[] | null>(null);
  const [detecting, setDetecting] = useState(true);
  const [primary, setPrimary] = useState<{ w: number; h: number } | null>(null);
  // Every display, not just the primary one. A two-monitor machine is told how
  // many screens it has, but not which two — which is the question people
  // actually have when a wallpaper lands on the wrong one.
  const [monitors, setMonitors] = useState<MonitorEntry[]>([]);
  // The requirements step. `installed` is where the portable build was
  // unpacked, so a second run of setup offers "start it" rather than asking
  // someone to download the same 21 MB again.
  const [openrgbPath, setOpenrgbPath] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  // Whether the AMOLED toggle has been touched *by the user*, as opposed to
  // written by the rule below. Without it the rule re-asserts itself every time
  // the theme re-resolves, quietly undoing a deliberate choice.
  const [amoledTouched, setAmoledTouched] = useState(false);
  // The theme that is actually painted, so "system" is followed rather than
  // assumed dark. Read before the `!cfg` bail-out: it is a hook.
  const theme = useEffectiveTheme(cfg?.general.theme);
  const toast = (tone: "error" | "ok", msg: string) =>
    useStore.getState().toast(tone, msg);

  /* AMOLED tracks the theme for as long as the user has not said otherwise.
     `amoledDefault` returning null is the stop signal, and the equality guard
     is what keeps this from saving on every render once it has settled.
     Above the `!cfg` bail-out: it is a hook, and the bail-out is conditional. */
  useEffect(() => {
    const next = amoledDefault(theme, amoledTouched);
    if (next === null || !cfg || (cfg.general.amoled ?? false) === next) return;
    save((c) => {
      c.general.amoled = next;
    });
  }, [theme, amoledTouched, cfg, save]);

  /**
   * Read the machine and turn it into facts.
   *
   * Reads `rgb` and `gallery` off the store rather than the props the component
   * closed over, so "Check again" after a lighting retry and the first-run
   * pass go through the same path. Both system calls are allowed to fail: a
   * detection pass that throws leaves a blank wizard on first launch, which is
   * the one moment nobody can get past. A failed read is a missing fact, and
   * the copy for a missing fact already says what to do about it.
   */
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
        // The mute flag is not a missing output: a muted machine still has
        // speakers, and the reactive modes sample them fine.
        audioAvailable: Array.isArray(vol) && vol.length === 2 && typeof vol[0] === "number",
      }),
    );
    setDetecting(false);
  };

  useEffect(() => {
    void runDetect();
  }, []);

  /* The requirements status is read when the step is reached rather than on
     mount, so a build installed during this same run is reflected. Reading it
     once at startup is what would make the step look finished when it is not. */
  useEffect(() => {
    if (step === 1) void readOpenrgb();
  }, [step]);

  /* Below every hook on purpose. This component renders before the config
     arrives, so an early return placed above a hook makes the first pass run
     fewer hooks than the second — which React treats as a rules violation and
     throws on, rather than something that merely looks odd. */
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

  /**
   * Name the setup they have just built and capture it.
   *
   * Offered at the end rather than left to Settings because the first run is
   * the one moment the machine is on a look worth coming back to, and a
   * profile nobody named is one nobody switches to. Skippable, because a blank
   * name is not a reason to trap anyone on the last screen of setup.
   *
   * The profile is captured before `onboarded` is set so a failure here leaves
   * the wizard open on this step rather than closing over a name that was
   * never saved.
   */
  const createProfile = async () => {
    const name = profileName.trim();
    if (name.length === 0) {
      toast("error", t("onboarding.profile-name-required"));
      return;
    }
    setBusy(true);
    try {
      await api.sceneSave(name);
      // Re-read rather than trusting the returned scene: the capture happened
      // on the Rust side and its view of the config is the one that was written.
      useStore.setState({ cfg: await api.getConfig() });
    } catch (e) {
      toast("error", t("common.save-failed-{error}", { error: truncateError(e) }));
      setBusy(false);
      return;
    }
    setBusy(false);
    // Straight to done: the profile now exists, so there is no state worth
    // landing back on and the wizard's last screen has been seen.
    finish();
  };

  /**
   * Put something on the screen, then move on.
   *
   * Applies whatever is already showing before falling back to the first vault
   * entry. Blindly applying `gallery[0]` looked harmless but silently undid a
   * choice: clicking the fifth tile and then pressing this button put the first
   * one up instead, with no indication that the click had been discarded.
   *
   * The failure is caught rather than left to the `finally`: an apply that
   * throws used to escape as an unhandled rejection, which left the button
   * looking permanently stuck and told the user nothing at all.
   */
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

  /**
   * Measure what an import just brought in, so the vault can be sorted and
   * filtered by resolution and length the moment the wizard is out of the way.
   *
   * This is the whole reason the import step is worth indexing at all: the
   * closing receipt and the Wallpaper tab both read the index, and without it a
   * user's first import lands as a vault of entries the app knows nothing about.
   *
   * Deliberately not awaited by the import handlers' callers in the sense of
   * blocking the wizard — but it *is* awaited inside them, so `busy` stays true
   * while it works. A folder of two hundred files takes long enough that
   * releasing the buttons first would show an apparently idle screen for
   * several seconds with nothing indicating why.
   *
   * Failures are swallowed. The import itself succeeded, and reporting the
   * measurement as a failed import would be a lie; the toolbar's index button
   * is still there.
   */
  const indexNewMedia = async (fresh: Config, count: number) => {
    if (!autoIndexEnabled(fresh.wallpaper)) return;
    if (count <= 0) return;
    try {
      await buildAfterImport({
        added: count,
        // The wizard never starts a build of its own, so nothing can be running.
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
      // The config re-read is what moves the ring onto the newly applied tile.
      // Without it the grid would still claim the old wallpaper was live.
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

  /** What the requirements step knows, refreshed whenever it is shown. */
  const readOpenrgb = async () => {
    try {
      const st = await api.openrgbStatus();
      // st.version is what the pinned manifest says we would fetch; the step
      // does not print it, so only the installed path is kept.
      setOpenrgbPath(st.installedAt);
    } catch {
      // A status read that fails is not worth blocking setup over; the step
      // falls back to offering the download, which is what it would have
      // offered on a machine with nothing installed anyway.
    }
  };

  /**
   * Start the server and wait until it is actually answering.
   *
   * The refresh afterwards is the part that matters: spawning a process says
   * "we started something", polling says "it worked". Without it the step would
   * still offer a Start button for a server that had come up perfectly well.
   */
  const startOpenrgbAt = async (exe: string) => {
    await api.openrgbLaunch(exe);
    await api.rgbRefresh();
    useStore.getState().setRgb(await api.rgbStatus());
    // Re-read the facts, or the stepper's outstanding marker and the closing
    // receipt keep reporting a lighting failure the user fixed on this very
    // screen. The lighting step's retry does the same thing for the same
    // reason.
    await runDetect();
  };

  /**
   * Download, then start it, in one go.
   *
   * Chained deliberately. Stopping after the download would leave someone with
   * a server on disk that is not running, which is the same state they were in
   * before they clicked — the worst possible place for a first-run step to
   * finish, because they would believe their lights were handled.
   */
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

  /**
   * "Running" means the server answered *and* is holding a device.
   *
   * A server that answers with an empty device list is not a working setup —
   * it is the state where a user clicks Start, watches a tray icon appear,
   * and sees no lights and no explanation. Same rule as the detect step.
   */
  const openrgbRunning = rgb.connected && rgb.devices.length > 0;

  /**
   * A download is genuinely the next action only when nothing is on disk *and*
   * nothing is running. Someone with OpenRGB installed system-wide reports no
   * local path but a live connection, and telling them where we would have put
   * a download they never made is noise at best.
   */
  const willDownload = !openrgbPath && !openrgbRunning;

  /**
   * Every string on this step, decided once.
   *
   * Three pieces of state were driving six nested ternaries across the hint,
   * the chip and the button. Resolving them here means the row and the button
   * cannot disagree about what state they are in, and adding a state is one
   * entry rather than four edits.
   */
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

  /** Screen names, shown only when there is more than one to tell apart. */
  const otherDisplays = monitors.filter((m) => !m.primary);
  const res = resolutionLabel(primary?.w ?? null, primary?.h ?? null);
  const complete = facts !== null && setupIsComplete(facts);
  // Kind and source together: a folder can hold two files with the same name,
  // and a URL entry can share a source string with a local one.
  const activeEntry =
    cfg.gallery.find(
      (g) => g.kind === cfg.wallpaper.kind && g.source === cfg.wallpaper.source,
    ) ?? null;
  const mode =
    RGB_MODES.find((m) => m.id === cfg.rgb.mode) ?? RGB_MODES[0]!;

  /**
   * The modes worth offering in a sixty-second setup.
   *
   * Reactive plus breathe: enough to show what the lighting is for without
   * turning the screen into a list of eight. Audio-reactive joins them only
   * when an audio output was found, because it samples what the machine is
   * playing and there is nothing to sample without one.
   */
  const moodModes = () =>
    RGB_MODES.filter(
      (m) =>
        m.group === "reactive" ||
        m.id === "breathe" ||
        (m.id === "audioReactive" && fact("audio")?.ok),
    );

  /** The vault as a grid of pickable tiles, capped and scrolling. */
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

  /**
   * One detected fact as a row: what was looked for, what came back, and a chip
   * that says whether it counts. The hint renders only when there is something
   * to say beyond "ready" — audio has no detail worth a second line, and an
   * empty hint line reads as a layout bug.
   */
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
    /* The scroll and the centring have to be different elements: a centred
       flex column taller than the viewport pushes content past BOTH edges of an
       `overflow-hidden` box, and the footer becomes unreachable. `min-h-screen`
       means centring only applies when there is room to centre in. */
    <div className="grain relative h-screen overflow-y-auto">
      <div className="aura" />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-6 py-10">
        {/* The lockup is here rather than on the card because this flow has no
            title bar: without it nothing names the app on any of the eight
            steps. `pulse` only on the first screen — that is where the app is
            introducing itself and genuinely working in the background, which
            is the splash case the prop is documented for. On the steps after it
            the header is chrome, and a logo that breathes for the rest of the
            setup is just a distraction. */}
        <div className="mb-3 flex items-center justify-between gap-4">
          <span className="flex min-w-0 items-center gap-2.5">
            <AppMark size={22} pulse={step === 0} />
            <AppWordmark size={22} />
          </span>
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-faint)]">
            {t("onboarding.step-{n}-of-{total}", { n: step + 1, total: STEP_COUNT })}
          </span>
        </div>

        {/* The caption names the step. On its own line because the lockup row
            above is already carrying the position. */}
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

        {/* Keyed on `step` so each step is a fresh subtree: the enter animation
            has to replay for every step, and React reuses the DOM node when
            only the class changes. */}
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

              {/* One panel of rows. Nothing is editable here: this step reports, and the
                  steps after it are where anything changes. */}
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
                          // "Primary" only earns its place when there is another
                          // screen it could be confused with.
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

              {/* Restoring a setup, offered before anything is configured rather
                  than after. The steps below this one are not merely redundant
                  for someone with an exported config, they are destructive:
                  advancing past the wallpaper step calls `galleryApply`, so a
                  wizard that offered import last would apply a wallpaper, import
                  a batch of media and set a lighting mode, and then replace all
                  three with the file. Importing first and jumping to the receipt
                  means the file is the only thing that ever wrote the config. */}
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
                    // The imported config carries its own theme, so the AMOLED
                    // rule must stop writing over it. Without this the rule
                    // would re-assert its own default on the very next render
                    // and the file's value would silently not survive.
                    setAmoledTouched(true);
                    // A config import replaced the vault, so the step 3 grid's
                    // entries — held as objects, not ids — are now gone. Harmless
                    // on the way in, since nothing has been imported yet, but the
                    // stepper lets a visitor jump back to any visited step, and a
                    // stale tile there would offer media the backend dropped.
                    setAdded([]);
                    setImportSource(null);
                    // The detect rows above were answered by the config this
                    // import replaced, so they are now describing the old one.
                    void runDetect();
                    // Forward, and past the wallpaper and vault steps: those are
                    // ones the file has already answered, and the wallpaper step
                    // would overwrite its way through them. `landing` decides
                    // whether anything is left to ask — the receipt when the file
                    // was a finished setup and OpenRGB is running, the
                    // requirements step when there is no lighting to drive, the
                    // settings step when the file was itself half-finished.
                    goTo(landing === "receipt" ? 7 : landing === "requirements" ? 1 : 6);
                  }}
                />
              </div>

              <StepNav
                onBack={finish}
                backLabel={t("onboarding.skip-setup")}
                backDisabled={detecting}
                nextLabel={t("onboarding.continue")}
                /* To the requirements step, not past it. Shifting every
                   `goTo` forward by one to make room for the new step
                   quietly pointed this one at the step after it. */
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
                    /* No button once it is running: an action that cannot
                       change anything is worse than no action, and a live one
                       beside "Continue" reads as a thing still to be done. */
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
                      {/* Where it went. The portable build is invisible to
                          Windows, so a user who wants to remove it, or to find
                          it after a cleaner clears the folder, has nothing to
                          go on otherwise. */}
                      {openrgbPath && (
                        <p className="mt-2 break-all font-mono text-[10px] text-[var(--text-faint)]">
                          {openrgbPath}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Provenance only matters while a download is the next thing
                  that will happen. Once it is on disk, or running from an
                  install the user made themselves, the note is describing a
                  fetch that either already happened or never will. */}
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
                  // "Use my first" only when there is nothing showing yet.
                  // Otherwise the button is just moving on, and calling it
                  // that would invite a second click that changes nothing.
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
                      {/* A folder import is where the file count stops being
                          small: a capped grid scrolls where a list of names
                          would have pushed the footer off the panel. */}
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
                            // The detect rows were answered by the same server
                            // that just came up; without this the receipt at the
                            // end would report a lighting fact that was fixed
                            // two screens ago.
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

                  {/* Names and LED counts answer "is my keyboard in there?"
                      without a trip to the lighting tab. */}
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
                {/* The same pickers as Settings, so the choices made here look
                    exactly like the ones they will find later. */}
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
                      // Claim the toggle, so the theme rule stops writing to it.
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
                {/* Read-only, deliberately. This is a receipt for what the
                    earlier screens applied, not a second place to change it: an
                    editable summary that disagrees with the real config is worse
                    than no summary at all. */}
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
                        : // The same distinction step 0 makes. "OpenRGB is not
                          // running" on a screen where OpenRGB is running with
                          // nothing attached sends the user looking for the
                          // wrong problem entirely.
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
                      {/* Only ever the wallpaper actually on screen. Falling back to the first
                      vault entry would put a picture beside the word "None"
                      and make an unset screen look set. */}
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
                // Trimmed, not raw: a name of spaces is not a name, and
                // `createProfile` refuses it. The button has to agree with the
                // guard or it will offer an action that cannot succeed.
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
          {/* Disabled while a save is in flight. The footer buttons all guard
              on `busy`, and this one was the exception: clicking it twice ran
              two writes to the same config and called `onDone` twice. */}
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

/**
 * One import route, as a row rather than a card.
 *
 * Rows instead of the three stacked cards this step used to have: at the
 * panel width this step now uses, those cards were mostly padding.
 */
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