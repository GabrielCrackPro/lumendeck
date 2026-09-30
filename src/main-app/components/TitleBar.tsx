// Custom window titlebar: drag region, app mark, window controls.
// The main window is created with `decorations(false)`; this replaces the
// native frame with the app's glass language.
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "../ipc";
import { AppMark, AppWordmark, DevBadge } from "./ui";
import { t } from "../i18n";

const win = getCurrentWindow();

/** Window control buttons, Windows-style hover zones. */
function Controls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let disposed = false;
    const sync = () => {
      win.isMaximized().then((m) => !disposed && setMaximized(m)).catch(() => {});
    };
    sync();
    // Size changes (maximize/restore/snap/drag-resize) all emit resize; no
    // need to poll every second for a state that only changes on resize.
    const unlisten = win.onResized(sync);
    return () => {
      disposed = true;
      unlisten.then((f) => f()).catch(() => {});
    };
  }, []);

  const btn =
    "flex h-8 w-11 items-center justify-center text-[var(--text-dim)] transition-colors first:rounded-l-lg";
  return (
    <div className="flex items-stretch">
      <button
        title={t("titlebar.minimize")}
        className={`${btn} hover:bg-[var(--panel-strong)] hover:text-[var(--text)]`}
        // Tray or taskbar depending on general.minimizeToTray; the backend
        // reads the live config so the button never disagrees with settings.
        onClick={() => {
          api.minimizeWindow().catch(() => {});
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button
        title={t(maximized ? "titlebar.restore" : "titlebar.maximize")}
        className={`${btn} hover:bg-[var(--panel-strong)] hover:text-[var(--text)]`}
        onClick={() => win.toggleMaximize()}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor">
            <path d="M2.5 0.5h7v7M0.5 2.5h7v7h-7z" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor">
            <rect x="0.5" y="0.5" width="9" height="9" strokeWidth="1" />
          </svg>
        )}
      </button>
      <button
        title={t("titlebar.close")}
        className="flex h-8 w-11 items-center justify-center rounded-r-lg text-[var(--text-dim)] transition-colors hover:bg-red-500/80 hover:text-white"
        onClick={() => win.close()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
}

export default function TitleBar() {
  return (
    <div className="flex h-9 shrink-0 items-center justify-between pl-3 select-none">
      {/* drag region doubles as the app mark */}
      <div
        data-tauri-drag-region
        className="flex h-full flex-1 items-center gap-2"
        onDoubleClick={() => win.toggleMaximize()}
      >
        <AppMark size={16} />
        <AppWordmark size={16} className="select-none" />
        <DevBadge />
      </div>
      <Controls />
    </div>
  );
}
