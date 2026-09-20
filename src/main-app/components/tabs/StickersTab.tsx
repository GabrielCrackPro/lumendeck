import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useStore } from "../../store";
import { Card, Btn, Toggle, Slider, Select, NumberField } from "../ui";
import { IconPlus, IconTrash, IconSparkle } from "../icons";
import { api } from "../../ipc";
import type { StickerDef, StickerFit } from "@shared/types";

/** Live media strip for a sticker card: image/GIF or muted video. */
function StickerPreview({ s }: { s: StickerDef }) {
  const src = convertFileSrc(s.url, "media");
  const isVideo = /\.(mp4|webm|mov|m4v|mkv)$/i.test(s.url);
  return (
    <div className="relative mb-4 h-24 w-full overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)]">
      {isVideo ? (
        <video
          src={src}
          muted
          loop
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
        />
      ) : (
        <img src={src} alt={s.name} className="h-full w-full object-cover" />
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
      <div className="absolute bottom-1.5 left-2 flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-black/55 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-white/85 backdrop-blur">
          {Math.round(s.w)}×{Math.round(s.h)}px
        </span>
        <span className="rounded-full bg-black/55 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-white/85 backdrop-blur">
          {s.fit}
        </span>
        {isVideo && (
          <span className="rounded-full bg-black/55 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-white/85 backdrop-blur">
            video
          </span>
        )}
        {!s.visible && (
          <span className="rounded-full bg-black/55 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-amber-200/90 backdrop-blur">
            hidden
          </span>
        )}
      </div>
    </div>
  );
}

export default function StickersTab() {
  const { cfg, save } = useStore();
  const [busy, setBusy] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [editing, setEditing] = useState(false);

  // Reflect backend placement/editor state in the UI.
  useEffect(() => {
    import("@tauri-apps/api/event")
      .then(({ listen }) => {
        listen<boolean>("sticker-placing", (e) => setPlacing(e.payload)).catch(() => {});
        listen<boolean>("sticker-editor", (e) => setEditing(e.payload)).catch(() => {});
      })
      .catch(() => {});
  }, []);

  if (!cfg) return null;

  const importAndPlace = async () => {
    setBusy(true);
    try {
      const file = await api.pickMediaFile();
      if (!file) return;
      const name = file.split(/[\\/]/).pop() ?? "sticker";
      await api.beginStickerPlacement(name, convertFileSrc(file, "media"), "image");
    } catch {
      // Right-click / ESC cancel resolves with "cancelled".
    } finally {
      setBusy(false);
    }
  };

  const update = (id: string, patch: Partial<StickerDef>) => {
    const s = cfg.stickers.find((x) => x.id === id);
    if (!s) return;
    api.updateSticker({ ...s, ...patch }).catch(console.error);
    save((c) => {
      const slot = c.stickers.find((x) => x.id === id);
      if (slot) Object.assign(slot, patch);
    });
  };

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6">
      <div className="stagger space-y-6">
        <Card title="Deck">
          <div className="flex flex-wrap gap-2.5">
            {placing ? (
              <Btn variant="danger" onClick={() => api.cancelStickerPlacement()}>
                Cancel placement
              </Btn>
            ) : (
              <Btn variant="primary" disabled={busy} onClick={importAndPlace}>
                <IconPlus className="h-4 w-4" />
                Add sticker…
              </Btn>
            )}
            {editing ? (
              <Btn variant="primary" onClick={() => api.endStickerEditor()}>
                Done editing
              </Btn>
            ) : (
              <Btn onClick={() => api.beginStickerEditor()} disabled={cfg.stickers.length === 0}>
                <IconSparkle className="h-4 w-4" />
                Edit on wallpaper
              </Btn>
            )}
          </div>
          <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-[var(--text-dim)]">
            {placing ? (
              <span className="flex items-center gap-1.5">
                <IconSparkle className="h-3.5 w-3.5 text-[rgb(var(--glow))]" />
                Click anywhere on the desktop to place · right-click or Cancel to abort
              </span>
            ) : editing ? (
              <span className="flex items-center gap-1.5">
                <IconSparkle className="h-3.5 w-3.5 text-[rgb(var(--glow))]" />
                Drag stickers to move, grab edges/corners to resize, right-click to delete
              </span>
            ) : (
              <span>
                Pick a file, then click anywhere on the desktop — the sticker is drawn into
                the wallpaper itself (no extra window) and follows it across monitors. Use{" "}
                <b className="text-[var(--text)]">Edit on wallpaper</b> to arrange them
                directly, or fine-tune position and size below.
              </span>
            )}
          </p>
        </Card>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          <Card title="Snapping">
            <Toggle
              label="Alignment guides"
              description="Snap sticker edges to other stickers and monitor edges & centers (amber lines)."
              checked={cfg.stickerSnap?.guides ?? true}
              onChange={(v) =>
                save((c) => {
                  c.stickerSnap = {
                    grid: c.stickerSnap?.grid ?? true,
                    guides: v,
                    gridSize: c.stickerSnap?.gridSize ?? 32,
                  };
                })
              }
            />
            <Toggle
              label="Snap to grid"
              description="Quantize positions to a grid while dragging."
              checked={cfg.stickerSnap?.grid ?? true}
              onChange={(v) =>
                save((c) => {
                  c.stickerSnap = {
                    grid: v,
                    guides: c.stickerSnap?.guides ?? true,
                    gridSize: c.stickerSnap?.gridSize ?? 32,
                  };
                })
              }
            />
            <Slider
              label="Grid size"
              min={8}
              max={128}
              step={8}
              value={cfg.stickerSnap?.gridSize ?? 32}
              format={(v) => `${v} px`}
              onChange={(v) =>
                save((c) => {
                  c.stickerSnap = {
                    grid: c.stickerSnap?.grid ?? true,
                    guides: c.stickerSnap?.guides ?? true,
                    gridSize: v,
                  };
                })
              }
            />
            <p className="mt-3 text-xs leading-relaxed text-[var(--text-faint)]">
              Alignment guides win over the grid: the grid applies only where no
              guide matched.
            </p>
          </Card>

          <Card title="Behavior">
            <Toggle
              label="Remove background when applying"
              description="A flat background detected from the borders is made transparent. GIFs are reprocessed frame-by-frame as transparent APNGs; originals stay untouched."
              checked={cfg.sticker?.removeBackground ?? true}
              onChange={(v) =>
                save((c) => {
                  c.sticker = { removeBackground: v };
                })
              }
            />
          </Card>
        </div>

        {cfg.stickers.length === 0 && (
          <div className="flex flex-col items-center gap-3.5 rounded-3xl border border-dashed border-[var(--line-strong)] px-8 py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--panel-strong)] text-[var(--text-faint)]">
              <IconSparkle className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[var(--text)]">No stickers yet</div>
              <p className="mt-1 text-xs text-[var(--text-faint)]">
                Add an image, GIF or short video and click once on the desktop to land it.
              </p>
            </div>
            <Btn variant="primary" disabled={busy} onClick={importAndPlace}>
              <IconPlus className="h-4 w-4" />
              Add your first sticker
            </Btn>
          </div>
        )}

        {cfg.stickers.length > 0 && (
          <div className="grid gap-5 lg:grid-cols-2">
            {cfg.stickers.map((s) => (
              <Card key={s.id} title={s.name}>
                <StickerPreview s={s} />
                <Toggle label="Visible" checked={s.visible} onChange={(v) => update(s.id, { visible: v })} />
                <Toggle label="Muted (video)" checked={s.muted} onChange={(v) => update(s.id, { muted: v })} />
                <Slider
                  label="Opacity"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={s.opacity}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => update(s.id, { opacity: v })}
                />
                <Select<StickerFit>
                  label="Fit"
                  value={s.fit}
                  options={[
                    { id: "contain", label: "Contain" },
                    { id: "cover", label: "Cover" },
                    { id: "fill", label: "Fill" },
                  ]}
                  onChange={(v) => update(s.id, { fit: v })}
                />
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <NumberField label="X (px)" value={s.x} onChange={(v) => update(s.id, { x: Math.round(v) })} />
                  <NumberField label="Y (px)" value={s.y} onChange={(v) => update(s.id, { y: Math.round(v) })} />
                  <NumberField
                    label="Width (px)"
                    value={s.w}
                    min={24}
                    onChange={(v) => update(s.id, { w: Math.max(24, Math.round(v)) })}
                  />
                  <NumberField
                    label="Height (px)"
                    value={s.h}
                    min={24}
                    onChange={(v) => update(s.id, { h: Math.max(24, Math.round(v)) })}
                  />
                </div>
                <div className="mt-4 flex justify-end">
                  <Btn variant="danger" onClick={() => api.removeSticker(s.id)}>
                    <IconTrash className="h-4 w-4" />
                    Remove
                  </Btn>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}