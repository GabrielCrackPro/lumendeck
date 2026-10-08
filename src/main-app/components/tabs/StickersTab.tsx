import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../store";
import { Card, Btn, Toggle, Slider, Select, NumberField, EmptyState, Section, InfoNote } from "../ui";
import { IconCheck, IconClose, IconPlus, IconTrash, IconSparkle } from "../icons";
import { api } from "../../ipc";
import { usePending } from "../../pending";
import { truncateError, basename } from "../../utilities";
import type { StickerDef, StickerFit } from "@shared/types";
import { t } from "../../i18n";
import { toMediaSrc } from "../mediaSrc";

function StickerPreview({ s }: { s: StickerDef }) {
  const src = toMediaSrc(s.url, (path) => convertFileSrc(path, "media"));
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
          {`${Math.round(s.w)}×${Math.round(s.h)}px`}
        </span>
        <span className="rounded-full bg-black/55 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-white/85 backdrop-blur">
          {s.fit}
        </span>
        {isVideo && (
          <span className="rounded-full bg-black/55 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-white/85 backdrop-blur">
            {t("common.video")}
          </span>
        )}
        {!s.visible && (
          <span className="rounded-full bg-black/55 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-amber-200/90 backdrop-blur">
            {t("common.hidden")}
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
  const { pending, run } = usePending();
  const busy = pending.has("import");
  const [placing, setPlacing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

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

  useEffect(() => {
    import("@tauri-apps/api/event")
      .then(({ listen }) => {
        listen<boolean>("sticker-placing", (e) => setPlacing(e.payload)).catch(() => {});
        listen<boolean>("sticker-editor", (e) => setEditing(e.payload)).catch(() => {});
      })
      .catch(() => {});
  }, []);

  if (!cfg) return null;

  const importAndPlace = () => {
    console.info("[stickers] add clicked");
    void run("import", async () => {
      const file = await api.pickImageFile();
      console.info("[stickers] picker returned", file);
      if (!file) return;
      const name = basename(file);
      await api.beginStickerPlacement(name, convertFileSrc(file, "media"), "image");
    }).catch(() => {});
  };

  const update = (id: string, patch: Partial<StickerDef>) => {
    const s = cfg.stickers.find((x) => x.id === id);
    if (!s) return;
    api.updateSticker({ ...s, ...patch }).catch(console.error);
  };

  return (
    <div className="@container stagger space-y-4 sm:space-y-5">
      <div className="grid items-start gap-4 @[39rem]:grid-cols-2 @[56rem]:gap-5">
        <Card
          title={t("common.sticker-deck")}
          right={
            <span className="hint">
              {t("common.{n}-stickers", { n: cfg.stickers.length })}
            </span>
          }
        >

          {placing ? (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-[rgb(var(--glow)/0.4)] bg-[rgb(var(--glow)/0.08)] px-3.5 py-2.5">
              <span className="text-xs font-medium text-[rgb(var(--glow))]">
                {t("common.click-anywhere-on-the-desktop-to-place-scroll-to")}
              </span>
              <Btn
                size="sm"
                variant="danger"
                onClick={() => {
                  void run("cancel-place", () => api.cancelStickerPlacement());
                }}
              >
                <IconClose className="h-4 w-4" />
                {t("common.cancel")}
              </Btn>
            </div>
          ) : editing ? (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-[rgb(var(--glow)/0.4)] bg-[rgb(var(--glow)/0.08)] px-3.5 py-2.5">
              <span className="text-xs font-medium text-[rgb(var(--glow))]">
                {t("common.drag-to-move-edges-corners-to-resize-right-click")}
              </span>
              <Btn
                size="sm"
                variant="primary"
                onClick={() => {
                  void run("end-edit", () => api.endStickerEditor());
                }}
              >
                <IconCheck className="h-4 w-4" />
                {t("common.done")}
              </Btn>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2.5">
              <Btn variant="primary" disabled={busy} onClick={importAndPlace}>
                <IconPlus className="h-4 w-4" />
                {t("common.add-sticker")}
              </Btn>
              <Btn
                onClick={() => {
                  void run("begin-edit", () => api.beginStickerEditor());
                }}
                disabled={cfg.stickers.length === 0}
              >
                <IconSparkle className="h-4 w-4" />
                {t("common.edit-on-wallpaper")}
              </Btn>
              <span className="ml-auto hidden max-w-sm text-[11px] leading-relaxed text-[var(--text-faint)] sm:block">
                {t("common.stickers-draw-into-the-wallpaper-itself-no-extra")}
              </span>
            </div>
          )}
        </Card>

        <Card title={t("common.snapping-and-behavior")}>
            <Toggle
              label={t("common.show-on-all-monitors")}
              description={t("common.every-wallpaper-layer-sticker-appears-on-each-di")}
              checked={cfg.sticker?.allMonitors ?? true}
              onChange={(v) =>
                save((c) => {
                  c.sticker = { ...c.sticker, allMonitors: v };
                })
              }
            />
            <Toggle
              label={t("common.alignment-guides")}
              description={t("common.snap-sticker-edges-to-other-stickers-and-monitor")}
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
              label={t("common.snap-to-grid")}
              description={t("common.quantize-positions-to-a-grid-while-dragging")}
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
              label={t("common.grid-size")}
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
            <InfoNote>
              {t("common.alignment-guides-win-over-the-grid-the-grid-appl")}
            </InfoNote>
            <Toggle
              label={t("common.remove-background-when-applying")}
              description={t("common.a-flat-background-detected-from-the-borders-is-m")}
              checked={cfg.sticker?.removeBackground ?? true}
              onChange={(v) =>
                save((c) => {
                  c.sticker = { ...c.sticker, removeBackground: v };
                })
              }
            />
          </Card>
      </div>

        {cfg.stickers.length === 0 && (
          <EmptyState
            icon={<IconSparkle className="h-6 w-6" />}
            title={t("common.no-stickers-yet")}
            description={t("common.add-an-image-gif-or-short-video-and-click-once-o")}
            action={
              <Btn variant="primary" disabled={busy} onClick={importAndPlace}>
                <IconPlus className="h-4 w-4" />
                {t("common.add-your-first-sticker")}
              </Btn>
            }
          />
        )}

        {cfg.stickers.length > 0 && (
          <div className="grid gap-4 @[40rem]:grid-cols-2 @[76rem]:grid-cols-3 @[56rem]:gap-5">
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
                    {selected === s.id ? t("common.keyboard-target") : ""}
                  </span>
                }
              >
                <StickerPreview s={s} />
                <Toggle label={t("common.visible")} checked={s.visible} onChange={(v) => update(s.id, { visible: v })} />
                <Section title={t("common.placement-and-appearance")}>
                  <Toggle
                    label={t("common.always-on-top")}
                    description={t("common.float-above-every-application-window-instead-of")}
                    checked={s.onTop}
                    onChange={(v) => update(s.id, { onTop: v })}
                  />
                  <Toggle label={t("common.muted-video")} checked={s.muted} onChange={(v) => update(s.id, { muted: v })} />
                  <Slider
                    label={t("common.opacity")}
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={s.opacity}
                    format={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) => update(s.id, { opacity: v })}
                  />
                  <Select<StickerFit>
                    label={t("common.fit")}
                    value={s.fit}
                    options={[
                      { id: "contain", label: t("common.contain") },
                      { id: "cover", label: t("common.cover") },
                      { id: "fill", label: t("common.fill") },
                    ]}
                    onChange={(v) => update(s.id, { fit: v })}
                  />
                </Section>
                <Section title={t("common.position-and-size-px")}>
                  <div className="grid grid-cols-2 gap-3">
                    <NumberField label="X (px)" value={s.x} onChange={(v) => update(s.id, { x: Math.round(v) })} />
                    <NumberField label="Y (px)" value={s.y} onChange={(v) => update(s.id, { y: Math.round(v) })} />
                    <NumberField
                      label={t("common.width-px")}
                      value={s.w}
                      min={24}
                      onChange={(v) => update(s.id, { w: Math.max(24, Math.round(v)) })}
                    />
                    <NumberField
                      label={t("common.height-px")}
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
                      disabled={pending.has(`reorder-${s.id}`)}
                      onClick={() => {
                        void run(`reorder-${s.id}`, () => api.reorderSticker(s.id, -1));
                      }}
                    >
                      {t("common.back")}
                    </Btn>
                    <Btn
                      size="sm"
                      disabled={pending.has(`reorder-${s.id}`)}
                      onClick={() => {
                        void run(`reorder-${s.id}`, () => api.reorderSticker(s.id, 1));
                      }}
                    >
                      {t("common.forward")}
                    </Btn>
                    <Btn
                      size="sm"
                      onClick={() => {
                        void run(`duplicate-${s.id}`, () => api.duplicateSticker(s.id));
                      }}
                    >
                      {t("common.duplicate")}
                    </Btn>
                  </div>
                  <Btn
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      if (selected === s.id) setSelected(null);
                      void run(
                        `remove-${s.id}`,
                        () =>
                          api
                            .removeSticker(s.id)
                            .then(() =>
                              useStore
                                .getState()
                                .undoDelete(
                                  t("common.removed", { name: s.name }),
                                  (next) => {
                                    next.stickers.push(s);
                                  },
                                ),
                            ),
                        (e) =>
                          useStore
                            .getState()
                            .toast(
                              "error",
                              t("common.remove-failed-{error}", {
                                error: truncateError(e),
                              }),
                            ),
                      );
                    }}
                  >
                    <IconTrash className="h-4 w-4" />
                    {t("common.remove")}
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