import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

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
