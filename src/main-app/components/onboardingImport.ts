import type { Config } from "@shared/types";

export type ImportLanding = "requirements" | "config" | "receipt";

export interface ImportReconcile {
  store: Config;
  landing: ImportLanding;
}

export function reconcileImportedConfig(
  imported: Config,
  openrgbReady: boolean,
): ImportReconcile {
  return {
    store: {
      ...imported,
      general: { ...imported.general, onboarded: false },
    },
    landing: !imported.general.onboarded
      ? "config"
      : openrgbReady
        ? "receipt"
        : "requirements",
  };
}