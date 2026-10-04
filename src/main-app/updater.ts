import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useEffect } from "react";
import { useStore } from "./store";
import {
  notableCounts,
  releaseDigest,
  restCounts,
  SECTION_LABELS,
} from "./components/releaseDigest";
import { truncateError } from "./utilities";
import { nextCheckRecord } from "./components/updateCheck";
import { t } from "./i18n";

type PendingUpdate = NonNullable<Awaited<ReturnType<typeof check>>>;
export interface AvailableUpdate {
  version: string;
  notes: string | null;
}

let pendingUpdate: PendingUpdate | null = null;
let activeCheck: Promise<AvailableUpdate | null> | null = null;

/**
 * The version most recently put in front of the user.
 *
 * A module-level value rather than store state because nothing renders it:
 * it exists so the periodic re-check can tell an update it already announced
 * from a new one. Without it, checking hourly would stack a fresh sticky card
 * every hour for as long as the update went uninstalled.
 */
let announcedVersion: string | null = null;

/**
 * Whether this version still needs telling the user about.
 *
 * Split out because it is the whole decision, and the decision a repeating
 * check gets wrong. Exported so the test asks it directly instead of reaching
 * for the module variable above.
 *
 * `repeat` is the manual "Check for updates" button, and it is why this takes a
 * flag rather than being a comparison. That button is an explicit request, so
 * it has to show the offer even when the hourly check already did: without the
 * flag, pressing it after an automatic notice appears to do nothing at all,
 * with no toast to explain the silence. Only the automatic path deduplicates.
 */
export function shouldAnnounce(
  announced: string | null,
  version: string,
  repeat = false,
): boolean {
  return repeat || announced !== version;
}

/**
 * The interval a fresh install gets, and the fallback for a config with nothing
 * to say. Kept in minutes because that is the unit the setting is stored in, and
 * in both languages, so the number on the slider is this number.
 *
 * Mirrors `default_update_check_minutes` in `config.rs`; a test on each side
 * pins the value, because a Rust default the dashboard does not know about
 * shows up as a slider sitting somewhere the user never chose.
 */
export const DEFAULT_CHECK_MINUTES = 60;

/**
 * How often a running app looks for a new release, when nothing says otherwise.
 *
 * An hour. The endpoint is a signed latest.json, so a check is a few kilobytes,
 * but it is still a round trip on someone's metered connection. Hourly finds a
 * release published this morning without ever being the reason a laptop woke up.
 */
export const RECHECK_MS = DEFAULT_CHECK_MINUTES * 60_000;

/** Bounds the setting is clamped to, in minutes. */
export const MIN_CHECK_MINUTES = 15;
export const MAX_CHECK_MINUTES = 24 * 60;

/**
 * The setting as a timer period, clamped into something defensible.
 *
 * Clamping rather than trusting the value because a config file is editable
 * JSON: a hand-edited `1` would otherwise mean sixty requests an hour against
 * GitHub's release endpoint, from an app the user did not ask to be a poller.
 * The floor preserves the intent of anyone who deliberately asks for *more*
 * often than the default; the ceiling keeps the slider meaningful.
 *
 * Absent, zero, negative and NaN all fall back to the default rather than to
 * the floor: zero is what a config missing the field deserializes to, and
 * treating that as "check every 15 minutes" would silently change the cadence
 * of every existing user the first time this shipped.
 */
/**
 * The stored value meaning "no recurring check at all".
 *
 * Zero was safe to claim because an existing config cannot already hold it: the
 * field is `#[serde(default = "default_update_check_minutes")]`, so a config
 * written before this setting deserializes to 60 rather than to zero, and the
 * control that wrote it never went below 15. Only a hand-edited file can land
 * here, and hand-editing is not a compatibility promise.
 */
export const MANUAL_ONLY_MINUTES = 0;

/**
 * How often to check, in milliseconds -- or `null` for no recurring check.
 *
 * `null` rather than 0 because the caller has to act on it. A zero passed to
 * `setInterval` fires the callback as fast as the event loop allows, so "off"
 * that arrives as a number is a request to hammer the release endpoint.
 */
export function recheckMsFor(minutes: number | null | undefined): number | null {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0) {
    return RECHECK_MS;
  }
  if (minutes === MANUAL_ONLY_MINUTES) return null;
  const clamped = Math.min(MAX_CHECK_MINUTES, Math.max(MIN_CHECK_MINUTES, minutes));
  return Math.round(clamped * 60_000);
}

/**
 * The intervals offered in the dropdown.
 *
 * A slider made every value between the bounds reachable, which is the wrong
 * control for this: there is no such thing as a meaningful 47-minute update
 * check, and a slider invites a precision that means nothing.
 *
 * Four of these are deliberate cuts. 15 was the slider's floor, not a desire --
 * a quarter-hour polling loop is what a slider hands you for free. 3 hours and
 * 12 hours were the awkward middle: picking between them decides when a release
 * arrives to within hours, which nobody cares about, and whichever of the pair
 * a person happened to be shown was arbitrary. What is left is four buckets a
 * person can actually have an opinion about -- off, release-day, hourly, daily
 * -- which is the whole decision a cadence setting is supposed to offer.
 *
 * No option here is a value the watcher would clamp, and any stored value the
 * watcher *does* clamp is surfaced as itself by `intervalChoices`, so the
 * dropdown never shows a cadence that is not the one running.
 */
export const UPDATE_INTERVAL_MINUTES = [
  MANUAL_ONLY_MINUTES,
  30,
  60,
  360,
  1440,
] as const;

/**
 * The label key for each offered interval.
 *
 * A lookup table rather than a template so `i18n-check` can resolve these keys;
 * written as `` t(`update.every-${m}`) `` they would read as dead and be removed
 * from both catalogs while the code still used them.
 */
export const UPDATE_INTERVAL_LABELS: Record<number, string> = {
  0: "update.manual-only",
  30: "update.every-30-minutes",
  60: "update.every-hour",
  360: "update.every-6-hours",
  1440: "update.every-day",
};

/**
 * The key used when the stored interval is not one of the offered ones.
 *
 * Carried as a one-entry map for a mechanical reason: `i18n-check` only resolves
 * catalog keys found in a `t()` call or in a const whose name ends in `_LABELS`,
 * so a fallback string returned from a function would be reported as dead and
 * then removed from both catalogs while this still referenced it.
 */
export const UPDATE_INTERVAL_FALLBACK_LABELS: Record<"every-n-minutes", string> = {
  "every-n-minutes": "update.every-{n}-minutes",
};

/**
 * The interval the UI shows, which is not always the one stored.
 *
 * Needed because the dropdown's displayed value has to be one of its own
 * options. A config holding `0` -- what a build without this field can
 * deserialise to -- passes straight through `intervalChoices`, which correctly
 * refuses to invent an option for it, leaving a control with a value that
 * matches no row and renders blank.
 *
 * Deliberately the same rule `recheckMsFor` applies when it runs: whatever the
 * watcher is actually doing is what the setting has to say it is doing. A
 * non-positive or nonsensical value takes the default, because that is what the
 * watcher does with it; an out-of-range one is clamped to the end of the scale,
 * because that is also what the watcher does with it.
 */
export function effectiveInterval(minutes: number | null | undefined): number {
  if (
    typeof minutes !== "number" ||
    !Number.isFinite(minutes) ||
    minutes < 0
  ) {
    return DEFAULT_CHECK_MINUTES;
  }
  // Zero is a choice, not a missing value: it means the recurring check is off,
  // so it has to survive to the control rather than being replaced by an hour.
  if (minutes === MANUAL_ONLY_MINUTES) return MANUAL_ONLY_MINUTES;
  // Clamped rather than replaced, and deliberately the same rule `recheckMsFor`
  // applies: an out-of-range value is a real choice pressed against the end of
  // the scale, and the watcher honours it as that end. Replacing it with the
  // default here would have the setting claiming a cadence that never runs.
  return Math.round(
    Math.min(MAX_CHECK_MINUTES, Math.max(MIN_CHECK_MINUTES, minutes)),
  );
}

/** The catalog key naming an interval, standard or otherwise. */
export function intervalLabelKey(minutes: number): string {
  return (
    UPDATE_INTERVAL_LABELS[minutes] ?? UPDATE_INTERVAL_FALLBACK_LABELS["every-n-minutes"]
  );
}

/**
 * The intervals to offer, with the running one kept when it is not one of them.
 *
 * This exists because the setting used to be a slider, so configs written by an
 * earlier build hold values no option matches -- 45, 75, 100. Handing the
 * dropdown a value it does not contain shows an empty field, and quietly
 * rewriting the user's setting to the nearest option on save would change a
 * cadence they chose. So an off-list value is offered as itself, in ascending
 * order, and the user picks a tidy option if they want one.
 *
 * The value inserted is `effectiveInterval(current)`, not `current`, because
 * the control's value has to match the row that names what the watcher is doing.
 * Trimming the option list took the clamp floor (15) off it, so a stored 1 or a
 * fractional 12.5 now clamps to a cadence with no row of its own; without this
 * the dropdown would render blank for exactly the hand-edited configs the
 * insertion exists to look after.
 */
export function intervalChoices(current: number | null | undefined): number[] {
  const base = [...UPDATE_INTERVAL_MINUTES];
  const shown = effectiveInterval(current);
  if (
    shown === MANUAL_ONLY_MINUTES ||
    base.includes(shown as (typeof UPDATE_INTERVAL_MINUTES)[number])
  ) {
    return base;
  }
  return [...base, shown].sort((a, b) => a - b);
}

export function checkForAppUpdate(): Promise<AvailableUpdate | null> {
  if (activeCheck) return activeCheck;

  activeCheck = check()
    .then((update) => {
      pendingUpdate = update;
      // Recorded here rather than at each call site because this is the only
      // place both the recurring timer and the manual button pass through, so a
      // caller cannot forget -- and because a failure has to land in the same
      // record as a success. It used to end in `.catch(() => {})`, which is
      // right for a check nobody asked for and wrong for one that fails every
      // hour: indistinguishable from never having checked at all.
      useStore.getState().setUpdateCheck(
        nextCheckRecord(update ? "update" : "current", Date.now()),
      );
      return update
        ? { version: update.version, notes: update.body || null }
        : null;
    })
    .catch((e) => {
      useStore.getState().setUpdateCheck(nextCheckRecord("failed", Date.now()));
      throw e;
    })
    .finally(() => {
      activeCheck = null;
    });

  return activeCheck;
}

export async function installAppUpdate(
  onProgress: (percent: number | null) => void,
) {
  if (!pendingUpdate) throw new Error("No verified update is available.");

  let downloaded = 0;
  let contentLength = 0;
  await pendingUpdate.downloadAndInstall((event) => {
    if (event.event === "Started") {
      contentLength = event.data.contentLength ?? 0;
      onProgress(contentLength > 0 ? 0 : null);
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      onProgress(
        contentLength > 0
          ? Math.min(100, Math.floor((downloaded / contentLength) * 100))
          : null,
      );
    } else if (event.event === "Finished") {
      onProgress(100);
    }
  });

  pendingUpdate = null;
  await relaunch();
}

/**
 * The one-line summary of what a release changed.
 *
 * Reads as a sentence because it sits under a heading that already names the
 * version, and a toast has room for one. Two facts fit: the headline change,
 * and how much there is beyond it. Everything else is one click away, which is
 * what the link below is for.
 */
export function summaryFor(notes: string | null): string | null {
  // No body at all is not the same as a release with nothing to report. The
  // first is an older release cut before the changelog was generated; the second
  // is a genuine "housekeeping only". Only the second gets read as a summary.
  if (!notes?.trim()) return null;

  const digest = releaseDigest(notes);

  // The headline is set aside before counting, so a release whose only change is
  // the one being described does not read "the thing, plus 1 added".
  const counts = (digest.headline ? restCounts(digest) : notableCounts(digest))
    .map(([key, n]) => t(SECTION_LABELS[key], { n: String(n) }))
    .join(", ");

  if (digest.breaking) {
    return t("update.breaking-{list}", {
      list: counts || t("update.changes"),
    });
  }

  // Nothing but housekeeping. Saying so beats a card led by "bump a lockfile",
  // which is the one entry nobody reads and everybody scrolls past.
  if (!digest.headline) {
    return counts
      ? t("update.this-release-has-{list}", { list: counts })
      : t("update.maintenance-nothing-to-do");
  }
  return counts
    ? t("update.{headline}-plus-{count}", {
        headline: digest.headline,
        count: counts,
      })
    : digest.headline;
}
/**
 * Offer an available update where the user already is. The toast is sticky
 * because a version bump is the one notification worth interrupting for,
 * and it installs from here — sending someone to Settings for something the
 * app can just do is the wrong shape. The download reports into the same
 * card, so the progress is visible without leaving the dashboard.
 */
export function announceUpdate(
  update: AvailableUpdate,
  opts: { repeat?: boolean } = {},
) {
  // Dev builds never announce: the callers are already gated, but
  // announcements must stay impossible from dev even if a future call site
  // forgets the gate.
  if (import.meta.env.DEV) return;
  // Checked after the dev gate so the guard itself stays honest in a dev run.
  if (!shouldAnnounce(announcedVersion, update.version, opts.repeat)) return;
  announcedVersion = update.version;
  const run = async (toastId: number) => {
    const store = useStore.getState();
    store.patchToast(toastId, {
      msg: t("common.fetching-the-new-version"),
      progress: 0,
      // The offer is being acted on; the reading link has done its job.
      link: undefined,
      action: { label: t("common.downloading"), run: () => {}, disabled: true },
    });
    try {
      await installAppUpdate((percent) =>
        useStore
          .getState()
          .patchToast(toastId, { progress: percent ?? 0 }),
      );
      // Only reached if relaunch() ever returns; normally the process goes.
      useStore.getState().dismissToast(toastId);
    } catch (e) {
      useStore.getState().patchToast(toastId, {
        tone: "error",
        title: t("common.update-failed"),
        msg: t("common.could-not-install-v{version}-{error}", {
          version: update.version,
          error: truncateError(e, 120),
        }),
        progress: null,
        sticky: false,
        // This card is now about a failed download. A "read the changelog"
        // link on an error reads as part of the retry.
        link: undefined,
        action: { label: t("common.try-again"), run: () => void run(toastId) },
      });
    }
  };

  useStore.getState().toast(
    "info",
    summaryFor(update.notes) ?? t("update.no-notes-bundled"),
    {
      title: t("common.lumendeck-v{version}-is-ready", { version: update.version }),
      // The changelog is bundled and already rendered by WhatsNewCard on the
      // settings tab, so this navigates rather than opening a browser: the
      // notes for a release are in the build you are about to leave.
      link: {
        label: t("update.read-the-full-changelog"),
        run: () => {
          const store = useStore.getState();
          store.navigateTo("general");
          // Reading is recorded by the changelog card itself on open, so this
          // only has to get out of the way.
          const last = store.toasts[store.toasts.length - 1]?.id;
          if (last != null) store.dismissToast(last);
        },
      },
      sticky: true,
      // The store mints the id; read it back so the action can patch this card.
      action: {
        label: t("common.restart-and-update"),
        run: () => {
          const store = useStore.getState();
          const id = store.toasts[store.toasts.length - 1]?.id;
          if (id != null) void run(id);
        },
      },
    },
  );
}

/**
 * Watch for updates while the app runs, not only at startup.
 *
 * The check used to run exactly once, on the first paint after onboarding. An
 * app left open across a release therefore never learned about it: the user had
 * to quit and relaunch, and if they never did they stayed on the old build for
 * as long as the machine stayed up.
 *
 * Three triggers, cheapest first:
 *
 * - immediately, so a release that landed while the app was closed is still
 *   noticed at once;
 * - when the window becomes visible again, because coming back to the app is
 *   exactly when someone would want to know it changed. Deliberately not rate
 *   limited by the interval below: this is a person asking by alt-tabbing back,
 *   and it is the only trigger that fires while someone is actually watching;
 * - on the configured timer, for the case where it never loses focus. That one
 *   follows `general.updateCheckMinutes`, so a user who wants to hear about a
 *   release on the day can say so.
 *
 * Repeating this is free of nagging: announceUpdate ignores a version it has
 * already shown.
 */
export function useUpdateWatcher(
  ready: boolean,
  minutes: number | null | undefined,
) {
  const recheckMs = recheckMsFor(minutes);
  useEffect(() => {
    // Dev builds must never ping the endpoint: the packaged version is what
    // releases are cut from, so a dev run would either match it (no-op) or nag
    // about a release this tree already contains.
    if (import.meta.env.DEV) return;
    if (!ready) return;
    // Manual only. Every automatic trigger stops here, not just the timer:
    // leaving the visibility check running would mean the app still asked for a
    // new version every time the window came back, which is far more often than
    // any interval in the list -- and the control would be claiming "manual"
    // while checking on its own. The button in Settings still works, which is the
    // whole of what this option promises.
    if (recheckMs == null) return;

    const checkNow = () => {
      void checkForAppUpdate()
        .then((update) => {
          if (!update) return;
          useStore.getState().setUpdateAvailable(update);
          announceUpdate(update);
        })
        // No endpoint, no network, a response that is not signed: all ordinary
        // on a dev machine or an offline one, and none worth a toast.
        .catch(() => {});
    };

    checkNow();
    // Re-armed from scratch when the setting changes, because the effect depends
    // on it. That means moving the slider checks once straight away, which is
    // harmless: the user has just expressed an interest in update timing.
    const timer = window.setInterval(checkNow, recheckMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") checkNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ready, recheckMs]);
}
