import { useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { IconGlobe, IconLayers, IconPlay } from "../icons";
import { SHIMMER } from "../ui";
import { SHADER_ART } from "@shared/constants";
import { useNearViewport } from "./useNearViewport";
import type { GalleryEntry } from "@shared/types";

export interface GalleryThumbProps {
  entry: GalleryEntry;
}

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
            e.currentTarget.style.display = "none";
          }}
        />
      </div>
    );
  }

  return (
    <div ref={nearRef} className="relative h-full w-full bg-[var(--panel-strong)]">
      {!thumbLoaded && !playing && <div className={`absolute inset-0 ${SHIMMER}`} />}

      {near && (
        <video
          ref={videoRef}
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
          className="absolute inset-0 h-full w-full bg-black/50 object-cover transition-opacity duration-[var(--motion-slow)] ease-[var(--ease-standard)]"
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
