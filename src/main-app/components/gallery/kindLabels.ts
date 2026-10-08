import type { WallpaperKind } from "@shared/types";

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
