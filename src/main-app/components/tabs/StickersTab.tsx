import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../store";
import { Card, Btn, Toggle, Slider, Select, NumberField, EmptyState, Section } from "../ui";
import { IconPlus, IconTrash, IconSparkle } from "../icons";
import { api } from "../../ipc";
import { truncateError, basename } from "../../utilities";
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
  const { cfg, save } = useStore(
    useShallow((s) => ({ cfg: s.cfg, save: s.save })),
  );
  const [busy, setBusy] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [editing, setEditing] = useState(false);
  // Which sticker the keyboard targets while editing (last clicked card).
  const [selected, setSelected] = useState<string | null>(null);

  // Keyboard control while editor mode is on: arrows nudge the selected
  // sticker (Shift = 10px), Delete/Backspace removes it. Lives in the
  // dashboard because the wallpaper webviews never receive OS key focus.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (!selected) return;
      const s = useStore.getState().cfg?.stickers.find((k) => k.id === selected);
      if (!s) return;
      const step = e.shiftKey ? 10 : 1;
      const move = (dx: number, dy: number) => {
        e.preventDefault();
        api.updateSticker({ ...s, x: s.x + dx, y: s.y + dy }).catch(console.error);
      };
      if (e.key === "ArrowLeft") move(-step, 0);
      else if (e.key === "ArrowRight") move(step, 0);
      else if (e.key === "ArrowUp") move(0, -step);
      else if (e.key === "ArrowDown") move(0, step);
      else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        const victim = useStore
          .getState()
          .cfg?.stickers.find((x) => x.id === selected);
        if (!victim) return;
        api
          .removeSticker(selected)
          .then(() =>
            useStore
              .getState()
              .undoDelete(`Removed "${victim.name}"`, (next) => {
                next.stickers.push(victim);
              }),
          )
          .catch(console.error);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, selected]);

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
    if (busy) return; // guard: a stuck dialog must not wedge the flow
    console.info("[stickers] add clicked");
    setBusy(true);
    try {
      const file = await api.pickMediaFile();
      console.info("[stickers] picker returned", file);
      if (!file) return;
      const name = basename(file);
      await api.beginStickerPlacement(name, convertFileSrc(file, "media"), "image");
    } catch (e) {
      console.error("[stickers] placement failed", e);
      // Right-click / ESC cancel resolves with "cancelled".
    } finally {
      setBusy(false);
    }
  };

  const update = (id: string, patch: Partial<StickerDef>) => {
    const s = cfg.stickers.find((x) => x.id === id);
    if (!s) return;
    // Single path: update_sticker persists AND broadcasts CONFIG_CHANGED;
    // the store refresh picks it up. No parallel save() (that used to fire a
    // second broadcast with the same data).
    api.updateSticker({ ...s, ...patch }).catch(console.error);
  };

  return (
    <div className="stagger space-y-6">
        <Card
          title="Sticker deck"
          right={
            <span className="font-mono text-[10px] tracking-wide text-[var(--text-faint)]">
              {cfg.stickers.length} sticker{cfg.stickers.length === 1 ? "" : "s"}
            </span>
          }
        >
          {/* Session banner: replaces the controls when a mode is active */}
          {placing ? (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-[rgb(var(--glow)/0.4)] bg-[rgb(var(--glow)/0.08)] px-3.5 py-2.5">
              <span className="text-xs font-medium text-[rgb(var(--glow))]">
                Click anywhere on the desktop to place · scroll to resize · right-click or ESC-style cancel to abort
              </span>
              <Btn size="sm" variant="danger" onClick={() => api.cancelStickerPlacement()}>
                Cancel
              </Btn>
            </div>
          ) : editing ? (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-[rgb(var(--glow)/0.4)] bg-[rgb(var(--glow)/0.08)] px-3.5 py-2.5">
              <span className="text-xs font-medium text-[rgb(var(--glow))]">
                Drag to move · edges/corners to resize · right-click deletes · arrows nudge the selected card · auto-exits after 5 min idle
              </span>
              <Btn size="sm" variant="primary" onClick={() => api.endStickerEditor()}>
                Done
              </Btn>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2.5">
              <Btn variant="primary" disabled={busy} onClick={importAndPlace}>
                <IconPlus className="h-4 w-4" />
                Add sticker…
              </Btn>
              <Btn onClick={() => api.beginStickerEditor()} disabled={cfg.stickers.length === 0}>
                <IconSparkle className="h-4 w-4" />
                Edit on wallpaper
              </Btn>
              <span className="ml-auto hidden max-w-sm text-[11px] leading-relaxed text-[var(--text-faint)] sm:block">
                Stickers draw into the wallpaper itself — no extra windows — and follow
                it across monitors.
              </span>
            </div>
          )}
        </Card>

        <Card title="Snapping & behavior">
            <Toggle
              label="Show on all monitors"
              description="Every wallpaper-layer sticker appears on each display at the same relative position. Off: stickers render only where you placed them."
              checked={cfg.sticker?.allMonitors ?? true}
              onChange={(v) =>
                save((c) => {
                  c.sticker = { ...c.sticker, allMonitors: v };
                })
              }
            />
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
            <Toggle
              label="Remove background when applying"
              description="A flat background detected from the borders is made transparent. GIFs are reprocessed frame-by-frame as transparent APNGs; originals stay untouched."
              checked={cfg.sticker?.removeBackground ?? true}
              onChange={(v) =>
                save((c) => {
                  c.sticker = { ...c.sticker, removeBackground: v };
                })
              }
            />
          </Card>

        {cfg.stickers.length === 0 && (
          <EmptyState
            icon={<IconSparkle className="h-5 w-5" />}
            title="No stickers yet"
            description="Add an image, GIF or short video and click once on the desktop to land it."
            action={
              <Btn variant="primary" disabled={busy} onClick={importAndPlace}>
                <IconPlus className="h-4 w-4" />
                Add your first sticker
              </Btn>
            }
          />
        )}

        {cfg.stickers.length > 0 && (
          <div className="grid gap-5 lg:grid-cols-2 3xl:grid-cols-3">
            {cfg.stickers.map((s) => (
              <div
                key={s.id}
                onClick={() => setSelected((p) => (p === s.id ? null : s.id))}
                className={`cursor-pointer rounded-[var(--radius-lg)] transition-shadow ${
                  selected === s.id ? "ring-1 ring-[rgb(var(--glow)/0.5)]" : ""
                }`}
              >
              <Card
                title={s.name}
                right={
                  <span
                    className={`rounded-md border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] transition-colors ${
                      selected === s.id
                        ? "border-[rgb(var(--glow)/0.5)] text-[rgb(var(--glow))]"
                        : "border-transparent text-[var(--text-faint)]"
                    }`}
                  >
                    {selected === s.id ? "keyboard target" : ""}
                  </span>
                }
              >
                <StickerPreview s={s} />
                <Toggle label="Visible" checked={s.visible} onChange={(v) => update(s.id, { visible: v })} />
                <Section title="Placement & appearance">
                  <Toggle
                    label="Always on top"
                    description="Float above every application window instead of the wallpaper layer."
                    checked={s.onTop}
                    onChange={(v) => update(s.id, { onTop: v })}
                  />
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
                </Section>
                <Section title="Position & size (px)">
                  <div className="grid grid-cols-2 gap-3">
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
                </Section>
                <div className="mt-4 flex items-center justify-between gap-2 border-t border-[var(--line)] pt-4">
                  <div className="flex gap-1.5">
                    <Btn
                      size="sm"
                      onClick={() => api.reorderSticker(s.id, -1).catch(console.error)}
                    >
                      ← back
                    </Btn>
                    <Btn
                      size="sm"
                      onClick={() => api.reorderSticker(s.id, 1).catch(console.error)}
                    >
                      forward →
                    </Btn>
                    <Btn
                      size="sm"
                      onClick={() => api.duplicateSticker(s.id).catch(console.error)}
                    >
                      Duplicate
                    </Btn>
                  </div>
                  <Btn
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      if (selected === s.id) setSelected(null);
                      api
                        .removeSticker(s.id)
                        .then(() =>
                          useStore
                            .getState()
                            .undoDelete(`Removed "${s.name}"`, (next) => {
                              next.stickers.push(s);
                            }),
                        )
                        .catch((e) =>
                          useStore
                            .getState()
                            .toast("error", `Remove failed: ${truncateError(e)}`),
                        );
                    }}
                  >
                    <IconTrash className="h-4 w-4" />
                    Remove
                  </Btn>
                </div>
              </Card>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}