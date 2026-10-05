import { t } from "./i18n";

/**
 * Video-fit id -> already-translated label, resolved eagerly.
 *
 * The old call site printed the enum raw for three of the four options and
 * wrapped `fill` in a ternary — which meant `cover` and `contain` never went
 * through the catalog and a Spanish user read English API ids as labels. The
 * catalog keys existed; only this one call site stood in front of them.
 *
 * A function taking the id, not a lookup table of strings, because the keys
 * resolve at render: the catalog can swap languages without a remount.
 */
export function wallpaperFitLabel(fit: "auto" | "cover" | "contain" | "fill") {
  return t(WALLPAPER_FIT_LABEL[fit]);
}

/** The label keys, spelled out so i18n-check can see every one statically. */
export const WALLPAPER_FIT_LABEL = {
  auto: "gallery.fit-auto",
  cover: "gallery.fit-cover",
  contain: "gallery.fit-contain",
  fill: "gallery.fit-fill",
} as const;
