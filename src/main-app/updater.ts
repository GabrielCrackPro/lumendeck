import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useStore } from "./store";
import { truncateError } from "./utilities";

type PendingUpdate = NonNullable<Awaited<ReturnType<typeof check>>>;
export interface AvailableUpdate {
  version: string;
  notes: string | null;
}

let pendingUpdate: PendingUpdate | null = null;
let activeCheck: Promise<AvailableUpdate | null> | null = null;

export function checkForAppUpdate(): Promise<AvailableUpdate | null> {
  if (activeCheck) return activeCheck;

  activeCheck = check()
    .then((update) => {
      pendingUpdate = update;
      return update
        ? { version: update.version, notes: update.body || null }
        : null;
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
 * Offer an available update where the user already is. The toast is sticky
 * because a version bump is the one notification worth interrupting for,
 * and it installs from here — sending someone to Settings for something the
 * app can just do is the wrong shape. The download reports into the same
 * card, so the progress is visible without leaving the dashboard.
 */
export function announceUpdate(update: AvailableUpdate) {
  // Dev builds never announce: the only caller (the startup check) is already
  // gated, but announcements must stay impossible from dev even if a future
  // call site forgets the gate.
  if (import.meta.env.DEV) return;
  const run = async (toastId: number) => {
    const store = useStore.getState();
    store.patchToast(toastId, {
      msg: "Fetching the new version…",
      progress: 0,
      action: { label: "Downloading…", run: () => {}, disabled: true },
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
        title: "Update failed",
        msg: `Could not install v${update.version}. ${truncateError(e, 120)}`,
        progress: null,
        sticky: false,
        action: { label: "Try again", run: () => void run(toastId) },
      });
    }
  };

  useStore.getState().toast("info", update.notes?.trim() || "Restart to finish installing.", {
    title: `LumenDeck v${update.version} is ready`,
    sticky: true,
    // The store mints the id; read it back so the action can patch this card.
    action: {
      label: "Restart and update",
      run: () => {
        const id = useStore.getState().toasts[useStore.getState().toasts.length - 1]?.id;
        if (id != null) void run(id);
      },
    },
  });
}
