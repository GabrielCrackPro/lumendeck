import type { RgbMode } from "@shared/types";
import { t } from "./i18n";

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

export function zoneName(n: number) {
  return t("lighting.zone-{n}", { n });
}
