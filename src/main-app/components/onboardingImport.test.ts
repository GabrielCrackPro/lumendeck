import { describe, expect, it } from "vitest";
import { reconcileImportedConfig } from "./onboardingImport";
import type { Config } from "@shared/types";

const cfg = (onboarded: boolean): Config =>
  ({ general: { onboarded } }) as unknown as Config;

const ANY_READY = true;

describe("reconcileImportedConfig", () => {
  it("keeps the wizard mounted even when the file says setup was finished", () => {
    // The regression this exists for: App.tsx renders Onboarding only while
    // this flag is false, so writing it as true unmounts the wizard and the
    // receipt never renders.
    expect(reconcileImportedConfig(cfg(true), ANY_READY).store.general.onboarded).toBe(
      false,
    );
  });

  it("clears the flag on a file that set it false, leaving one writer", () => {
    expect(reconcileImportedConfig(cfg(false), ANY_READY).store.general.onboarded).toBe(
      false,
    );
  });

  it("lands on the receipt when the imported setup was finished and OpenRGB is here", () => {
    expect(reconcileImportedConfig(cfg(true), true).landing).toBe("receipt");
  });

  it("visits requirements first when the machine has no OpenRGB", () => {
    // The one hard dependency. A config carrying lighting settings restored
    // onto a machine that has never run OpenRGB is a config that looks applied
    // and drives nothing.
    expect(reconcileImportedConfig(cfg(true), false).landing).toBe("requirements");
  });

  it("stays on the config step for a half-finished imported setup", () => {
    // A file with onboarded: false is someone interrupted mid-wizard. There
    // are still answers to give, so the wizard keeps asking for them — and
    // OpenRGB is one of them, so this holds either way.
    expect(reconcileImportedConfig(cfg(false), true).landing).toBe("config");
    expect(reconcileImportedConfig(cfg(false), false).landing).toBe("config");
  });

  it("preserves the rest of the config untouched", () => {
    const imported = {
      general: { onboarded: true, theme: "light", autostart: true },
      gallery: [{ id: "a", name: "x" }],
    } as unknown as Config;
    const { store } = reconcileImportedConfig(imported, ANY_READY);
    expect(store.general.theme).toBe("light");
    expect(store.general.autostart).toBe(true);
    expect(store.gallery).toBe(imported.gallery);
  });

  it("does not mutate the imported object", () => {
    const imported = cfg(true);
    reconcileImportedConfig(imported, ANY_READY);
    expect(imported.general.onboarded).toBe(true);
  });
});