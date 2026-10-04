// What an import does to the wizard that is running it.
//
// Split out from Onboarding.tsx because the decision is pure and the one thing
// about it that can be got wrong invisibly. `App.tsx` renders the wizard only
// while `cfg.general.onboarded` is false, so a store write carrying that flag
// as true unmounts the whole component mid-import — the receipt step never
// renders, and the user is dropped into the dashboard with no confirmation that
// anything happened. The flag therefore has to be suppressed for the duration
// of the wizard, and re-asserted by the wizard's own finish.
//
// What is *not* suppressed is the user's intent: a file that says setup was
// already finished means there is nothing left for the remaining steps to
// decide, so the wizard stops asking and shows the receipt instead.
import type { Config } from "@shared/types";

/**
 * Where the wizard should stand once an import has been applied.
 *
 * `requirements` rather than straight to the receipt: OpenRGB is installed on
 * step 1 and it is the one hard dependency, so a config carrying lighting
 * settings imported onto a machine that has never run OpenRGB would otherwise
 * restore a lighting profile with nothing to drive it. It is one step, it
 * offers "start it" on a machine that already has it, and skipping it is what
 * turns a restored config into a config that looks applied and is not.
 *
 * `config` is for a file that was itself half-finished: there are answers left
 * to give, so the wizard goes to the settings step and asks.
 */
export type ImportLanding = "requirements" | "config" | "receipt";

export interface ImportReconcile {
  /** The config to put in the store: what was imported, minus the exit flag. */
  store: Config;
  landing: ImportLanding;
}

/**
 * Reconcile an imported config against the wizard that is asking for it.
 *
 * `receipt` when the imported config was already a finished setup and its own
 * requirements were met on the machine that wrote it, `config` when it was
 * half-finished. The store copy always has `onboarded` cleared — including for
 * a file that set it false — so the wizard stays mounted and its own `finish`
 * remains the single place that writes the flag back.
 */
export function reconcileImportedConfig(
  imported: Config,
  /** Whether this machine already has OpenRGB installed or running. */
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