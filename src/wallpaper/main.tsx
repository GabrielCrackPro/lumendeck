// Wallpaper runtime (one instance per monitor): renders the configured source
// sized to its display and streams zone color samples to the RGB engine.
import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { EVENTS } from "@shared/constants";
import { installContextMenuSuppression } from "@shared/contextMenu";
import type { Config, StickerDef, WallpaperKind, ZoneDef } from "@shared/types";
import { computeSamples, type PixelBuf, type ZoneRect } from "./sampler";
import { SHADER_SOURCES, compileShaderProgram, shaderCanvasSize } from "./shaders";
import { applySnap, snapResizeAxis, type Guide, type Rect } from "./snap";
import "../runtime.css";

// A property of the webview rather than of a component: WebView2's own menu
// (Back, Reload, Inspect) over a wallpaper that cannot do any of those.
installContextMenuSuppression();

interface MonitorInfo {
  device: string;
  x: number;
  y: number;
  w: number;
  h: number;
  primary: boolean;
}

interface WallpaperInfo {
  monitor: MonitorInfo;
  /** Physical px per logical px (authoritative, from the backend window). */
  scale: number;
  source: string;
  /** Static snapshot (poster frame) shown under video sources on failure. */
  fallbackSource: string;
  /** Crossfade seconds for playlist-driven source changes (0 = instant). */
  crossfadeSec: number;
  config: Config["wallpaper"];
  paused: boolean;
  stickers: StickerDef[];
  /** Every connected monitor (virtual-screen px) — alignment-guide targets. */
  monitors: { device: string; x: number; y: number; w: number; h: number; primary: boolean }[];
  /** Snap behavior for the sticker editor. */
  snap: Config["stickerSnap"];
  /** Mirror wallpaper-layer stickers on every monitor. */
  stickerAllMonitors: boolean;
}

type VideoFit = "cover" | "contain" | "fill" | "auto";

/** Send a diagnostics line to the Rust log. Level maps to the file's
 * severity (info/warn/error/debug) so grepping for ERROR finds real problems.
 * "debug" lines are hidden at the default log level. */
function logLine(msg: string, level: "info" | "warn" | "error" | "debug" = "info") {
  invoke("log_frontend", { level, msg }).catch(() => {});
}

let pausedGlobal = false;

/** Pick the effective object-fit for a video on this display. */
export function effectiveVideoFit(fit: VideoFit, videoW: number, videoH: number, screenW: number, screenH: number): "cover" | "contain" | "fill" {
  switch (fit) {
    case "cover":
    case "contain":
    case "fill":
      return fit;
    case "auto": {
      if (!videoW || !videoH || !screenW || !screenH) return "cover";
      const videoAspect = videoW / videoH;
      const screenAspect = screenW / screenH;
      const ratio = videoAspect / screenAspect;
      // Match Lively/Wallpaper-Engine convention: fill (crop a little) unless
      // the shapes are wildly different (e.g. portrait video on a landscape
      // screen), where cropping would lose most of the frame — letterbox then.
      return ratio > 0.8 && ratio < 1.25 ? "cover" : "contain";
    }
  }
}

function WallpaperRoot() {
  const [info, setInfo] = useState<WallpaperInfo | null>(null);
  const [zones, setZones] = useState<ZoneDef[]>([]);

  useEffect(() => {
    invoke<WallpaperInfo>("get_wallpaper_info")
      .then(setInfo)
      .catch((e) => console.error("get_wallpaper_info failed", e));

    const unsubs = [
      listen<Config>(EVENTS.CONFIG_CHANGED, (e) => {
        setZones(e.payload.rgb.zones);
        setInfo((prev) =>
          prev
            ? {
                ...prev,
                config: e.payload.wallpaper,
                stickers: e.payload.stickers,
                snap: e.payload.stickerSnap,
              }
            : prev,
        );
        // The effective source/fallback/crossfade are resolved server-side
        // (per-monitor overrides, media URLs, playlist fade). Never guess the
        // source client-side: a per-monitor window would flash the GLOBAL
        // wallpaper until the self-heal poll corrected it up to 2s later.
        invoke<WallpaperInfo>("get_wallpaper_info")
          .then((fresh) => setInfo((prev) => (prev ? { ...prev, ...fresh } : fresh)))
          .catch(() => {});
      }),
      listen<boolean>(EVENTS.WALLPAUSE, (e) => {
        pausedGlobal = e.payload;
      }),
      // Displays changed: re-fetch this window's monitor geometry immediately
      // (the backend has already resized/repositioned the window).
      listen<MonitorInfo[]>(EVENTS.DISPLAY_CHANGED, () => {
        invoke<WallpaperInfo>("get_wallpaper_info")
          .then(setInfo)
          .catch(() => {});
      }),
    ];
    invoke<boolean>("is_paused")
      .then((p) => {
        pausedGlobal = p;
      })
      .catch(() => {});

    // Belt-and-braces: re-fetch periodically so a missed event
    // (e.g. webview reloaded mid-broadcast) self-corrects. Compare config AND
    // stickers: sticker placement/edit storms don't touch the wallpaper config.
    const poll = setInterval(() => {
      invoke<WallpaperInfo>("get_wallpaper_info")
        .then((fresh) => {
          setInfo((prev) => {
            if (!prev) return fresh;
            const same =
              JSON.stringify(prev.config) === JSON.stringify(fresh.config) &&
              JSON.stringify(prev.stickers) === JSON.stringify(fresh.stickers) &&
              JSON.stringify(prev.snap) === JSON.stringify(fresh.snap) &&
              prev.scale === fresh.scale &&
              // Monitor reassignment (display reorder/unplug) must repaint:
              // the label→monitor mapping shifts behind our back.
              prev.monitor.device === fresh.monitor.device &&
              prev.monitor.x === fresh.monitor.x &&
              prev.monitor.y === fresh.monitor.y &&
              prev.monitor.w === fresh.monitor.w &&
              prev.monitor.h === fresh.monitor.h;
            return same ? prev : { ...prev, ...fresh };
          });
        })
        .catch(() => {});
    }, 2000);

    return () => {
      clearInterval(poll);
      unsubs.forEach((u) => {
        if (u instanceof Promise) u.then((f) => f()).catch(() => {});
      });
    };
  }, []);

  const [editorOn, setEditorOn] = useState(false);
  useEffect(() => {
    const sub = listen<boolean>(EVENTS.EDITOR_STATE, (e) => setEditorOn(e.payload));
    return () => {
      sub.then((f) => f()).catch(() => {});
    };
  }, []);

  return (
    <>
      <MediaStage info={info} zones={zones} />
      {info && !editorOn && (
        <StickerLayer
          stickers={info.stickers}
          monitor={info.monitor}
          scale={info.scale}
          allMonitors={info.stickerAllMonitors}
          monitors={info.monitors}
        />
      )}
      {info && <StickerEditor info={info} />}
      <PausedBadge />
      <ReloadToast />
    </>
  );
}

type Handle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se" | "move" | null;

/**
 * On-wallpaper sticker editor. The wallpaper webview receives no OS mouse
 * input (it's behind the icons layer), so the backend streams global mouse
 * events over EDITOR_MOUSE while editor mode is on. Hit-testing, drag, and
 * resize all run here; results persist via update_sticker.
 */
function StickerEditor({ info }: { info: WallpaperInfo }) {
  const [on, setOn] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState<Handle | null>(null);
  const [overrideMap, setOverrideMap] = useState<Record<string, { x: number; y: number; w: number; h: number }>>({});
  const [guides, setGuides] = useState<Guide[]>([]);
  const st = useRef<{
    mode: Handle;
    id: string | null;
    startX: number;
    startY: number;
    orig: { x: number; y: number; w: number; h: number } | null;
    hoverMode: Handle | null;
  }>({ mode: null, id: null, startX: 0, startY: 0, orig: null, hoverMode: null });
  const infoRef = useRef(info);
  infoRef.current = info;
  const lastCommit = useRef(0);

  useEffect(() => {
    const sub = listen<boolean>(EVENTS.EDITOR_STATE, (e) => setOn(e.payload));
    return () => {
      sub.then((f) => f()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!on) return;
    const dpr = info.scale && info.scale > 0 ? info.scale : 1;
    // Reset transient state when the editor opens on this window.
    st.current = { mode: null, id: null, startX: 0, startY: 0, orig: null, hoverMode: null };
    setOverrideMap({});
    setFocusId(null);
    setGuides([]);

    const snapOpts = () => ({
      snapToGrid: info.snap?.grid ?? true,
      snapToShapes: info.snap?.guides ?? true,
      gridSize: info.snap?.gridSize ?? 32,
      threshold: 8 * dpr, // 8 logical px, in physical px
      others: infoRef.current.stickers
        .filter((k) => k.visible)
        .map((k): Rect => ({ x: k.x, y: k.y, w: k.w, h: k.h })),
      monitors: (info.monitors ?? []).map(
        (m): Rect => ({ x: m.x, y: m.y, w: m.w, h: m.h }),
      ),
    });

    const onEv = listen<[number, number, boolean, boolean]>(EVENTS.EDITOR_MOUSE, (e) => {
      const [px, py, ldown, rdown] = e.payload;
      const stickers = infoRef.current.stickers.filter((s) => s.visible);
      const s = st.current;

      // Hit-test rects in physical screen px.
      const rects = stickers.map((sk) => ({
        sk,
        l: sk.x,
        t: sk.y,
        r: sk.x + sk.w,
        b: sk.y + sk.h,
      }));
      const HW = 12 * dpr; // handle grab zone, physical px

      if (!s.mode) {
        let found: { id: string; mode: Handle } | null = null;
        for (const rc of [...rects].reverse()) {
          if (px >= rc.l && px <= rc.r && py >= rc.t && py <= rc.b) {
            const nearL = Math.abs(px - rc.l) <= HW;
            const nearR = Math.abs(px - rc.r) <= HW;
            const nearT = Math.abs(py - rc.t) <= HW;
            const nearB = Math.abs(py - rc.b) <= HW;
            let m: Handle = "move";
            if (nearL && nearT) m = "nw";
            else if (nearR && nearT) m = "ne";
            else if (nearL && nearB) m = "sw";
            else if (nearR && nearB) m = "se";
            else if (nearL) m = "w";
            else if (nearR) m = "e";
            else if (nearT) m = "n";
            else if (nearB) m = "s";
            found = { id: rc.sk.id, mode: m };
            break;
          }
        }
        setFocusId((prev) => (prev === (found?.id ?? null) ? prev : found?.id ?? null));
        s.hoverMode = found?.mode ?? null;
        setFocusMode((prev) => (prev === s.hoverMode ? prev : s.hoverMode));
        if (ldown && found) {
          const rc = rects.find((r) => r.sk.id === found!.id)!;
          s.mode = found.mode;
          s.id = found.id;
          s.startX = px;
          s.startY = py;
          s.orig = { x: rc.sk.x, y: rc.sk.y, w: rc.sk.w, h: rc.sk.h };
        } else if (rdown && found) {
          invoke("remove_sticker", { id: found.id }).catch(console.error);
        }
        return;
      }

      // Active drag/resize (physical px deltas).
      const dx = px - s.startX;
      const dy = py - s.startY;
      const o = s.orig!;
      const cur = infoRef.current.stickers.find((x) => x.id === s.id);
      if (!cur) {
        s.mode = null;
        return;
      }
      let next = { x: o.x, y: o.y, w: o.w, h: o.h };
      const MIN = 24; // physical px
      const opts = snapOpts();
      const foundGuides: Guide[] = [];
      if (s.mode === "move") {
        next.x = o.x + dx;
        next.y = o.y + dy;
        const snapped = applySnap(next, opts);
        next = snapped.rect;
        foundGuides.push(...snapped.guides);
      } else {
        const m = s.mode;
        // Horizontal axis: the moving edge snaps; the opposite edge stays.
        if (m.includes("w")) {
          const r = snapResizeAxis(o.x + dx, o.x + o.w, true, MIN, opts);
          next.x = r.edge;
          next.w = r.size;
          if (r.guide !== null) foundGuides.push({ axis: "v", pos: r.guide });
        } else if (m.includes("e")) {
          const r = snapResizeAxis(o.x + o.w + dx, o.x, true, MIN, opts);
          next.x = o.x;
          next.w = r.size;
          if (r.guide !== null) foundGuides.push({ axis: "v", pos: r.guide });
        }
        if (m.includes("n")) {
          const r = snapResizeAxis(o.y + dy, o.y + o.h, false, MIN, opts);
          next.y = r.edge;
          next.h = r.size;
          if (r.guide !== null) foundGuides.push({ axis: "h", pos: r.guide });
        } else if (m.includes("s")) {
          const r = snapResizeAxis(o.y + o.h + dy, o.y, false, MIN, opts);
          next.y = o.y;
          next.h = r.size;
          if (r.guide !== null) foundGuides.push({ axis: "h", pos: r.guide });
        }
      }
      next.x = Math.round(next.x);
      next.y = Math.round(next.y);
      next.w = Math.round(next.w);
      next.h = Math.round(next.h);
      // Zero-lag local override while dragging.
      setOverrideMap((prev) => ({ ...prev, [s.id!]: next }));
      setGuides((prev) => {
        const a = foundGuides;
        const b = prev;
        return a.length === b.length && a.every((g, i) => g.axis === b[i]!.axis && g.pos === b[i]!.pos)
          ? prev
          : foundGuides;
      });
      // Commit throttled during drag; final commit on release.
      if (!ldown || performance.now() - lastCommit.current > 150) {
        lastCommit.current = performance.now();
        invoke("update_sticker", { sticker: { ...cur, ...next } }).catch(console.error);
      }
      if (!ldown) {
        s.mode = null;
        s.id = null;
        s.orig = null;
        setOverrideMap({});
        setGuides([]);
      }
    });
    return () => {
      onEv.then((f) => f()).catch(() => {});
    };    }, [on, info.scale, info.snap, info.monitors, info.monitor.x, info.monitor.y, info.monitor.w, info.monitor.h]);

  if (!on) return null;

  // Guides: virtual-screen physical px → this monitor's local logical px.
  const dpr = info.scale && info.scale > 0 ? info.scale : 1;
  const vw = info.monitor.w / dpr;
  const vh = info.monitor.h / dpr;
  const localGuides = guides.flatMap((g) => {
    const style: CSSProperties = { position: "fixed" };
    if (g.axis === "v") {
      const left = (g.pos - info.monitor.x) / dpr;
      if (left < -1 || left > vw + 1) return [];
      Object.assign(style, { left, top: 0, width: 1, height: vh });
    } else {
      const top = (g.pos - info.monitor.y) / dpr;
      if (top < -1 || top > vh + 1) return [];
      Object.assign(style, { top, left: 0, height: 1, width: vw });
    }
    return [{ key: `${g.axis}${g.pos}`, style }];
  });

  return (
    <>
      {localGuides.map((g) => (
        <div key={g.key} className="pointer-events-none fixed z-50 bg-amber-300/90" style={g.style} />
      ))}
      <StickerLayer
        stickers={info.stickers}
        monitor={info.monitor}
        scale={info.scale}
        allMonitors={false}
        monitors={info.monitors}
        focusId={focusId ?? undefined}
        focusMode={focusMode}
        overrides={overrideMap}
      />
      <div className="pointer-events-none fixed inset-x-0 top-6 flex justify-center">
        <div className="rounded-full bg-black/70 px-4 py-2 font-sans text-xs text-white ring-1 ring-white/15 backdrop-blur">
          Editing stickers — drag to move · edges and corners to resize · right-click a sticker to delete · {info.snap?.grid !== false && info.snap?.guides !== false ? "snapping on" : info.snap?.grid !== false ? "grid snap" : info.snap?.guides !== false ? "guides on" : "snapping off"}
        </div>
      </div>
    </>
  );
}

/** Focus ring + handle visualization over the focused sticker. */
function FocusOverlay({ mode }: { mode: Handle }) {
  const handles: { pos: React.CSSProperties; h: Handle }[] = [
    { pos: { left: -4, top: -4 }, h: "nw" },
    { pos: { right: -4, top: -4 }, h: "ne" },
    { pos: { left: -4, bottom: -4 }, h: "sw" },
    { pos: { right: -4, bottom: -4 }, h: "se" },
  ];
  return (
    <div className="pointer-events-none absolute inset-0">
      <div
        className="absolute inset-0"
        style={{ border: "1.5px dashed rgba(56,189,248,0.95)", borderRadius: 6 }}
      />
      {mode !== "move" &&
        handles.map(({ pos, h }) => (
          <div
            key={h}
            className="absolute h-2 w-2 rounded-sm bg-sky-400"
            style={pos}
          />
        ))}
    </div>
  );
}

/**
 * Stickers rendered inside the wallpaper window itself — no per-sticker OS
 * windows. Each sticker's virtual-screen coords are translated into this
 * monitor's local space; stickers on other monitors fall outside and clip.
 */
function StickerLayer({
  stickers,
  monitor,
  scale,
  focusId,
  focusMode,
  overrides,
  allMonitors,
  monitors,
}: {
  stickers: StickerDef[];
  monitor: MonitorInfo;
  scale: number;
  focusId?: string;
  focusMode?: Handle | null;
  overrides?: Record<string, { x: number; y: number; w: number; h: number }>;
  allMonitors: boolean;
  monitors: MonitorInfo[];
}) {
  const visible = stickers.filter((s) => s.visible);
  if (visible.length === 0) return null;
  const dpr = scale && scale > 0 ? scale : 1;
  return (
    <div className="pointer-events-none fixed inset-0 z-10 overflow-hidden">
      {visible.flatMap((s0) => {
        const ov = overrides?.[s0.id];
        const s = ov ? { ...s0, ...ov } : s0;
        // Mirror mode: replicate the sticker at its position relative to the
        // anchor monitor on EVERY monitor. The anchor is whichever monitor
        // contains the sticker's placed position; other displays get a copy
        // at the same relative offset (clamped into their bounds). With the
        // flag off, only the intersection with the anchor monitor renders.
        const anchor =
          monitors.find(
            (m) => s.x + s.w > m.x && s.y + s.h > m.y && s.x < m.x + m.w && s.y < m.y + m.h,
          ) ?? monitor;
        const relX = s.x - anchor.x;
        const relY = s.y - anchor.y;
        const targets: { mon: MonitorInfo; sx: number; sy: number; key: string }[] =
          allMonitors && monitors.length > 1
            ? monitors.map((m, i) => ({
                mon: m,
                sx: m.x + Math.min(Math.max(relX, -(s.w - 48)), Math.max(m.w - 48, 0)),
                sy: m.y + Math.min(Math.max(relY, -(s.h - 48)), Math.max(m.h - 48, 0)),
                key: `${s.id}:${i}`,
              }))
            : [{ mon: monitor, sx: s.x, sy: s.y, key: s.id }];
        return targets.map(({ mon, sx, sy, key }) => ({
          s: { ...s, x: sx, y: sy },
          mon,
          key,
        }));
      }).map(({ s, mon, key }) => {
        // Config coords are PHYSICAL screen pixels (mouse hook, config files);
        // CSS layout needs logical pixels: divide by the window's scale
        // factor from the backend (authoritative DPI).
        const left = (s.x - mon.x) / dpr;
        const top = (s.y - mon.y) / dpr;
        const width = s.w / dpr;
        const height = s.h / dpr;
        // Skip copies entirely outside this monitor (physical compare).
        if (
          s.x + s.w <= mon.x ||
          s.y + s.h <= mon.y ||
          s.x >= mon.x + mon.w ||
          s.y >= mon.y + mon.h
        ) {
          return null;
        }
        const isVideo = /\.(mp4|webm|mov|mkv)(\?|$)/i.test(s.url);
        const fit = s.fit === "cover" ? "cover" : s.fit === "fill" ? "fill" : "contain";
        const isFocus = focusId === s.id;
        const report = (ok: boolean) =>
          invoke("log_sticker_render", {
            id: s.id,
            ok,
            left,
            top,
            width,
            height,
            url: s.url,
          }).catch(() => {});
        return (
          <div
            key={key}
            style={{
              position: "absolute",
              left,
              top,
              width,
              height,
              opacity: s.opacity,
              transform: s.rotation ? `rotate(${s.rotation}deg)` : undefined,
            }}
          >
            {isVideo ? (
              <video
                src={s.url}
                autoPlay
                loop
                muted={s.muted}
                playsInline
                onLoadedData={() => report(true)}
                onError={() => report(false)}
                style={{ width: "100%", height: "100%", objectFit: fit }}
              />
            ) : (
              <img
                src={s.url}
                alt=""
                onLoad={() => report(true)}
                onError={() => report(false)}
                style={{ width: "100%", height: "100%", objectFit: fit }}
              />
            )}
            {isFocus && <FocusOverlay mode={(focusMode ?? "move") as Handle} />}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Subtle pill shown in the corner whenever playback is paused (battery,
 * fullscreen app, or manual pause). Desktops sit under icons, so it uses a
 * solid dark chip with a slow-breathing dot — visible but not distracting.
 */
function PausedBadge() {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    invoke<boolean>("is_paused")
      .then(setPaused)
      .catch(() => {});
    const sub = listen<boolean>(EVENTS.WALLPAUSE, (e) => setPaused(e.payload));
    return () => {
      sub.then((f) => f()).catch(() => {});
    };
  }, []);

  if (!paused) return null;
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 font-sans text-[11px] font-medium tracking-wide text-neutral-300 ring-1 ring-white/10 backdrop-blur-sm">
      <span className="lumen-paused-dot inline-block h-2 w-2 rounded-full bg-neutral-400" />
      Paused
    </div>
  );
}

/** Brief pill shown when the config was reloaded from an external edit. */
function ReloadToast() {
  const [visible, setVisible] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const sub = listen<unknown>(EVENTS.CONFIG_RELOADED, () => {
      setVisible(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setVisible(false), 2500);
    });
    return () => {
      sub.then((f) => f()).catch(() => {});
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  return (
    <div
      aria-live="polite"
      className={`pointer-events-none fixed right-4 bottom-4 z-50 rounded-full bg-neutral-900/70 px-3 py-1.5 font-sans text-xs text-neutral-300 ring-1 ring-white/10 backdrop-blur transition-all var(--motion-slow) var(--ease-standard) ${
        visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      }`}
    >
      Wallpaper settings reloaded
    </div>
  );
}

type MediaIdentity = { kind: WallpaperKind; source: string };

/** The media element currently on screen (tagged layer), for RGB sampling. */
function sampleSource(): CanvasImageSource | null {
  const host = document.querySelector("[data-sample]");
  if (!host) return null;
  // Prefer the visible presentation canvas over a hidden source video.
  const el = host.querySelector("canvas, img") ?? host.querySelector("video");
  return (el as CanvasImageSource | null) ?? null;
}

/**
 * Blits a hidden <video> element's frames onto a canvas every animation
 * frame. Canvas pixels composite in the normal DOM tree, so layers above
 * (stickers) always render — unlike direct <video> presentation, which
 * WebView2 can lift onto DirectComposition overlay planes that paint above
 * all other DOM content.
 */
function VideoCanvas({
  videoRef,
  fit,
  fx,
  onReady,
  framePush = true,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  fit: CSSProperties["objectFit"];
  fx?: { speed: number; brightness: number; saturation: number; hue: number };
  onReady: () => void;
  /** Only the primary monitor's window captures the OS-background frame;
   * secondary windows render the same source and would push near-identical
   * (but not byte-identical) JPEGs that defeat the backend's hash dedup. */
  framePush?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const readyRef = useRef(false);
  // onReady may be a new function identity each parent render (it's an inline
  // arrow); keeping it in a ref lets the blit effect avoid depending on it.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  // Live-frame throttle state lives OUTSIDE the blit effect on purpose: the
  // effect re-runs (and would otherwise reset these) whenever a parent render
  // hands us a new onReady identity, which happens on every info poll.
  const pushStateRef = useRef({ pushedForSource: "", lastFramePush: 0 });
  const framePushRef = useRef(framePush);
  framePushRef.current = framePush;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!ctx) return;
    let raf = 0;
    let running = true;
    const drewRef = { current: false };
    const pushState = pushStateRef.current;
    // Last media time blitted: when it hasn't advanced (same frame decoded,
    // or a duplicate rAF tick), skip the fill+draw — repeating an identical
    // 4K blit costs real GPU time and can drop frames on integrated GPUs.
    let lastT = -1;
    let lastW = 0;
    let lastH = 0;
    // Native-fps estimate: the smallest currentTime advance between decoded
    // frames is one source frame (1/fps). rAF fires at display rate (60–144
    // Hz); for a 24fps source that's 2–6 redundant full-canvas blits per
    // frame. Skipping ticks closer together than one source frame (~85% of
    // the measured interval, to absorb timing jitter) roughly halves the blit
    // cost for typical anime loops and cuts it ~6x for 24fps on 144Hz panels.
    let minFrameDelta = 0; // 0 = unknown: blit every tick until measured
    const frameDeltas: number[] = [];
    let lastBlitWall = 0;
    // Dev-only cadence counters: every 10s, log rAF ticks, ticks where media
    // time advanced (= what an unthrottled loop would blit), and actual blits
    // (= what this loop blits). The gap between the last two is the savings.
    let ticks = 0;
    let advanced = 0;
    let blits = 0;
    const measure = import.meta.env.DEV
      ? window.setInterval(
          () =>
            logLine(
              `blit cadence: raf=${(ticks / 10).toFixed(1)}/s advanced=${(advanced / 10).toFixed(1)}/s blits=${(blits / 10).toFixed(1)}/s saved=${(((advanced - blits) / Math.max(1, advanced)) * 100).toFixed(0)}% cap=${minFrameDelta.toFixed(1)}ms`,
              "debug",
            ),
          10_000,
        )
      : 0;

    // Cached geometry: reading getBoundingClientRect every frame forces
    // style/layout recalc and is a classic rAF jank source. Recompute only
    // when the canvas actually resizes (window/monitor changes).
    let pw = 0;
    let ph = 0;
    let coversAll = false; // blit fills the whole canvas (no letterbox)
    const syncGeometry = () => {
      const rect = canvas.getBoundingClientRect();
      // Cap the backing resolution at 1080p-height equivalent when the
      // display is very dense: a 4K blit at 60fps costs real GPU time and
      // the visual difference behind desktop icons is imperceptible.
      const dpr = Math.min(window.devicePixelRatio || 1, Math.max(1, 2160 / Math.max(1, rect.height)));
      pw = Math.max(1, Math.round(rect.width * dpr));
      ph = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
    };
    const ro = new ResizeObserver(() => syncGeometry());
    ro.observe(canvas);
    syncGeometry();

    const blit = () => {
      // Re-read on every tick: the <video> element can be remounted under us
      // (decode-error retry recreates it via videoEpoch) — a video captured
      // once at effect start would leave the canvas frozen on a dead element.
      const video = videoRef.current;
      if (!video) return;
      const t = video.currentTime;
      // Native-fps throttle: media-time deltas between consecutive renders
      // are noisy, so we estimate the frame interval as the median of recent
      // deltas (clamped to 8–240fps plausibility) rather than the minimum.
      const nowWall = performance.now();
      const tAdvanced = t !== lastT;
      if (tAdvanced) advanced++;
      ticks++;
      // Record the media-time delta between consecutive rendered frames to
      // refine the interval estimate (clamped to 8–240fps plausibility).
      if (t !== lastT && lastT >= 0 && t > lastT) {
        const d = t - lastT;
        if (d >= 1 / 240 && d <= 1 / 8) {
          frameDeltas.push(d);
          if (frameDeltas.length > 20) frameDeltas.shift();
          if (frameDeltas.length >= 5) {
            const sorted = [...frameDeltas].sort((a, b) => a - b);
            const mid = sorted[Math.floor(sorted.length / 2)] ?? sorted[0];
            if (mid !== undefined) minFrameDelta = mid * 1000;
          }
        }
      }
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (
        drewRef.current &&
        t === lastT &&
        vw === lastW &&
        vh === lastH &&
        video.readyState >= 2 &&
        !video.seeking
      ) {
        return; // frame unchanged: canvas keeps showing the last blit
      }
      // Native-fps throttle: this tick's media time advanced, but if the last
      // blit was less than one source frame ago the presentation would either
      // duplicate the same decoded frame or tear. Wait for the next tick.
      if (tAdvanced && minFrameDelta > 0 && nowWall - lastBlitWall < minFrameDelta * 0.85) {
        return;
      }
      lastT = t;
      lastW = vw;
      lastH = vh;
      lastBlitWall = nowWall;
      blits++;
      if (!readyRef.current) {
        readyRef.current = true;
        onReadyRef.current();
      }
      drewRef.current = true;
      const isCover = fitRef.current === "cover";
      const isFill = fitRef.current === "fill";
      const scale = isFill || isCover
        ? Math.max(pw / vw, ph / vh)
        : Math.min(pw / vw, ph / vh); // contain (letterbox)
      const dw = isFill ? pw : vw * scale;
      const dh = isFill ? ph : vh * scale;
      const dx = (pw - dw) / 2;
      const dy = (ph - dh) / 2;
      // Skip the clear when the frame fully covers the canvas (cover/fill at
      // or beyond canvas size): a full clear + full redraw is one extra
      // fill pass over 8M+ pixels per frame for zero visual change.
      coversAll = dx <= 0.5 && dy <= 0.5 && dw >= pw - 1 && dh >= ph - 1;
      if (!coversAll) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, pw, ph);
      }
      ctx.drawImage(video, dx, dy, dw, dh);

      // Push a real captured frame to the backend as the Windows desktop /
      // lock-screen background and decode-failure fallback — once per
      // source change (after a short settle delay so it's a mid-loop frame,
      // not the first), plus at most every 30 minutes for the same source.
      if (!framePushRef.current) return;
      const now = Date.now();
      const src = video.src;
      const sourceChanged = pushState.pushedForSource !== src;
      const dueForRefresh = now - pushState.lastFramePush > 30 * 60_000;
      const settleWait =
        pushState.lastFramePush !== 0 && now < pushState.lastFramePush + 4_000;
      if ((sourceChanged && !settleWait) || dueForRefresh) {
        // Skip the push when the frame is essentially black: a video stuck in
        // a decode-error loop still "blits" fine but carries no imagery, and
        // a black capture would overwrite the good shell-extracted poster.
        const sample = ctx.getImageData(0, 0, Math.min(pw, 64), Math.min(ph, 36));
        let dark = 0;
        const total = sample.data.length / 4;
        for (let i = 0; i < sample.data.length; i += 4) {
          const r = sample.data[i] ?? 0;
          const g = sample.data[i + 1] ?? 0;
          const b = sample.data[i + 2] ?? 0;
          if (Math.max(r, g, b) < 12) dark++;
        }
        if (dark / total > 0.9) {
          pushState.lastFramePush = 0; // retry on a later, hopefully-rendered frame
          return;
        }
        pushState.pushedForSource = src;
        pushState.lastFramePush = now;
        canvas.toBlob(
          (blob) => {
            if (!blob) return;
            blob
              .arrayBuffer()
              .then((buf) =>
                invoke("set_live_frame", {
                  frame: Array.from(new Uint8Array(buf)),
                  source: src,
                }),
              )
              .catch(() => {});
          },
          "image/jpeg",
          0.85,
        );
      }
    };

    // Frame-cadence: rAF loop. (requestVideoFrameCallback was tried here,
    // but its handle is bound to the <video> element — when decode-retry
    // remounts the element the chain dies and the canvas freezes.) The
    // duplicate-frame skip below makes redundant rAF ticks nearly free.
    const onFrame = () => {
      if (!running) return;
      // While paused, freeze on the last drawn frame instead of skipping
      // entirely: a canvas that was never blitted (pause active at startup,
      // e.g. on-battery auto-pause) shows as transparent black — an all-black
      // desktop. Keep blitting until the first successful draw, then stop
      // redrawing (canvas content persists) to save GPU while paused.
      if (!(pausedGlobal && !document.hasFocus() && drewRef.current)) {
        blit();
      }
      raf = requestAnimationFrame(onFrame);
    };
    raf = requestAnimationFrame(onFrame);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (measure) window.clearInterval(measure);
    };
    // onReady intentionally excluded: read through a ref (see above) so the
    // effect isn't torn down on every parent re-render — restarting it reset
    // the live-frame throttle and caused a push per poll cycle.
  }, []);

  // Playback-rate control (live config updates included).
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !fx) return;
    const rate = Math.min(8, Math.max(0.1, fx.speed || 1));
    const apply = () => (video.playbackRate = rate);
    apply();
    video.addEventListener("loadedmetadata", apply);
    return () => video.removeEventListener("loadedmetadata", apply);
  }, [videoRef, fx?.speed]);

  const filter = fx
    ? `brightness(${fx.brightness}) saturate(${fx.saturation}) hue-rotate(${fx.hue}deg)`
    : undefined;
  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full"
      style={{ objectFit: fit, filter }}
    />
  );
}

/**
 * One self-contained media surface (video/image/shader/web/slideshow).
 * Reports readiness via `onReady` so MediaStage can keep the previous
 * wallpaper visible while the new one loads, then crossfade instead of
 * flashing black.
 */
function MediaSurface({
  kind,
  source,
  fit,
  volume,
  fx,
  slideshow,
  screen,
  onReady,
  style,
  fallback,
}: {
  kind: WallpaperKind;
  source: string;
  fit: VideoFit;
  volume: number;
  fx?: { speed: number; brightness: number; saturation: number; hue: number };
  slideshow: Config["wallpaper"]["slideshow"];
  screen: MonitorInfo;
  onReady?: () => void;
  style?: CSSProperties;
  fallback?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [shaderOk, setShaderOk] = useState(true);
  const [videoFitStyle, setVideoFitStyle] = useState<CSSProperties["objectFit"]>("cover");
  const [videoFailed, setVideoFailed] = useState(false);
  // Bumped to force React to recreate the <video> element after a decode
  // pipeline error (PIPELINE_ERROR_DISCONNECTED fires mid-playback when the
  // software decoder stalls; a remount rebuilds the pipeline).
  const [videoEpoch, setVideoEpoch] = useState(0);
  const videoRetries = useRef(0);
  const [slideFiles, setSlideFiles] = useState<string[]>([]);
  const [slideIdx, setSlideIdx] = useState(0);
  const [fade, setFade] = useState(1);

  const armed = useRef(false);
  const fireReady = () => {
    if (armed.current) return;
    armed.current = true;
    onReady?.();
  };

  // A new source gets a clean failure slate (the error state is per-source).
  useEffect(() => {
    setVideoFailed(false);
    videoRetries.current = 0;
  }, [source]);

  // Resolution-aware video fit once the video metadata is known. Inline style
  // (not a class) so the value never depends on Tailwind's static-class scan.
  useEffect(() => {
    if (kind !== "video") return;
    const v = videoRef.current;
    if (!v) return;
    const apply = () =>
      setVideoFitStyle(effectiveVideoFit(fit, v.videoWidth, v.videoHeight, screen.w, screen.h));
    if (v.videoWidth) apply();
    v.addEventListener("loadedmetadata", apply);
    return () => v.removeEventListener("loadedmetadata", apply);
  }, [kind, fit, screen.w, screen.h, source]);

  // Slideshow file list.
  useEffect(() => {
    if (kind !== "slideshow") return;
    invoke<string[]>("list_images", { folder: slideshow.folder ?? "" })
      .then((files) => {
        setSlideFiles(files);
        setSlideIdx(0);
        if (files.length === 0) fireReady();
      })
      .catch((e) => {
        console.error(e);
        fireReady();
      });
  }, [kind, slideshow.folder]);

  // Slideshow ticker + crossfade.
  useEffect(() => {
    if (kind !== "slideshow" || slideFiles.length < 2) return;
    const interval = (slideshow.intervalSec ?? 30) * 1000;
    const iv = setInterval(() => {
      setFade(0);
      setSlideIdx((i) => (i + 1) % slideFiles.length);
      setTimeout(() => setFade(1), 50);
    }, interval);
    return () => clearInterval(iv);
  }, [kind, slideFiles.length, slideshow.intervalSec]);

  // Shader setup (ready immediately — the canvas paints on schedule).
  useEffect(() => {
    if (kind !== "shader") return;
    const canvas = canvasRef.current;
    const fail = () => {
      setShaderOk(false);
      fireReady();
    };
    if (!canvas) {
      fail();
      return;
    }
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false });
    if (!gl) {
      fail();
      return;
    }
    const prog = compileShaderProgram(gl, SHADER_SOURCES[source] ?? SHADER_SOURCES["aurora"]!);
    if (!prog) {
      fail();
      return;
    }
    gl.useProgram(prog);
    const uRes = gl.getUniformLocation(prog, "uRes");
    const uTime = gl.getUniformLocation(prog, "uTime");
    let raf = 0;
    // Render at the monitor's native resolution (4K-capped for GPU safety)
    // and re-fit if the display geometry changes.
    const resize = () => {
      const { width, height } = shaderCanvasSize(screen.w, screen.h);
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    const start = performance.now();
    const loop = (t: number) => {
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, (t - start) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    fireReady();
    return () => cancelAnimationFrame(raf);
  }, [kind, source, screen.w, screen.h]);

  if (kind === "web") {
    return (
      <iframe
        src={source}
        className="h-full w-full border-0"
        sandbox="allow-scripts allow-same-origin"
        title="LumenDeck web wallpaper"
        style={style}
        onLoad={() => fireReady()}
      />
    );
  }

  if (kind === "shader") {
    return shaderOk ? (
      <canvas ref={canvasRef} className="h-full w-full" style={style} />
    ) : (
      <div
        style={style}
        className="flex h-full w-full items-center justify-center bg-neutral-950 font-sans text-sm text-neutral-600"
      >
        WebGL unavailable
      </div>
    );
  }

  if (kind === "video") {
    // Canvas presentation: the hidden <video> drives playback, decoding, and
    // zone sampling; VideoCanvas blits frames into the normal compositor tree
    // so sticker layers above the wallpaper always render (direct <video>
    // can be promoted to overlay planes that paint over all DOM content).
    return (
      <div
        className="flex h-full w-full items-center justify-center overflow-hidden bg-black"
        style={style}
      >
        {/* Fallback: the backend's poster-frame snapshot of this source. When
            the video 404s or the codec is unsupported, the desktop shows the
            still image instead of a black void. Rendered underneath, so it
            also shows through during decode startup. */}
        {fallback && (
          <img
            src={fallback}
            alt=""
            crossOrigin="anonymous"
            className="absolute inset-0 h-full w-full object-cover"
            style={{ visibility: videoFailed ? "visible" : "hidden" }}
          />
        )}
        <video
          key={videoEpoch}
          ref={videoRef}
          src={source}
          autoPlay
          loop
          // Required so the sampling canvas stays untainted (media is served
          // cross-origin from media.localhost with ACAO: *).
          crossOrigin="anonymous"
          preload="auto"
          muted={volume === 0}
          playsInline
          style={{ display: "none" }}
          onWaiting={() => {
            // Buffer underrun mid-loop: nudge playback as soon as data
            // returns so the loop resumes without a long freeze.
            videoRef.current?.play().catch(() => {});
          }}
          onStalled={() => videoRef.current?.play().catch(() => {})}
          onLoadedData={() => {
            videoRetries.current = 0;
            logLine(`video loaded-data ok src=${source} ${videoRef.current?.videoWidth}x${videoRef.current?.videoHeight}`, "debug");
            // Occluded/background webviews may refuse autoplay: retry once.
            videoRef.current?.play().catch(() => {});
            fireReady();
          }}
          onError={() => {
            const err = videoRef.current?.error;
            logLine(`video ERROR src=${source} code=${err?.code} msg=${err?.message}`, "error");
            // A decode-pipeline collapse (DISCONNECTED/DECODE) is often
            // transient: rebuild the element with backoff instead of
            // permanently dropping to the poster frame.
            if (videoRetries.current < 3) {
              const delay = 1000 * 2 ** videoRetries.current;
              videoRetries.current += 1;
              logLine(`video retry ${videoRetries.current}/3 in ${delay}ms src=${source}`, "debug");
              window.setTimeout(() => setVideoEpoch((n) => n + 1), delay);
              return;
            }
            setVideoFailed(true);
            // A failed source must not wedge the crossfade: release the
            // stage so the layer timeout / prune logic can take over.
            fireReady();
          }}
        />
        <VideoCanvas
          videoRef={videoRef}
          fit={videoFitStyle}
          fx={fx}
          onReady={fireReady}
          framePush={screen.primary}
        />
      </div>
    );
  }

  if (kind === "slideshow") {
    const src = slideFiles[slideIdx];
    return (
      <img
        ref={imgRef}
        src={src}
        alt=""
        crossOrigin="anonymous"
        className="object-cover transition-opacity var(--motion-slow) var(--ease-standard)"
        style={{
          width: "100%",
          height: "100%",
          ...style,
          opacity: fade * (typeof style?.opacity === "number" ? style.opacity : 1),
        }}
        onLoad={() => fireReady()}
      />
    );
  }

  return (
    <img
      ref={imgRef}
      src={source}
      alt=""
      crossOrigin="anonymous"
      className="object-cover"
      style={{ width: "100%", height: "100%", ...style }}
      onLoad={() => fireReady()}
      onError={(e) => console.error("wallpaper image error", e)}
    />
  );
}

function MediaStage({ info, zones }: { info: WallpaperInfo | null; zones: ZoneDef[] }) {
  const kind = info?.config.kind;
  const source = info?.source ?? "";
  const target: MediaIdentity | null = kind && info ? { kind, source } : null;
  // Latest info for the sampling loop (monitor device/primary tags) without
  // re-subscribing the interval on every geometry update.
  const infoRef = useRef(info);
  infoRef.current = info;

  // Stack of layered identities, bottom = oldest, top = newest. Older layers
  // stay fully visible until the newest one reports ready, then the top fades
  // in while the rest fade out; the stack is pruned back to a single layer so
  // the on-screen media element is never remounted (no rebuffer black frame).
  const [shown, setShown] = useState<MediaIdentity[]>([]);
  const [topReady, setTopReady] = useState(true);

  // Derived so the very first paint shows the target without an empty frame
  // while the seed effect below fills `shown`.
  const layers = shown.length > 0 ? shown : target ? [target] : [];

  // Seed on first payload, then stage a new layer whenever the wallpaper
  // identity changes (kind or source).
  useEffect(() => {
    if (!target) return;
    if (shown.length === 0) {
      setShown([target]);
      setTopReady(true);
      return;
    }
    const top = shown[shown.length - 1];
    if (top && top.kind === target.kind && top.source === target.source) return;
    const idx = shown.findIndex((x) => x.kind === target.kind && x.source === target.source);
    if (idx >= 0) {
      // Already in the stack (user switched back mid-crossfade): jump there.
      setShown(shown.slice(idx));
      setTopReady(true);
      return;
    }
    setShown((s) => [...s, target]);
    setTopReady(false);
  }, [target?.kind, target?.source, target, shown]);

  // Once the top layer is ready, crossfade then prune to it. The duration
  // comes from the active playlist (playlist transitions get a slow, visible
  // fade; manual/dashboard changes keep the quick 300ms default).
  // Also treat an unmounting stage as fade completion: clearing `shown` (e.g.
  // wallpaper disable) must not leave a stale layer stack behind.
  const fadeMs = Math.max(0, info?.crossfadeSec ?? 0) > 0
    ? Math.min(Math.max((info?.crossfadeSec ?? 0) * 1000, 300), 10_000)
    : 300;
  useEffect(() => {
    if (shown.length < 2 || !topReady) return;
    const t = window.setTimeout(() => {
      setShown((s) => [s[s.length - 1]!]);
    }, fadeMs + 20);
    return () => window.clearTimeout(t);
  }, [shown, topReady, fadeMs]);

  // Safety net: if the top layer never reports ready (dead source, decode
  // error, 404), force the crossfade after 8s so the stage never strands on a
  // black layer with the old wallpaper stuck underneath at opacity 1.
  useEffect(() => {
    if (shown.length < 2 || topReady) return;
    const t = window.setTimeout(() => {
      console.warn("wallpaper layer timed out; forcing crossfade");
      setTopReady(true);
    }, 8000);
    return () => window.clearTimeout(t);
  }, [shown, topReady]);

  // Zone sampling loop (video/image/slideshow/shader).
  useEffect(() => {
    if (!kind || kind === "web") return;
    let stopped = false;
    const w = 64;
    const h = 36;
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const tick = async () => {
      if (stopped) return;
      try {
        const el = sampleSource();
        if (el && !(pausedGlobal && kind !== "shader")) {
          ctx.drawImage(el as CanvasImageSource, 0, 0, w, h);
          const data = ctx.getImageData(0, 0, w, h).data;
          const buf: PixelBuf = { data, w, h };
          const zoneRects: ZoneRect[] = zones.map((z) => ({ id: z.id, x: z.x, y: z.y, w: z.w, h: z.h }));
          const mon = infoRef.current?.monitor;
          const samples = computeSamples(buf, zoneRects, mon?.device ?? "", !!mon?.primary);
          await invoke("send_zone_samples", { samples });
        }
      } catch {
        // Media not ready yet; retry on the next tick.
      }
      // 100ms matches the engine's default reactive push interval; sampling
      // faster than the engine consumes wastes getImageData calls.
      setTimeout(tick, 100);
    };
    tick();
    return () => {
      stopped = true;
    };
  }, [kind, zones]);

  if (!info) return null;

  const screen = info.monitor ?? { w: 1920, h: 1080, x: 0, y: 0, device: "", primary: false };
  const fit = (info.config.videoFit ?? "auto") as VideoFit;
  const volume = info.config.volume ?? 0;
  const videoFx = {
    speed: info.config.videoSpeed ?? 1,
    brightness: info.config.videoBrightness ?? 1,
    saturation: info.config.videoSaturation ?? 1,
    hue: info.config.videoHue ?? 0,
  };
  const slideshow = info.config.slideshow;
  const single = layers.length === 1;
  // Show the pill on first load too, not only during crossfades.
  const loading = !topReady || (layers.length > 1 && !topReady);

  return (
    <div className="relative h-full w-full">
      {loading && (
        <div className="pointer-events-none fixed inset-x-0 top-6 z-40 flex justify-center">
          <div className="flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 font-sans text-xs text-white ring-1 ring-white/10 backdrop-blur">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border border-white/25 border-t-white" />
            Loading wallpaper…
          </div>
        </div>
      )}
      {layers.map((ident, i) => {
        const isTop = i === layers.length - 1;
        const opacity = single
          ? 1
          : isTop
            ? topReady
              ? 1
              : 0
            : topReady
              ? 0
              : 1;
        return (
          <div
            key={`${ident.kind}:${ident.source}`}
            className="absolute inset-0"
            data-sample={opacity >= 1 ? "" : undefined}
          >
            <MediaSurface
              kind={ident.kind}
              source={ident.source}
              fit={fit}
              volume={volume}
              fx={videoFx}
              slideshow={slideshow}
              screen={screen}
              fallback={info.fallbackSource || undefined}
              onReady={isTop ? () => setTopReady(true) : undefined}
              style={{
                opacity,
                transition: single ? undefined : `opacity ${fadeMs}ms ease`,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<WallpaperRoot />);

// Last-resort diagnostics: uncaught errors and rejected promises in the
// wallpaper webview otherwise vanish (no devtools in normal runs). Rate
// limiting lives on the backend side of log_frontend.
window.addEventListener("error", (e) => {
  logLine(`uncaught: ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`, "error");
});
window.addEventListener("unhandledrejection", (e) => {
  logLine(`unhandled rejection: ${e.reason}`, "error");
});
