import type { WallpaperKind } from "@shared/types";

/** Every kind a vault entry can have, in the order the filter chips show them. */
export const GALLERY_KINDS: WallpaperKind[] = [
  "video",
  "image",
  "slideshow",
  "web",
  "shader",
];

/**
 * Kind -> label key. Written out rather than interpolated into the key at the
 * call site, so i18n-check can see every key statically instead of having to
 * guess what `gallery.kind.${kind}` expands to.
 */
export const GALLERY_KIND_LABEL: Record<WallpaperKind, string> = {
  video: "gallery.kind-video",
  image: "gallery.kind-image",
  slideshow: "gallery.kind-slideshow",
  web: "gallery.kind-web",
  shader: "gallery.kind-shader",
};
