// The wallpaper on the desktop right now, and the few controls that change how
// it behaves.
//
// Two panels because that is the shape of the question. The picture answers
// "what am I looking at" and wants to be large; the controls answer "why is it
// behaving like that" and want to be dense and scannable. Stacking them made
// the card tall enough to push the vault it sits above entirely off the first
// screen, which is the opposite of a summary.
//
// Every row is a real setting or a real measurement. Where the reference
// design showed something this app cannot know -- GPU load, watts drawn, a
// decoder's name, a frame cap -- the row is absent rather than invented.

import { IconImage, IconSun, IconZap, IconBulb } from "../icons";
import { Card, SwitchBtn } from "../ui";
import { GalleryThumb } from "./GalleryThumb";
import { hasTileMeta, tileMetaFor } from "./tileMeta";
import type { VaultIndex } from "./vaultIndex";
import { GALLERY_KIND_LABEL } from "./kindLabels";
import { t } from "../../i18n";
import { basename } from "../../utilities";
import type { Config, GalleryEntry } from "@shared/types";

export interface NowShowingCardProps {
  cfg: Config;
  /** The vault entry backing the active wallpaper, when there is one. */
  activeEntry: GalleryEntry | null;
  index: VaultIndex;
  save: (fn: (c: Config) => void) => void;
}

/**
 * The coarse resolution class, from the measured width.
 *
 * A label rather than the raw pixels because "4K UHD" is the word people use
 * when comparing wallpapers, and it belongs on the picture next to the name
 * rather than in the facts grid where a number already sits. Null when the file
 * has not been measured: an unindexed vault shows no class at all rather than a
 * guess, because claiming 1080p for an unmeasured file is the one wrong answer
 * this card must never give.
 */
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

  // A shader's `source` is a preset id, not a path, so basename on it would
  // print the id with no useful formatting.
  const name =
    wall.kind === "shader" ? wall.source : wall.source ? basename(wall.source) : "";

  const measured = activeEntry ? index?.[activeEntry.source] : undefined;
  const meta = activeEntry
    ? tileMetaFor(activeEntry, index)
    : { resolution: null, duration: null };
  const showMeta = hasTileMeta(meta);
  const cls = resolutionClass(measured?.width);

  // GalleryThumb needs an entry; the active wallpaper is not always one. This
  // stands in for the file itself and is never indexed or applied.
  // `WallpaperConfig` carries no thumbnail — only vault entries do — so a
  // wallpaper applied from outside the vault decodes from source, which is one
  // file rather than a probe per render.
  const preview: GalleryEntry = activeEntry ?? {
    id: "__now-showing",
    name,
    kind: wall.kind,
    source: wall.source,
    addedMs: 0,
  };

  const zones = cfg.rgb.zones ?? [];
  // Only zones that are actually mapped to a device. A zone with no device
  // drives no light, so listing it in a row about lighting would be a lie.
  const mappedZones = zones.filter((z) => z.deviceIds.length > 0);

  return (
    // No item count and no Live badge in the header, both of which were here and
    // both removed.
    //
    // The count appeared three times within one screen: here, on the vault
    // card's view toggle immediately below, and summed across the kind chips in
    // the toolbar. Three copies of one number is a number the eye stops reading,
    // and this one was already answered by the toggle it sat above.
    //
    // The badge was worse than redundant. The sidebar's status dot and the
    // Overview header both report whether the wallpaper is running, in the
    // corner people actually look; a third "Live" chip in a card header
    // contradicted nothing and helped nobody.
    <Card title={t("common.current-wallpaper")} icon={<IconImage />}>
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* ---------- the picture ---------- */}
        <div className="relative min-w-0 overflow-hidden rounded-xl border border-[var(--line)] bg-black">
          <div className="aspect-video w-full">
            <GalleryThumb entry={preview} />
          </div>

          {/* Class badges along the top. Each is a fact about the file or the
              mode, and grouping them on one edge keeps the picture itself
              clear of furniture. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-center gap-1.5 bg-[linear-gradient(180deg,rgb(0_0_0/0.7),transparent)] px-3 pb-6 pt-2.5">
            {/* Hardware decode is the app's actual setting, read inverted:
                `softwareVideoDecode: true` means it is NOT hardware. Naming the
                mode rather than the boolean is why this row can exist at all
                without a performance counter. */}
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

          {/* Name and facts along the bottom. The scrim is what keeps white text
              legible over a bright frame without dimming the whole picture. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-[linear-gradient(0deg,rgb(0_0_0/0.85),transparent)] px-3 pb-2.5 pt-8">
            <div className="truncate text-[13px] font-semibold text-white/95" title={name}>
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

        {/* ---------- the controls ---------- */}
        {/* Dense rows with a trailing control, so the eye can scan the labels
            down the left and act along the right without reading each line. */}
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

          {/* Zone row. The chips are the real zone names, which is the thing
              the reference design gestured at with C1..C4 — a list of what the
              picture is currently driving. */}
          <div className="flex min-w-0 items-start gap-2.5 rounded-[var(--radius-md)] px-1 py-2">
            <IconZap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-medium text-[var(--text)]">
                  {t("gallery.colour-extraction")}
                </span>
                <span className="font-mono text-[10px] text-[var(--text-faint)]">
                  {t("common.{n}-zones", { n: mappedZones.length })}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] leading-snug text-[var(--text-faint)]">
                {mappedZones.length > 0
                  ? t("gallery.zones-following-this-picture")
                  : t("gallery.no-zones-mapped-yet")}
              </p>
              {mappedZones.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {mappedZones.slice(0, 4).map((z) => (
                    <span
                      key={z.id}
                      title={z.name}
                      className="max-w-[7rem] truncate rounded-md border border-[rgb(var(--glow)/0.45)] bg-[rgb(var(--glow)/0.12)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[rgb(var(--glow))]"
                    >
                      {z.name}
                    </span>
                  ))}
                  {mappedZones.length > 4 && (
                    <span className="rounded-md border border-[var(--line)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--text-faint)]">
                      {t("common.{n}-more", { n: mappedZones.length - 4 })}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Facts that are measured rather than configured. Absent entirely
              when the vault index has nothing, rather than showing a dash that
              reads like a wallpapr with no resolution. */}
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

/** One control row: icon, label with a hint, and the control on the right. */
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