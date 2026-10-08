import { t } from "./i18n";

export type WallpaperFit = "auto" | "cover" | "contain" | "fill";

export function wallpaperFitLabel(fit: WallpaperFit) {
  return t(WALLPAPER_FIT_LABEL[fit]);
}

export const WALLPAPER_FIT_LABEL = Object.freeze({
  auto: "gallery.fit-auto",
  cover: "gallery.fit-cover",
  contain: "gallery.fit-contain",
  fill: "gallery.fit-fill",
}) satisfies Record<WallpaperFit, string>;
