// Topmost sticker window runtime: renders one sticker's media, full-bleed,
// in a transparent always-on-top OS window. Receives the sticker def from
// config-change events (matched by window label).
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { EVENTS } from "@shared/constants";
import { installContextMenuSuppression } from "@shared/contextMenu";
import type { StickerDef } from "@shared/types";
import "../runtime.css";

// A property of the webview rather than of a component: a sticker is a
// transparent overlay showing media, and Reload or View source on it describes
// nothing about the picture.
installContextMenuSuppression();

function stickerIdFromLabel(): string {
  // window.__TAURI_INTERNALS__ exposes the label; fallback to parsing.
  const t = (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } })
    .__TAURI_INTERNALS__;
  const label = t?.metadata?.currentWindow?.label ?? "";
  return label.replace("sticker-top-", "");
}

function StickerRoot() {
  const [sticker, setSticker] = useState<StickerDef | null>(null);

  const load = () => {
    invoke<{ stickers: StickerDef[] }>("get_config")
      .then((cfg) => {
        const id = stickerIdFromLabel();
        setSticker(cfg.stickers.find((s) => s.id === id) ?? null);
      })
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const sub = listen<unknown>(EVENTS.CONFIG_CHANGED, () => load());
    return () => {
      sub.then((f) => f()).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!sticker) return null;
  const isVideo = /\.(mp4|webm|mov|mkv)(\?|$)/i.test(sticker.url);
  const fit = sticker.fit === "cover" ? "cover" : sticker.fit === "fill" ? "fill" : "contain";

  return (
    <div className="h-full w-full" style={{ opacity: sticker.opacity }}>
      {isVideo ? (
        <video
          src={sticker.url}
          autoPlay
          loop
          muted={sticker.muted}
          playsInline
          style={{ width: "100%", height: "100%", objectFit: fit }}
        />
      ) : (
        <img
          src={sticker.url}
          alt={sticker.name}
          style={{ width: "100%", height: "100%", objectFit: fit }}
        />
      )}
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<StickerRoot />);
