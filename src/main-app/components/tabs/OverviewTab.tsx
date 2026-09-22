import { useStore } from "../../store";
import { Card, Chip, DisplaysCard, IconBox, RefreshBtn } from "../ui";
import { IconBulb, IconImage, IconSticker, IconGlobe, IconLayers } from "../icons";
import { SHADERS, SHADER_ART } from "@shared/constants";
import { convertFileSrc } from "@tauri-apps/api/core";
import { basename } from "../../utilities";

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

export default function OverviewTab({ onNavigate }: { onNavigate: (t: string) => void }) {
  const { cfg, rgb, wallpaperPaused, deviceColors } = useStore();

  if (!cfg) return null;

  const stickers = cfg.stickers;
  const visibleStickers = stickers.filter((s) => s.visible);
  const excluded = new Set(cfg.rgb.excludedDevices);
  const activeDevices = rgb.devices.filter((d) => !excluded.has(d.id));
  const ledActive = activeDevices.reduce((n, d) => n + d.leds, 0);
  const paused = !cfg.general.wallpaperEnabled || wallpaperPaused;
  const idleOn = cfg.rgb.idleTimeoutSec > 0;
  const wallpaperName =
    cfg.wallpaper.kind === "shader"
      ? (SHADERS.find((s) => s.id === cfg.wallpaper.source)?.label ?? cfg.wallpaper.source)
      : cfg.wallpaper.source
        ? basename(cfg.wallpaper.source)
        : "Nothing applied";

  const shortcuts = [
    {
      id: "rgb",
      label: "Lighting",
      detail: rgb.connected
        ? `${activeDevices.length}/${rgb.devices.length} devices · ${ledActive.toLocaleString()} LEDs live`
        : "OpenRGB offline",
      Icon: IconBulb,
    },
    {
      id: "wallpaper",
      label: "Wallpaper",
      detail: `${cfg.gallery.length} in vault · ${wallpaperName}`,
      Icon: IconImage,
    },
    {
      id: "stickers",
      label: "Stickers",
      detail: stickers.length
        ? `${visibleStickers.length}/${stickers.length} visible`
        : "none placed yet",
      Icon: IconSticker,
    },
  ];

  return (
    <div className="stagger space-y-6">
      {/* Row 1: wallpaper identity + live system status */}
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card title="Current wallpaper">
          <div className="flex items-center gap-5">
            <WallpaperThumb
              kind={cfg.wallpaper.kind}
              source={cfg.wallpaper.source}
              paused={paused}
            />
            <div className="min-w-0 flex-1">
              <div className="lednum truncate text-lg text-[var(--text)]">{wallpaperName}</div>
              <div className="mt-1 truncate font-mono text-[11px] text-[var(--text-faint)]">
                {cfg.wallpaper.kind}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => onNavigate("wallpaper")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-2.5 py-1 text-xs font-semibold text-[var(--text-dim)] transition-all hover:border-[rgb(var(--glow)/0.5)] hover:text-[rgb(var(--glow))]"
                >
                  Change
                </button>
                {paused && (
                  <span className="inline-flex items-center rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-amber-300">
                    paused
                  </span>
                )}
              </div>
            </div>
          </div>
        </Card>

        <Card title="Lighting engine">
          <div className="flex items-start justify-between gap-3">
            <div className="lednum text-lg capitalize text-[var(--text)]">
              {cfg.rgb.enabled ? cfg.rgb.mode : "off"}
            </div>
            <Chip tone={rgb.connected ? "ok" : "idle"} pulse={rgb.connected}>
              {rgb.connected ? "openrgb" : "offline"}
            </Chip>
          </div>
          {/* live color bar per device */}
          <div className="mt-4 flex gap-1.5">
            {rgb.connected && activeDevices.length > 0 ? (
              activeDevices.map((d) => {
                const c = deviceColors[d.id]?.rgb;
                return (
                  <span
                    key={d.id}
                    title={`${d.name} · ${d.leds} LEDs`}
                    className="h-8 min-w-0 flex-1 rounded-md border border-[var(--line)] transition-colors duration-500"
                    style={{
                      background: c
                        ? `rgb(${c[0]} ${c[1]} ${c[2]})`
                        : "var(--panel-strong)",
                      boxShadow: c ? `0 0 12px -3px rgb(${c[0]} ${c[1]} ${c[2]})` : undefined,
                    }}
                  />
                );
              })
            ) : (
              <div className="h-8 w-full rounded-md border border-[var(--line)] bg-[var(--panel-strong)]" />
            )}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-[11px]">
            <div>
              <div className="text-[var(--text-faint)]">devices</div>
              <div className="text-[var(--text)]">
                {rgb.connected ? `${activeDevices.length}/${rgb.devices.length}` : "—"}
              </div>
            </div>
            <div>
              <div className="text-[var(--text-faint)]">leds live</div>
              <div className="text-[var(--text)]">
                {rgb.connected ? ledActive.toLocaleString() : "—"}
              </div>
            </div>
            <div>
              <div className="text-[var(--text-faint)]">idle off</div>
              <div className="text-[var(--text)]">{idleOn ? `${cfg.rgb.idleTimeoutSec}s` : "no"}</div>
            </div>
          </div>
        </Card>
      </div>

      {/* Row 2: displays + stickers */}
      <div className="grid gap-6 md:grid-cols-2">
        <DisplaysCard compact />

        <Card title="Stickers">
          {stickers.length === 0 ? (
            <button
              onClick={() => onNavigate("stickers")}
              className="flex w-full flex-col items-center gap-1.5 rounded-2xl border border-dashed border-[var(--line-strong)] py-7 text-[var(--text-faint)] transition-colors hover:border-[rgb(var(--glow)/0.5)] hover:text-[rgb(var(--glow))]"
            >
              <IconSticker className="h-5 w-5" />
              <span className="text-xs font-semibold">Place your first sticker</span>
            </button>
          ) : (
            <div className="space-y-2">
              {stickers.slice(0, 4).map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2"
                >
                  <img
                    src={s.url}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-lg border border-[var(--line)] bg-black/30 object-contain"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-[var(--text)]">{s.name}</div>
                    <div className="font-mono text-[10.5px] text-[var(--text-faint)]">
                      {Math.round(s.w)}×{Math.round(s.h)} · {s.onTop ? "on top" : "wallpaper layer"}
                    </div>
                  </div>
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      s.visible
                        ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]"
                        : "bg-[var(--text-faint)]"
                    }`}
                  />
                </div>
              ))}
              {stickers.length > 4 && (
                <button
                  onClick={() => onNavigate("stickers")}
                  className="text-xs font-semibold text-[var(--text-faint)] transition-colors hover:text-[rgb(var(--glow))]"
                >
                  +{stickers.length - 4} more — manage stickers
                </button>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Shortcut cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {shortcuts.map(({ id, label, detail, Icon }) => (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className="glass group flex items-center gap-3.5 p-4 text-left transition-all hover:border-[rgb(var(--glow)/0.5)]"
          >
            <IconBox variant="neutral" size="md">
              <Icon className="h-5 w-5 text-[rgb(var(--glow))]" />
            </IconBox>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[var(--text)]">{label}</span>
              <span className="block truncate text-[11px] text-[var(--text-faint)]">{detail}</span>
            </span>
          </button>
        ))}
        <RefreshBtn />
      </div>
    </div>
  );
}
