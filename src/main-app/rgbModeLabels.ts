import type { RgbMode } from "@shared/types";
import { t } from "./i18n";

/**
 * Lighting mode -> label key. Written out rather than interpolated into the
 * key at the call site, so i18n-check can see every key statically instead of
 * having to guess what `lighting.${mode}` expands to — the same shape the
 * gallery's kind map uses.
 *
 * The `RGB_MODES` table in `@shared/constants` is the behavioural truth and
 * carries the same labels; this exists for call sites that have only the mode
 * id and no reason to search the behaviour table for it.
 */
export const RGB_MODE_LABEL: Record<RgbMode, string> = {
  ambient: "lighting.ambient",
  zone: "lighting.zone-sync",
  pulse: "lighting.pulse",
  static: "lighting.static",
  cycle: "lighting.color-cycle",
  wave: "lighting.wave",
  breathe: "lighting.breathe",
  audioReactive: "lighting.audio-reactive",
} as const;

/** A zone's default name, translated at creation. */
export function zoneName(n: number) {
  return t("lighting.zone-{n}", { n });
}
