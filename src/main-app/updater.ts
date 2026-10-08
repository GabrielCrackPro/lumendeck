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

let announcedVersion: string | null = null;

export function shouldAnnounce(
  announced: string | null,
  version: string,
  repeat = false,
): boolean {
  return repeat || announced !== version;
}

export const DEFAULT_CHECK_MINUTES = 60;

export const RECHECK_MS = DEFAULT_CHECK_MINUTES * 60_000;

export const MIN_CHECK_MINUTES = 15;
export const MAX_CHECK_MINUTES = 24 * 60;

export const MANUAL_ONLY_MINUTES = 0;

export function recheckMsFor(minutes: number | null | undefined): number | null {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0) {
    return RECHECK_MS;
  }
  if (minutes === MANUAL_ONLY_MINUTES) return null;
  const clamped = Math.min(MAX_CHECK_MINUTES, Math.max(MIN_CHECK_MINUTES, minutes));
  return Math.round(clamped * 60_000);
}

export const UPDATE_INTERVAL_MINUTES = [
  MANUAL_ONLY_MINUTES,
  30,
  60,
  360,
  1440,
] as const;

export const UPDATE_INTERVAL_LABELS: Record<number, string> = {
  0: "update.manual-only",
  30: "update.every-30-minutes",
  60: "update.every-hour",
  360: "update.every-6-hours",
  1440: "update.every-day",
};

export const UPDATE_INTERVAL_FALLBACK_LABELS: Record<"every-n-minutes", string> = {
  "every-n-minutes": "update.every-{n}-minutes",
};

export function effectiveInterval(minutes: number | null | undefined): number {
  if (
    typeof minutes !== "number" ||
    !Number.isFinite(minutes) ||
    minutes < 0
  ) {
    return DEFAULT_CHECK_MINUTES;
  }
  if (minutes === MANUAL_ONLY_MINUTES) return MANUAL_ONLY_MINUTES;
  return Math.round(
    Math.min(MAX_CHECK_MINUTES, Math.max(MIN_CHECK_MINUTES, minutes)),
  );
}

export function intervalLabelKey(minutes: number): string {
  return (
    UPDATE_INTERVAL_LABELS[minutes] ?? UPDATE_INTERVAL_FALLBACK_LABELS["every-n-minutes"]
  );
}

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

export function summaryFor(notes: string | null): string | null {
  if (!notes?.trim()) return null;

  const digest = releaseDigest(notes);

  const counts = (digest.headline ? restCounts(digest) : notableCounts(digest))
    .map(([key, n]) => t(SECTION_LABELS[key], { n: String(n) }))
    .join(", ");

  if (digest.breaking) {
    return t("update.breaking-{list}", {
      list: counts || t("update.changes"),
    });
  }

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
export function announceUpdate(
  update: AvailableUpdate,
  opts: { repeat?: boolean } = {},
) {
  if (import.meta.env.DEV) return;
  if (!shouldAnnounce(announcedVersion, update.version, opts.repeat)) return;
  announcedVersion = update.version;
  const run = async (toastId: number) => {
    const store = useStore.getState();
    store.patchToast(toastId, {
      msg: t("common.fetching-the-new-version"),
      progress: 0,
      link: undefined,
      action: { label: t("common.downloading"), run: () => {}, disabled: true },
    });
    try {
      await installAppUpdate((percent) =>
        useStore
          .getState()
          .patchToast(toastId, { progress: percent ?? 0 }),
      );
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
      link: {
        label: t("update.read-the-full-changelog"),
        run: () => {
          const store = useStore.getState();
          store.navigateTo("general");
          const last = store.toasts[store.toasts.length - 1]?.id;
          if (last != null) store.dismissToast(last);
        },
      },
      sticky: true,
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

export function useUpdateWatcher(
  ready: boolean,
  minutes: number | null | undefined,
) {
  const recheckMs = recheckMsFor(minutes);
  useEffect(() => {
    if (import.meta.env.DEV) return;
    if (!ready) return;
    if (recheckMs == null) return;

    const checkNow = () => {
      void checkForAppUpdate()
        .then((update) => {
          if (!update) return;
          useStore.getState().setUpdateAvailable(update);
          announceUpdate(update);
        })
        .catch(() => {});
    };

    checkNow();
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
