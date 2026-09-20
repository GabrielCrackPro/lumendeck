import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useStore } from "../../store";
import { IconBulb, IconImage, IconSticker, IconRefresh, IconGlobe, IconLayers } from "../icons";
import { api } from "../../ipc";
import { SHADERS } from "@shared/constants";

const SHADER_ART: Record<string, string> = {
  aurora:
    "conic-gradient(from 210deg at 60% 20%, #06281b 0%, #0f7a4d 30%, #25c07a 50%, #0b1026 75%, #06281b 100%)",
  liquid:
    "conic-gradient(from 40deg at 40% 80%, #02021e 0%, #2743c9 40%, #9333ea 70%, #02021e 100%)",
  plasma:
    "conic-gradient(from 300deg at 50% 50%, #1a0033 0%, #c026d3 45%, #f97316 80%, #1a0033 100%)",
  starfield:
    "radial-gradient(60% 60% at 30% 25%, #334155 0%, #0f172a 45%, #000000 100%)",
};

/** Compact wallpaper thumb: video plays muted, image static, shader art. */
function WallpaperThumb({
  kind,
  source,
  paused,
}: {
  kind: string;
  source: string;
  paused: boolean;
}) {
  const mediaUrl = convertFileSrc(source, "media");
  return (
    <div className="group relative h-24 w-40 shrink-0 overflow-hidden rounded-xl border border-[var(--line)] bg-black">
      {kind === "video" && source ? (
        <video
          key={mediaUrl}
          src={mediaUrl}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
        />
      ) : kind === "image" && source ? (
        <img src={mediaUrl} alt="" className="h-full w-full object-cover" />
      ) : kind === "shader" ? (
        <div className="h-full w-full" style={{ background: SHADER_ART[source] ?? SHADER_ART.aurora }} />
      ) : kind === "web" ? (
        <div className="flex h-full w-full items-center justify-center text-[var(--text-faint)]">
          <IconGlobe className="h-6 w-6" />
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[var(--text-faint)]">
          <IconLayers className="h-6 w-6" />
        </div>
      )}
      {paused && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 font-mono text-[9px] uppercase tracking-widest text-amber-200">
          paused
        </div>
      )}
    </div>
  );
}

/** Pill-style mini stat for the top strip. */
function MiniStat({
  label,
  ok,
  value,
}: {
  label: string;
  ok: boolean | null;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-full border border-[var(--line)] bg-[var(--panel-strong)] py-1.5 pl-3 pr-4">
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          ok === null
            ? "bg-[var(--line-strong)]"
            : ok
              ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]"
              : "bg-[var(--text-faint)]"
        }`}
      />
      <span className="kicker shrink-0">{label}</span>
      <span className="truncate text-xs font-semibold text-[var(--text)]">{value}</span>
    </div>
  );
}

export default function OverviewTab({ onNavigate }: { onNavigate: (t: string) => void }) {
  const { cfg, rgb, wallpaperPaused, deviceColors } = useStore();
  const [mons, setMons] = useState<
    { device: string; x: number; y: number; w: number; h: number; primary: boolean }[]
  >([]);

  useEffect(() => {
    api.monitors().then(setMons).catch(() => setMons([]));
  }, []);

  if (!cfg) return null;

  const activeStickers = cfg.stickers.filter((s) => s.visible).length;
  const ledTotal = rgb.devices.reduce((n, d) => n + d.leds, 0);
  const wallOff = !cfg.general.wallpaperEnabled;
  const paused = wallOff || wallpaperPaused;
  const modeLabel = cfg.rgb.enabled
    ? cfg.rgb.mode.charAt(0).toUpperCase() + cfg.rgb.mode.slice(1)
    : "Off";
  const liveColors = Object.values(deviceColors);

  const shortcuts = [
    { id: "rgb", label: "Lighting", detail: `${rgb.connected ? ledTotal.toLocaleString() + " LEDs" : "offline"}`, Icon: IconBulb },
    { id: "wallpaper", label: "Wallpaper", detail: `${cfg.gallery.length} in vault`, Icon: IconImage },
    { id: "stickers", label: "Stickers", detail: `${activeStickers} on desktop`, Icon: IconSticker },
  ];

  return (
    <div className="w-full">
      <div className="stagger space-y-5">
        {/* Hero: wallpaper preview + identity */}
        <div className="glass relative overflow-hidden">
          <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          <div className="flex items-center gap-5 p-5">
            <WallpaperThumb
              kind={cfg.wallpaper.kind}
              source={cfg.wallpaper.source}
              paused={paused}
            />
            <div className="min-w-0 flex-1">
              <div className="kicker mb-1">current wallpaper</div>
              <div className="lednum truncate text-lg text-[var(--text)]">
                {cfg.wallpaper.kind === "shader"
                  ? (SHADERS.find((s) => s.id === cfg.wallpaper.source)?.label ?? cfg.wallpaper.source)
                  : cfg.wallpaper.source
                    ? cfg.wallpaper.source.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "")
                    : "Nothing applied"}
              </div>
              <div className="mt-1 truncate font-mono text-[11px] text-[var(--text-faint)]">
                {cfg.wallpaper.kind} · {mons.length || "…"} display{mons.length === 1 ? "" : "s"}
                {mons.length > 1 && ` (${mons.map((m) => `${m.w}×${m.h}`).join(", ")})`}
              </div>
              <button
                onClick={() => onNavigate("wallpaper")}
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-2.5 py-1 text-xs font-semibold text-[var(--text-dim)] transition-all hover:border-[rgb(var(--glow)/0.5)] hover:text-[rgb(var(--glow))]"
              >
                Change wallpaper
              </button>
            </div>
          </div>
        </div>

        {/* Status strip */}
        <div className="flex flex-wrap items-center gap-2.5">
          <MiniStat
            label="openrgb"
            ok={rgb.connected}
            value={rgb.connected ? `${rgb.devices.length} devices · ${ledTotal.toLocaleString()} LEDs` : "offline"}
          />
          <MiniStat
            label="lighting"
            ok={cfg.rgb.enabled ? true : null}
            value={modeLabel}
          />
          <MiniStat
            label="stickers"
            ok={true}
            value={`${activeStickers} active`}
          />
          <button
            onClick={() => useStore.getState().load()}
            className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--panel-strong)] px-3 text-[var(--text-faint)] transition-colors hover:text-[rgb(var(--glow))]"
            aria-label="Refresh status"
          >
            <IconRefresh className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Live device colors (only when frames flow) */}
        {liveColors.length > 0 && (
          <div className="glass">
            <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            <div className="flex items-center gap-3 p-4">
              <div className="kicker shrink-0">device colors</div>
              <div className="flex min-w-0 flex-1 gap-1.5 overflow-hidden">
                {liveColors.map((d) => (
                  <span
                    key={d.id}
                    className="h-6 flex-1 min-w-6 rounded-md"
                    style={{
                      background: `rgb(${d.rgb[0]} ${d.rgb[1]} ${d.rgb[2]})`,
                      boxShadow: `0 0 10px -2px rgb(${d.rgb[0]} ${d.rgb[1]} ${d.rgb[2]})`,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Shortcut cards */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {shortcuts.map(({ id, label, detail, Icon }) => (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              className="glass group flex flex-col items-start gap-2 p-4 text-left transition-all hover:border-[rgb(var(--glow)/0.5)]"
            >
              <Icon className="h-5 w-5 text-[rgb(var(--glow))]" />
              <span className="text-sm font-semibold text-[var(--text)]">{label}</span>
              <span className="text-[11px] text-[var(--text-faint)]">{detail}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
