import { useEffect, useMemo } from "react";
import { useStore } from "./store";
import { api } from "./ipc";
import { useEffectiveTheme } from "./theme";
import { resolveAccent } from "./accent";

/**
 * The UI accent and where it came from.
 *
 * One hook because it is one decision. This used to live in `Shell.tsx` as
 * `useGlow`, with the Overview keeping a hand-written mirror of the branch
 * order for its provenance chip — and the mirror drifted: it read
 * `devices.length > 0` as "there is a device colour", so a connected device
 * that had never reported one made the chip name a source the interface was
 * not actually using. Resolving here once means the chip and the CSS variable
 * cannot disagree again.
 *
 * Both readers subscribe to the same slices and run the same pure resolver,
 * so the work is a memo each rather than a new store field, and neither
 * consumer has to know the other exists.
 *
 * `resolveAccent` carries the precedence commentary; this file is only the
 * store plumbing around it.
 */
export function useAccent() {
  const deviceColors = useStore((s) => s.deviceColors);
  const mode = useStore((s) => s.cfg?.rgb.mode);
  const staticColor = useStore((s) => s.cfg?.rgb.staticColor);
  const excluded = useStore((s) => s.cfg?.rgb.excludedDevices);
  const devices = useStore((s) => s.rgb.devices);
  const accentDevice = useStore((s) => s.cfg?.rgb.accentDevice);
  const accentLive = useStore((s) => s.cfg?.general.accentLive);
  // The *resolved* theme, not the preference: the readability pass corrects
  // the accent against a surface, so "system" on a light OS has to resolve to
  // light or the whole UI is tinted against the wrong background.
  const themePref = useStore((s) => s.cfg?.general.theme);
  const theme = useEffectiveTheme(themePref);
  const autoShade = useStore((s) => s.cfg?.general.accentAutoShade ?? 1);
  // AMOLED is a separate surface, not a darker dark: .dark.amoled drops --bg
  // to #000000. The readability pass has to be told, or an accent tuned
  // against graphite is left short of the contrast floor on true black.
  const amoled = useStore((s) => s.cfg?.general.amoled ?? false);
  const wallpaperColor = useStore((s) => s.wallpaperColor);
  // The user's Windows accent color, seeded once via IPC and kept live by the
  // backend watcher (SYSTEM_ACCENT). This is the deep fallback for every
  // config-less case, so a fresh install themes itself from the OS instead of
  // wearing a hardcoded blue, and mid-session OS accent changes retheme the
  // dashboard without a restart. Fetched wherever the accent is read, not
  // only in Shell: the Overview's chip needs the same value to name its
  // branch honestly, and the fetch is idempotent.
  const sysAccent = useStore((s) => s.systemAccent);
  useEffect(() => {
    if (sysAccent) return;
    let disposed = false;
    api.systemAccent().then((c) => {
      if (!disposed && c) useStore.getState().setSystemAccent(c);
    }).catch(() => {});
    return () => {
      disposed = true;
    };
  }, [sysAccent]);

  return useMemo(
    () =>
      resolveAccent({
        deviceColors,
        mode,
        staticColor,
        excludedDevices: excluded,
        devices,
        accentDevice: accentDevice ?? null,
        accentLive: accentLive ?? false,
        wallpaperColor,
        sysAccent,
        theme,
        autoShade,
        amoled,
      }),
    [
      deviceColors,
      mode,
      staticColor,
      excluded,
      devices,
      accentDevice,
      accentLive,
      wallpaperColor,
      sysAccent,
      theme,
      autoShade,
      amoled,
    ],
  );
}

