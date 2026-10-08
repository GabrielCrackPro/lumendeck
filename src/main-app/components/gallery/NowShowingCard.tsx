
import { useEffect, useRef, useState } from "react";
import { IconImage, IconSun, IconZap, IconBulb, IconCopy, IconShuffle } from "../icons";
import { Card, SwitchBtn } from "../ui";
import { useCopy } from "../useCopy";
import { wallpaperPalette, type PaletteEntry } from "../wallpaperPalette";
import { formatHex } from "../colorHex";
import { useStore } from "../../store";
import { GalleryThumb } from "./GalleryThumb";
import { hasTileMeta, tileMetaFor } from "./tileMeta";
import type { VaultIndex } from "./vaultIndex";
import { GALLERY_KIND_LABEL } from "./kindLabels";
import { t } from "../../i18n";
import { basename } from "../../utilities";
import type { Config, GalleryEntry } from "@shared/types";

const EMPTY_PALETTE: PaletteEntry[] = [];

export interface NowShowingCardProps {
  cfg: Config;
  activeEntry: GalleryEntry | null;
  index: VaultIndex;
  save: (fn: (c: Config) => void) => void;
}

export function resolutionClass(width: number | undefined): "4k" | "hd" | null {
  if (!width) return null;
  if (width >= 3840) return "4k";
  if (width >= 1920) return "hd";
  return null;
}

export function NowShowingCard({
  cfg,
  activeEntry,
  index,
  save,
}: NowShowingCardProps) {
  const wall = cfg.wallpaper;
  const general = cfg.general;

  const name =
    wall.kind === "shader" ? wall.source : wall.source ? basename(wall.source) : "";

  const measured = activeEntry ? index?.[activeEntry.source] : undefined;
  const meta = activeEntry
    ? tileMetaFor(activeEntry, index)
    : { resolution: null, duration: null };
  const showMeta = hasTileMeta(meta);
  const cls = resolutionClass(measured?.width);

  const preview: GalleryEntry = activeEntry ?? {
    id: "__now-showing",
    name,
    kind: wall.kind,
    source: wall.source,
    addedMs: 0,
  };

  const deviceColors = useStore((s) => s.deviceColors);
  const galleryShuffle = cfg.galleryShuffle ?? false;
  const wallpaperKey = `${cfg.wallpaper.kind}:${cfg.wallpaper.source}`;
  const [captured, setCaptured] = useState<{
    key: string;
    entries: PaletteEntry[];
  } | null>(null);
  const palette =
    captured?.key === wallpaperKey ? captured.entries : EMPTY_PALETTE;
  const awaitingFreshSample = useRef<string | null>(null);
  useEffect(() => {
    setCaptured(null);
    awaitingFreshSample.current = wallpaperKey;
  }, [wallpaperKey]);
  useEffect(() => {
    if (captured) return;
    if (awaitingFreshSample.current === wallpaperKey) {
      awaitingFreshSample.current = null;
      return;
    }
    const next = wallpaperPalette(deviceColors);
    if (next.length > 0) setCaptured({ key: wallpaperKey, entries: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceColors, captured, wallpaperKey]);
  const { copy } = useCopy();

  return (
    <Card title={t("common.current-wallpaper")} icon={<IconImage />}>
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        { }
        <div className="relative min-w-0 overflow-hidden rounded-xl border border-[var(--line)] bg-black">
          <div className="aspect-video w-full">
            <GalleryThumb entry={preview} />
          </div>

          {

 }
          <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-center gap-1.5 bg-[linear-gradient(180deg,rgb(0_0_0/0.7),transparent)] px-3 pb-6 pt-2.5">
            {


 }
            <span className="rounded-md bg-black/55 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-white/85 backdrop-blur-sm">
              {general.softwareVideoDecode
                ? t("gallery.software-decode")
                : t("gallery.hardware-decode")}
            </span>
            {cls && (
              <span className="rounded-md bg-black/55 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-white/85 backdrop-blur-sm">
                {t(cls === "4k" ? "gallery.4k-uhd" : "gallery.hd")}
              </span>
            )}
            {cfg.rgb.enabled && cfg.rgb.mode === "audioReactive" && (
              <span className="flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-white/85 backdrop-blur-sm">
                <IconZap className="h-2.5 w-2.5" />
                {t("gallery.audio-reactive")}
              </span>
            )}
          </div>

          {
 }
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-[linear-gradient(0deg,rgb(0_0_0/0.85),transparent)] px-3 pb-2.5 pt-8">
            <div className="truncate text-[13px] font-semibold text-white/95" data-tip={name}>
              {name}
            </div>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] leading-none text-white/70">
              <span className="truncate">{t(GALLERY_KIND_LABEL[wall.kind])}</span>
              {meta.resolution && (
                <>
                  <span aria-hidden>&middot;</span>
                  <span className="tabular-nums">{meta.resolution}</span>
                </>
              )}
              {meta.duration && (
                <>
                  <span aria-hidden>&middot;</span>
                  <span>
                    {t("gallery.length-{duration}", { duration: meta.duration })}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        { }
        {
 }
        <div className="flex min-w-0 flex-col gap-1">
          <Row
            icon={<IconBulb className="h-3.5 w-3.5" />}
            label={t("gallery.pause-in-fullscreen-3d")}
            hint={t("gallery.pause-in-fullscreen-3d-hint")}
          >
            <SwitchBtn
              checked={general.pauseOnFullscreen}
              onChange={(v) => save((c) => (c.general.pauseOnFullscreen = v))}
              title={t("gallery.pause-in-fullscreen-3d")}
            />
          </Row>

          {

 }
          <Row
            icon={<IconShuffle className="h-3.5 w-3.5" />}
            label={t("gallery.play-in-random-order")}
            hint={
              galleryShuffle
                ? t("gallery.random-order-next-wallpaper-key")
                : t("gallery.random-order-off-walks-in-order")
            }
          >
            <SwitchBtn
              checked={galleryShuffle}
              onChange={(v) => save((c) => (c.galleryShuffle = v))}
              title={t("gallery.play-in-random-order")}
            />
          </Row>

          <Row
            icon={<IconSun className="h-3.5 w-3.5" />}
            label={t("gallery.wallpaper-enabled")}
            hint={
              general.accentSyncEnabled
                ? t("gallery.accent-follows-this-picture")
                : t("gallery.accent-not-following")
            }
          >
            <SwitchBtn
              checked={general.wallpaperEnabled}
              onChange={(v) => save((c) => (c.general.wallpaperEnabled = v))}
              title={t("gallery.wallpaper-enabled")}
            />
          </Row>

          {



 }
          <div className="flex min-w-0 items-start gap-2.5 rounded-[var(--radius-md)] px-1 py-2">
            <IconZap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-medium text-[var(--text)]">
                  {t("gallery.colour-extraction")}
                </span>
                {palette.length > 0 && (
                  <span className="font-mono text-[10px] text-[var(--text-faint)]">
                    {t("common.{n}-colours", { n: palette.length })}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[11px] leading-snug text-[var(--text-faint)]">
                {palette.length > 0
                  ? t("gallery.colours-sampled-from-this-picture")
                  : t("gallery.waiting-for-a-colour-reading")}
              </p>
              {






 }
              {palette.length > 0 && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {palette.map((entry) => {
                    const hex = formatHex(entry.rgb);
                    return (
                      <button
                        key={hex}
                        type="button"
                        onClick={() => void copy(hex)}
                        data-tip={t("common.copy-colour-{hex}", { hex })}
                        className="group flex items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--panel)] py-1 pl-1 pr-2 transition-colors hover:border-[rgb(var(--glow)/0.45)] hover:bg-[var(--panel-strong)] focus-glow"
                      >
                        {


 }
                        <span
                          aria-hidden="true"
                          className="h-5 w-5 shrink-0 rounded-sm border border-black/30"
                          style={{ background: hex }}
                        />
                        <span className="font-mono text-[11px] text-[var(--text-dim)] group-hover:text-[var(--text)]">
                          {hex}
                        </span>
                        {


 }
                        <IconCopy className="h-3 w-3 shrink-0 text-[var(--text-faint)] opacity-40 transition-opacity group-hover:opacity-100" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {

 }
          {showMeta && (
            <dl className="mt-auto grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[var(--line)] pt-2.5">
              <div className="min-w-0">
                <dt className="kicker !text-[var(--text-faint)]">
                  {t("gallery.resolution")}
                </dt>
                <dd className="mt-0.5 truncate font-mono text-[11px] text-[var(--text)]">
                  {meta.resolution ?? t("gallery.not-indexed-yet")}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="kicker !text-[var(--text-faint)]">
                  {t("gallery.length")}
                </dt>
                <dd className="mt-0.5 truncate font-mono text-[11px] text-[var(--text)]">
                  {meta.duration ?? t("common.nothing-applied")}
                </dd>
              </div>
            </dl>
          )}
        </div>
      </div>

      {!showMeta && (
        <p className="mt-3 font-mono text-[10px] text-[var(--text-faint)]">
          {t("gallery.build-the-index-for-resolution-and-length")}
        </p>
      )}
    </Card>
  );
}

function Row({
  icon,
  label,
  hint,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-[var(--radius-md)] px-1 py-2">
      <span className="shrink-0 text-[var(--text-faint)]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-[var(--text)]">
          {label}
        </span>
        <span className="mt-0.5 block truncate text-[11px] leading-snug text-[var(--text-faint)]">
          {hint}
        </span>
      </span>
      {children}
    </div>
  );
}