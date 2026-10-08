import { useEffect, useMemo } from "react";
import { useStore } from "./store";
import { api } from "./ipc";
import { useEffectiveTheme } from "./theme";
import { resolveAccent } from "./accent";

export function useAccent() {
  const deviceColors = useStore((s) => s.deviceColors);
  const mode = useStore((s) => s.cfg?.rgb.mode);
  const staticColor = useStore((s) => s.cfg?.rgb.staticColor);
  const excluded = useStore((s) => s.cfg?.rgb.excludedDevices);
  const devices = useStore((s) => s.rgb.devices);
  const accentDevice = useStore((s) => s.cfg?.rgb.accentDevice);
  const accentLive = useStore((s) => s.cfg?.general.accentLive);
  const themePref = useStore((s) => s.cfg?.general.theme);
  const theme = useEffectiveTheme(themePref);
  const autoShade = useStore((s) => s.cfg?.general.accentAutoShade ?? 1);
  const amoled = useStore((s) => s.cfg?.general.amoled ?? false);
  const wallpaperColor = useStore((s) => s.wallpaperColor);
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

