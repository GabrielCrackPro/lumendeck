import type { WallpaperKind } from "@shared/types";
import { DISCOVER_SOURCES } from "../discover/discoverSources";

export const GALLERY_KINDS: WallpaperKind[] = [
  "video",
  "image",
  "slideshow",
  "web",
  "shader",
];

export const GALLERY_KIND_LABEL: Record<WallpaperKind, string> = {
  video: "gallery.kind-video",
  image: "gallery.kind-image",
  slideshow: "gallery.kind-slideshow",
  web: "gallery.kind-web",
  shader: "gallery.kind-shader",
};

/** Catalog key for a gallery origin id; null means show the raw id. */
export function originLabel(id: string): string | null {
  if (id === "local") return "gallery.origin-this-device";
  if (id === "url") return "gallery.origin-the-web";
  return DISCOVER_SOURCES.find((s) => s.id === id)?.label ?? null;
}
