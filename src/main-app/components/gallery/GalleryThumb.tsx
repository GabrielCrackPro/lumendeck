import { useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { IconGlobe, IconLayers, IconPlay } from "../icons";
import { SHADER_ART } from "@shared/constants";
import { useNearViewport } from "./useNearViewport";
import type { GalleryEntry } from "@shared/types";

/** The sweep shown until there is a decoded frame to show. */
const SHIMMER =
  "animate-pulse bg-[linear-gradient(110deg,var(--panel-strong),var(--panel)_45%,var(--panel-strong))]";

export interface GalleryThumbProps {
  entry: GalleryEntry;
}

/**
 * The tile's imagery, and nothing else.
 *
 * Loading behaves exactly as it did before the redesign: a shimmer stands in
 * until there is something to show, the stored thumbnail covers the video still
 * while it decodes, and the decoder only starts once the tile is near the
 * viewport. A vault of a few hundred videos would otherwise fire a few hundred
 * decodes the moment the tab opens.
 *
 * Nothing here reads the file's resolution or duration. Those probes used to
 * feed chips on the tile, which cost a range request per wallpaper; the facts
 * are in the drawer instead, where one entry is open at a time.
 */
export function GalleryThumb({ entry }: GalleryThumbProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [thumbLoaded, setThumbLoaded] = useState(false);
  const { ref: nearRef, near } = useNearViewport<HTMLDivElement>();
  const url = convertFileSrc(entry.source, "media");

  if (entry.kind === "shader") {
    return (
      <div
        className="h-full w-full"
        style={{ background: SHADER_ART[entry.source] ?? SHADER_ART.aurora }}
      />
    );
  }

  if (entry.kind === "web" || entry.kind === "slideshow") {
    const Icon = entry.kind === "web" ? IconGlobe : IconLayers;
    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--panel-strong)] to-[var(--panel)]">
        <Icon className="h-7 w-7 text-[var(--text-faint)]" />
      </div>
    );
  }

  if (entry.kind === "image") {
    return (
      <div className="relative h-full w-full bg-[var(--panel-strong)]">
        <img
          src={entry.thumb ?? url}
          alt={entry.name}
          loading="lazy"
          decoding="async"
          className="h-full w-full bg-black/50 object-cover"
          onError={(e) => {
            // A moved or unreadable file must not leave a broken-image glyph in
            // the grid; hiding it leaves the panel behind, which reads as an
            // empty tile rather than a broken one.
            e.currentTarget.style.display = "none";
          }}
        />
      </div>
    );
  }

  return (
    <div ref={nearRef} className="relative h-full w-full bg-[var(--panel-strong)]">
      {!thumbLoaded && !playing && <div className={`absolute inset-0 ${SHIMMER}`} />}
      {/* Off-screen tiles keep just the shimmer; the decoder waits for the tile
          to come near the viewport. */}
      {near && (
        <video
          ref={videoRef}
          // #t=1 makes the browser decode & paint a frame at 1s eagerly, so the
          // tile shows real imagery without any hover (preload=metadata).
          src={`${url}#t=1`}
          muted
          loop
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
          onMouseEnter={() => videoRef.current?.play().catch(() => {})}
          onMouseLeave={() => videoRef.current?.pause()}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
      )}
      {entry.thumb && !playing && (
        <img
          src={entry.thumb}
          alt={entry.name}
          onLoad={() => setThumbLoaded(true)}
          // Crosses out rather than vanishing, so a video arriving under its
          // own still looks like one becoming the other.
          className="absolute inset-0 h-full w-full bg-black/50 object-cover transition-opacity duration-500"
        />
      )}
      {!playing && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity group-hover:opacity-0">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur">
            <IconPlay className="h-4 w-4 [&>svg>*]:fill-current [&>svg>*]:stroke-none" />
          </span>
        </div>
      )}
    </div>
  );
}
