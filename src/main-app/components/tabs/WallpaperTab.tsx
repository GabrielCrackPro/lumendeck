import { useEffect, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useStore } from "../../store";
import { Card, Btn, Slider, Toggle, TextInput, NumberField } from "../ui";
import { IconImage, IconLayers, IconGlobe, IconMonitor, IconPlus, IconTrash } from "../icons";
import { SHADERS } from "@shared/constants";
import type { GalleryEntry, WallpaperKind, ZoneDef } from "@shared/types";
import { api } from "../../ipc";

const KIND_META: Record<WallpaperKind, { label: string }> = {
  video: { label: "Video" },
  image: { label: "Image" },
  slideshow: { label: "Slideshow" },
  web: { label: "Web" },
  shader: { label: "Shader" },
};

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

/** Thumbnail for a gallery entry: hover-playing video, image, or art tile. */
function GalleryThumb({ entry }: { entry: GalleryEntry }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);

  if (entry.kind === "video") {
    return (
      <div className="relative h-full w-full">
        <video
          ref={videoRef}
          src={convertFileSrc(entry.source, "media")}
          muted
          loop
          playsInline
          preload="none"
          className="h-full w-full object-cover"
          onMouseEnter={() => videoRef.current?.play().catch(() => {})}
          onMouseLeave={() => videoRef.current?.pause()}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
        {entry.thumb && !playing && (
          <img
            src={entry.thumb}
            alt={entry.name}
            className="absolute inset-0 h-full w-full bg-black/50 object-cover"
          />
        )}
        {!playing && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity group-hover:opacity-0">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur">
              <PlayMark />
            </span>
          </div>
        )}
      </div>
    );
  }
  if (entry.kind === "image") {
    return (
      <img
        src={entry.thumb ?? convertFileSrc(entry.source, "media")}
        alt={entry.name}
        className="h-full w-full bg-black/50 object-cover"
      />
    );
  }
  if (entry.kind === "shader") {
    return (
      <div
        className="h-full w-full transition-transform duration-500 group-hover:scale-105"
        style={{ background: SHADER_ART[entry.source] ?? SHADER_ART.aurora }}
      />
    );
  }
  const Icon = entry.kind === "web" ? IconGlobe : IconLayers;
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--panel-strong)] to-[var(--panel)]">
      <Icon className="h-7 w-7 text-[var(--text-faint)]" />
    </div>
  );
}

const PlayMark = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor">
    <path d="M7 5.5v13l11-6.5z" />
  </svg>
);

export default function WallpaperTab() {
  const { cfg, rgb, save } = useStore();
  const [busy, setBusy] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [dropCount, setDropCount] = useState(0);

  // Drag-and-drop import: Tauri intercepts file drops at the window level.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let importSeq = 0;

    getCurrentWebviewWindow()
      .onDragDropEvent((event) => {
        if (disposed) return;
        if (event.payload.type === "enter") {
          setDropCount(event.payload.paths.length);
          setDropActive(true);
        } else if (event.payload.type === "over") {
          setDropActive(true);
        } else if (event.payload.type === "drop") {
          setDropActive(false);
          const paths = event.payload.paths;
          if (paths.length === 0) return;
          const seq = ++importSeq;
          setBusy(true);
          api
            .galleryImportPaths(paths)
            .then((list) => {
              if (seq !== importSeq) return;
              console.info(`gallery: drop processed, ${list.length} item(s) in library`);
            })
            .catch((e) => console.error("gallery drop import failed:", e))
            .finally(() => {
              if (seq === importSeq) setBusy(false);
            });
        } else {
          setDropActive(false);
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  const [mons, setMons] = useState<
    { device: string; x: number; y: number; w: number; h: number; primary: boolean }[]
  >([]);

  useEffect(() => {
    api.monitors().then(setMons).catch(() => setMons([]));
  }, [cfg?.wallpaper.kind, cfg?.wallpaper.source]);

  if (!cfg) return null;
  const wall = cfg.wallpaper;
  const gallery = [...cfg.gallery].sort((a, b) => b.addedMs - a.addedMs);
  const isActive = (g: GalleryEntry) => g.kind === wall.kind && g.source === wall.source;

  const addToGallery = async (kind: WallpaperKind, source: string, name: string) => {
    const list = await api.galleryAdd({ name, kind, source });
    const added = list.find((g) => g.source === source && g.kind === kind);
    if (added) await api.galleryApply(added.id);
  };

  const pickAndAdd = async (kind: "video" | "image") => {
    setBusy(true);
    try {
      const file = await api.pickMediaFile();
      if (file)
        await addToGallery(
          kind,
          file,
          file.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "Untitled",
        );
    } finally {
      setBusy(false);
    }
  };

  const pickSlideshow = async () => {
    setBusy(true);
    try {
      const folder = await api.pickMediaFolder();
      if (!folder) return;
      await api.galleryImportFolder(folder);
    } finally {
      setBusy(false);
    }
  };

  const updateZone = (id: string, patch: Partial<ZoneDef>) =>
    save((c) => {
      const z = c.rgb.zones.find((z) => z.id === id);
      if (z) Object.assign(z, patch);
    });

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6">
      <div className="stagger space-y-6">
        <Card title="Vault">
          <div
            className="relative"
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "none";
            }}
            onDrop={(e) => e.preventDefault()}
          >
            {dropActive && (
              <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-[rgb(var(--glow)/0.7)] bg-[rgb(var(--glow)/0.08)] backdrop-blur-[2px]">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgb(var(--glow)/0.2)]">
                  <IconPlus className="h-6 w-6 text-[rgb(var(--glow))]" />
                </div>
                <span className="text-sm font-semibold text-[rgb(var(--glow))]">
                  Drop {dropCount > 1 ? `${dropCount} items` : "file or folder"} to import
                </span>
                <span className="text-[11px] text-[var(--text-dim)]">
                  videos, images and folders become vault cards
                </span>
              </div>
            )}
            <div className="grid grid-cols-3 gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              <button
                onClick={() => pickAndAdd("video")}
                disabled={busy}
                className="flex aspect-video flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--panel-strong)] text-[var(--text-dim)] transition-all hover:border-[rgb(var(--glow)/0.55)] hover:text-[rgb(var(--glow))]"
              >
                <IconPlus className="h-5 w-5" />
                <span className="text-xs font-semibold">Add video</span>
              </button>
              <button
                onClick={() => pickAndAdd("image")}
                disabled={busy}
                className="flex aspect-video flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--panel-strong)] text-[var(--text-dim)] transition-all hover:border-[rgb(var(--glow)/0.55)] hover:text-[rgb(var(--glow))]"
              >
                <IconImage className="h-5 w-5" />
                <span className="text-xs font-semibold">Add image</span>
              </button>
              <button
                onClick={pickSlideshow}
                disabled={busy}
                className="flex aspect-video flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--panel-strong)] text-[var(--text-dim)] transition-all hover:border-[rgb(var(--glow)/0.55)] hover:text-[rgb(var(--glow))]"
              >
                <IconLayers className="h-5 w-5" />
                <span className="text-xs font-semibold">Import folder</span>
              </button>

              {gallery.map((g) => (
                <div
                  key={g.id}
                  className={`group relative aspect-video cursor-pointer overflow-hidden rounded-2xl border transition-all duration-300 ${
                    isActive(g)
                      ? "border-[rgb(var(--glow)/0.7)] shadow-[0_14px_36px_-14px_rgb(var(--glow)/0.55)] ring-2 ring-[rgb(var(--glow)/0.22)]"
                      : "border-[var(--line)] bg-[var(--panel-strong)] hover:border-[var(--line-strong)] hover:shadow-[var(--shadow)]"
                  }`}
                  onClick={() => api.galleryApply(g.id).catch(console.error)}
                >
                  <GalleryThumb entry={g} />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2.5 pb-1.5 pt-6">
                    <div className="truncate text-xs font-semibold text-white">{g.name}</div>
                    <div className="kicker mt-0.5 !text-white/50">{KIND_META[g.kind].label}</div>
                  </div>
                  {isActive(g) && (
                    <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-[rgb(var(--glow))] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#06121f] shadow-[0_0_14px_rgb(var(--glow)/0.7)]">
                      <span className="h-1 w-1 rounded-full bg-[#06121f]" />
                      LIVE
                    </div>
                  )}
                  <button
                    aria-label={`Remove ${g.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      api.galleryRemove(g.id).catch(console.error);
                    }}
                    className="absolute right-2 top-2 hidden h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/70 backdrop-blur transition-colors hover:bg-red-500 hover:text-white group-hover:flex"
                  >
                    <IconTrash className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {gallery.length === 0 && (
            <p className="mt-5 text-center text-xs text-[var(--text-faint)]">
              Everything you add stays here — click a card to apply it instantly.
            </p>
          )}
        </Card>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          <Card title="Shader presets">
            <div className="grid grid-cols-2 gap-3">
              {SHADERS.map((s) => {
                const active = wall.kind === "shader" && wall.source === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() =>
                      save((c) => {
                        c.wallpaper.kind = "shader";
                        c.wallpaper.source = s.id;
                      })
                    }
                    className={`group overflow-hidden rounded-2xl border text-left transition-all duration-300 ${
                      active
                        ? "border-[rgb(var(--glow)/0.7)] shadow-[0_10px_30px_-12px_rgb(var(--glow)/0.5)] ring-2 ring-[rgb(var(--glow)/0.2)]"
                        : "border-[var(--line)] hover:border-[var(--line-strong)]"
                    }`}
                  >
                    <div className="relative h-14 w-full overflow-hidden">
                      <div
                        className="h-full w-full transition-transform duration-700 group-hover:scale-110"
                        style={{ background: SHADER_ART[s.id] }}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                    </div>
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="text-xs font-semibold text-[var(--text)]">{s.label}</span>
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          active
                            ? "bg-[rgb(var(--glow))] shadow-[0_0_8px_rgb(var(--glow))]"
                            : "bg-[var(--line-strong)]"
                        }`}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card title="Active source">
            {wall.kind === "video" && (
              <>
                <Slider
                  label="Volume"
                  min={0}
                  max={1}
                  step={0.05}
                  value={wall.volume}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => save((c) => (c.wallpaper.volume = v))}
                />
                <div className="mt-2">
                  <div className="mb-2 text-xs font-medium text-[var(--text-dim)]">Fit to display</div>
                  <div className="grid grid-cols-4 gap-2">
                    {(["auto", "cover", "contain", "fill"] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => save((c) => (c.wallpaper.videoFit = f))}
                        className={`rounded-lg border px-2 py-1.5 text-xs font-semibold capitalize transition-all ${
                          wall.videoFit === f
                            ? "glow-tint border-[rgb(var(--glow)/0.4)]"
                            : "border-[var(--line)] bg-[var(--panel-strong)] text-[var(--text-dim)] hover:text-[var(--text)]"
                        }`}
                      >
                        {f === "fill" ? "stretch" : f}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--text-faint)]">
                    Auto fills the screen and crops only when shapes are similar; Contain
                    letterboxes; Stretch ignores aspect.
                  </p>
                </div>
              </>
            )}
            {wall.kind === "slideshow" && (
              <>
                <Slider
                  label="Seconds per image"
                  min={5}
                  max={300}
                  step={5}
                  value={wall.slideshow.intervalSec}
                  format={(v) => `${v}s`}
                  onChange={(v) => save((c) => (c.wallpaper.slideshow.intervalSec = v))}
                />
                <Slider
                  label="Crossfade"
                  min={0}
                  max={5}
                  step={0.5}
                  value={wall.slideshow.crossfadeSec}
                  format={(v) => `${v}s`}
                  onChange={(v) => save((c) => (c.wallpaper.slideshow.crossfadeSec = v))}
                />
              </>
            )}
            {wall.kind === "web" && (
              <TextInput
                type="url"
                placeholder="https://example.com"
                value={wall.source}
                onChange={(v) => save((c) => (c.wallpaper.source = v))}
              />
            )}
            {(wall.kind === "image" || wall.kind === "video") && (
              <div className="truncate font-mono text-[11px] text-[var(--text-faint)]" title={wall.source}>
                {wall.source || "Nothing applied yet"}
              </div>
            )}
            <div className="mt-5 border-t border-[var(--line)] pt-4">
              <Toggle
                label="Live wallpaper enabled"
                description="Renders the configured source behind your icons on every display."
                checked={cfg.general.wallpaperEnabled}
                onChange={(v) => save((c) => (c.general.wallpaperEnabled = v))}
              />
            </div>
          </Card>
        </div>

        <Card title="Displays">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {mons.map((m, i) => (
              <div
                key={`${m.device}-${i}`}
                className={`flex items-center gap-3 rounded-2xl border px-4 py-3.5 ${
                  m.primary
                    ? "border-[rgb(var(--glow)/0.35)] bg-[rgb(var(--glow)/0.07)]"
                    : "border-[var(--line)] bg-[var(--panel-strong)]"
                }`}
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                    m.primary ? "bg-[rgb(var(--glow)/0.15)]" : "bg-[var(--panel)]"
                  }`}
                >
                  <IconMonitor className="h-5 w-5 text-[var(--text-dim)]" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-[var(--text)]">
                    {m.device.replace(/\\/g, "") || `Display ${i + 1}`}
                    {m.primary && (
                      <span className="ml-2 font-mono text-[9px] uppercase tracking-widest text-[rgb(var(--glow))]">
                        primary
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-[11px] text-[var(--text-faint)]">
                    {m.w} × {m.h} @ ({m.x}, {m.y})
                  </div>
                </div>
              </div>
            ))}
            {mons.length === 0 && (
              <div className="col-span-2 text-sm text-[var(--text-faint)]">Detecting displays…</div>
            )}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-[var(--text-faint)]">
            Each display gets its own wallpaper window sized to its exact resolution.
            The same source renders on every display, scaled to fit.
          </p>
        </Card>

        <Card title="Zone → device mapping">
          <p className="mb-5 text-sm leading-relaxed text-[var(--text-dim)]">
            Each zone is a rectangle of the wallpaper (normalized 0–1). In{" "}
            <b className="text-[var(--text)]">Zone sync</b> mode, devices receive the
            average color of their mapped zones.
          </p>
          {cfg.rgb.zones.length === 0 && (
            <div className="rounded-2xl border border-dashed border-[var(--line-strong)] p-7 text-center text-sm text-[var(--text-faint)]">
              No zones yet — add one, then map devices to it.
            </div>
          )}
          <div className="space-y-4">
            {cfg.rgb.zones.map((z) => (
              <div
                key={z.id}
                className="rounded-2xl border border-[var(--line)] bg-[var(--panel-strong)] p-5"
              >
                <div className="mb-4 flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--glow))] shadow-[0_0_8px_rgb(var(--glow))]" />
                  <input
                    value={z.name}
                    onChange={(e) => updateZone(z.id, { name: e.target.value })}
                    className="w-44 rounded-lg border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-semibold text-[var(--text)] outline-none transition-colors hover:border-[var(--line)] focus:border-[rgb(var(--glow)/0.5)]"
                  />
                  <div className="ml-auto">
                    <Btn
                      variant="danger"
                      onClick={() =>
                        save((c) => {
                          c.rgb.zones = c.rgb.zones.filter((x) => x.id !== z.id);
                        })
                      }
                    >
                      <IconTrash className="h-4 w-4" />
                      Delete
                    </Btn>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {(["x", "y", "w", "h"] as const).map((k) => (
                    <NumberField
                      key={k}
                      label={k}
                      min={0}
                      max={1}
                      step={0.01}
                      value={z[k]}
                      onChange={(v) => updateZone(z.id, { [k]: v })}
                    />
                  ))}
                </div>
                <div className="mt-4">
                  <div className="kicker mb-2">devices</div>
                  <div className="flex flex-wrap gap-2">
                    {rgb.devices.map((d) => {
                      const on = z.deviceIds.includes(d.id);
                      return (
                        <button
                          key={d.id}
                          onClick={() =>
                            updateZone(z.id, {
                              deviceIds: on
                                ? z.deviceIds.filter((x) => x !== d.id)
                                : [...z.deviceIds, d.id],
                            })
                          }
                          className={`rounded-full border px-2.5 py-1 font-mono text-[11px] font-medium transition-all ${
                            on
                              ? "border-[rgb(var(--glow)/0.5)] bg-[rgb(var(--glow)/0.18)] text-[rgb(var(--glow))] shadow-[0_0_12px_-2px_rgb(var(--glow)/0.5)]"
                              : "border-[var(--line)] bg-[var(--panel)] text-[var(--text-dim)] hover:text-[var(--text)]"
                          }`}
                        >
                          {on && <span className="mr-1 inline-block h-1 w-1 rounded-full bg-[rgb(var(--glow))]" />}
                          {d.name || `Device ${d.id}`}
                        </button>
                      );
                    })}
                    {rgb.devices.length === 0 && (
                      <span className="text-xs text-[var(--text-faint)]">
                        Connect OpenRGB to map devices.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5">
            <Btn
              variant="primary"
              onClick={() =>
                save((c) => {
                  const id = `zone-${Date.now().toString(36)}`;
                  c.rgb.zones.push({
                    id,
                    name: `Zone ${c.rgb.zones.length + 1}`,
                    x: 0.05,
                    y: 0.05,
                    w: 0.4,
                    h: 0.4,
                    deviceIds: [],
                  });
                })
              }
            >
              <IconPlus className="h-4 w-4" />
              Add zone
            </Btn>
          </div>
        </Card>
      </div>
    </div>
  );
}