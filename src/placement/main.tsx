// Placement overlay runtime (one instance per monitor): draws a dimmed veil,
// a sticker preview following the cursor, +/- resize pad, and corner-zone
// quick-place buttons. The overlay window is WS_EX_TRANSPARENT by default
// (clicks pass through to the desktop); it flips to input-accepting only
// while the cursor hovers its control pad, so placement clicks always work.
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { EVENTS } from "@shared/constants";
import "../runtime.css";

interface MonitorInfo {
  device: string;
  x: number;
  y: number;
  w: number;
  h: number;
  primary: boolean;
}

const PREVIEW = 220;
const STEP = 24;

function PlacementRoot() {
  const [info, setInfo] = useState<{
    monitor: MonitorInfo;
    scale: number;
    url: string;
    name: string;
  } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [sizePx, setSizePx] = useState(220);
  const [padHover, setPadHover] = useState(false);

  useEffect(() => {
    invoke<{
      monitor: MonitorInfo;
      scale: number;
      url: string | null;
      name: string | null;
    }>("get_placement_info")
      .then((p) => {
        if (p.url) {
          setInfo({ monitor: p.monitor, scale: p.scale, url: p.url, name: p.name ?? "sticker" });
        }
      })
      .catch(() => {});

    // Late push from the backend (window created before pending set).
    (window as unknown as {
      __placementSet: (p: { url: string; name: string }) => void;
    }).__placementSet = (p) => {
      invoke<{ monitor: MonitorInfo; scale: number }>("get_placement_info")
        .then((pi) => {
          if (pi) {
            setInfo({ monitor: pi.monitor, scale: pi.scale, url: p.url, name: p.name });
          }
        })
        .catch(() => {});
    };

    const unsubs = [
      listen<[number, number]>(EVENTS.PLACING_CURSOR, (e) => {
        setCursor({ x: e.payload[0], y: e.payload[1] });
      }),
      listen<number>(EVENTS.PLACING_SIZE, (e) => {
        setSizePx(e.payload);
      }),
      listen<string | null>(EVENTS.PLACING, (e) => {
        if (!e.payload) window.close();
      }),
    ];
    return () => {
      unsubs.forEach((u) => u.then((f) => f()).catch(() => {}));
    };
  }, []);

  // Input-transparency toggling: only accept OS input while the cursor is on
  // the control pad, so placement clicks on the desktop always pass through.
  useEffect(() => {
    invoke("placement_set_interactive", { interactive: padHover }).catch(() => {});
  }, [padHover]);

  if (!info) return null;
  const dpr = info.scale > 0 ? info.scale : 1;
  const mon = info.monitor;
  // Cursor physical screen px -> local logical px.
  const cx = ((cursor?.x ?? mon.x + mon.w / 2) - mon.x) / dpr;
  const cy = ((cursor?.y ?? mon.y + mon.h / 2) - mon.y) / dpr;
  const size = (cursor ? sizePx : PREVIEW) / dpr;
  const sizePhysical = cursor ? sizePx : PREVIEW;

  const resize = (dir: 1 | -1) => {
    setSizePx((s) => {
      const next = Math.min(2000, Math.max(48, s + dir * STEP));
      invoke("placement_resize", { delta: dir * 4 }).catch(() => {});
      return next;
    });
  };

  // Corner quick-place zones: bottom bar keeps controls stable & discoverable.
  const corners: { label: string; x: number; y: number }[] = [
    { label: "↖", x: mon.x + 10, y: mon.y + 10 },
    { label: "↗", x: mon.x + mon.w - 10, y: mon.y + 10 },
    { label: "↙", x: mon.x + 10, y: mon.y + mon.h - 10 },
    { label: "↘", x: mon.x + mon.w - 10, y: mon.y + mon.h - 10 },
  ];

  return (
    <div className="fixed inset-0 overflow-hidden">
      {/* dimmed veil: makes the "picking a spot" state obvious */}
      <div className="absolute inset-0 bg-sky-400/10 ring-2 ring-inset ring-sky-300/40" />
      {/* sticker preview following the cursor */}
      <div
        className="pointer-events-none absolute flex items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-sky-300 bg-sky-400/10 shadow-[0_0_40px_rgba(56,189,248,0.35)]"
        style={{ left: cx - size / 2, top: cy - size / 2, width: size, height: size }}
      >
        <img src={info.url} alt="" className="max-h-full max-w-full object-contain" />
      </div>
      {/* crosshair at cursor */}
      <div
        className="pointer-events-none absolute"
        style={{ left: cx, top: cy }}
      >
        <div className="absolute h-5 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-sky-300/90" />
        <div className="absolute h-0.5 w-5 -translate-x-1/2 -translate-y-1/2 bg-sky-300/90" />
      </div>
      {/* hint pill */}
      <div className="absolute inset-x-0 top-5 flex justify-center">
        <div className="rounded-full bg-black/75 px-4 py-2 text-xs text-white ring-1 ring-white/15 backdrop-blur">
          Click to place · Scroll or use − / + to resize · Corners for quick placement
        </div>
      </div>
      {/* sticker name + size bottom-left */}
      <div className="absolute bottom-4 left-4 max-w-[40%] truncate rounded-full bg-black/60 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-white/80 backdrop-blur">
        {info.name} · {sizePhysical}px
      </div>

      {/*
        Control pad: input-accepting island. onMouseEnter/Leave flips the OS
        window between input-transparent and input-accepting, so desktop
        clicks still land while the pad isn't hovered.
      */}
      <div
        className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/15 bg-black/75 p-1 backdrop-blur"
        onMouseEnter={() => setPadHover(true)}
        onMouseLeave={() => setPadHover(false)}
      >
        <button
          onClick={() => resize(-1)}
          className="h-8 w-8 rounded-full text-lg font-semibold leading-none text-white transition-colors hover:bg-white/15"
          aria-label="Smaller sticker"
        >
          −
        </button>
        <span className="min-w-14 text-center font-mono text-[11px] tabular-nums text-white/80">
          {sizePhysical}
        </span>
        <button
          onClick={() => resize(1)}
          className="h-8 w-8 rounded-full text-lg font-semibold leading-none text-white transition-colors hover:bg-white/15"
          aria-label="Bigger sticker"
        >
          +
        </button>
        <span className="mx-1 h-5 w-px bg-white/15" />
        {corners.map((c) => (
          <button
            key={c.label}
            title={`Place in ${c.label} corner of this screen`}
            onClick={() => {
              // Corner placement: synthetic click via the backend place path.
              invoke("placement_place_at", { x: c.x, y: c.y }).catch(() => {});
            }}
            className="h-8 w-8 rounded-full text-sm text-white transition-colors hover:bg-sky-400/30"
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<PlacementRoot />);
