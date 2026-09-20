// Global dashboard state: config + rgb status + pause, synced with the backend.
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { EVENTS } from "@shared/constants";
import type { Config, DeviceColor, RgbStatus } from "@shared/types";
import { api } from "./ipc";

interface Store {
  cfg: Config | null;
  rgb: RgbStatus;
  /** Latest colors actually pushed to OpenRGB, keyed by device id. */
  deviceColors: Record<number, DeviceColor>;
  wallpaperPaused: boolean;
  loaded: boolean;
  loadError: string | null;
  load: () => Promise<void>;
  save: (mutate: (cfg: Config) => void) => Promise<void>;
  setRgb: (rgb: RgbStatus) => void;
  setDeviceColors: (frame: DeviceColor[]) => void;
  setWallpaperPaused: (p: boolean) => void;
}

/** Invoke with a timeout so a hung command becomes a visible error. */
async function invokeWithTimeout<T>(cmd: string, args?: Record<string, unknown>, ms = 8000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`invoke("${cmd}") timed out after ${ms}ms`)), ms);
  });
  try {
    return (await Promise.race([invoke<T>(cmd, args), timeout])) as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const useStore = create<Store>((set, get) => ({
  cfg: null,
  rgb: { connected: false, protocolVersion: null, devices: [], lastError: null },
  deviceColors: {},
  wallpaperPaused: false,
  loaded: false,
  loadError: null,

  load: async () => {
    set({ loaded: false, loadError: null });
    const [cfgRes, rgbRes] = await Promise.allSettled([
      invokeWithTimeout<Config>("get_config"),
      invokeWithTimeout<RgbStatus>("rgb_status"),
    ]);

    const errors: string[] = [];
    const patch: Partial<Store> = { loaded: true };

    if (cfgRes.status === "fulfilled") {
      patch.cfg = cfgRes.value;
    } else {
      errors.push(`config: ${String(cfgRes.reason)}`);
    }
    if (rgbRes.status === "fulfilled") {
      patch.rgb = rgbRes.value;
    } else {
      errors.push(`rgb: ${String(rgbRes.reason)}`);
    }

    patch.loadError = errors.length ? errors.join(" · ") : null;
    set(patch as Store);
  },

  save: async (mutate) => {
    const current = get().cfg;
    if (!current) return;
    const next = structuredClone(current);
    mutate(next);
    set({ cfg: next }); // optimistic
    const saved = await api.setConfig(next);
    set({ cfg: saved });
  },

  setRgb: (rgb) => set({ rgb }),
  setDeviceColors: (frame) =>
    set((s) => {
      const next = { ...s.deviceColors };
      for (const d of frame) next[d.id] = d;
      return { deviceColors: next };
    }),
  setWallpaperPaused: (wallpaperPaused) => set({ wallpaperPaused }),
}));

/** Subscribe to backend events; returns a cleanup fn. */
export async function bindEvents(): Promise<() => void> {
  const unsubs: (() => void)[] = [];
  unsubs.push(
    await listen<Config>(EVENTS.CONFIG_CHANGED, (e) => {
      useStore.setState({ cfg: e.payload });
    }),
  );
  unsubs.push(
    await listen<RgbStatus>(EVENTS.RGB_STATUS, (e) => {
      useStore.getState().setRgb(e.payload);
    }),
  );
  unsubs.push(
    await listen<DeviceColor[]>(EVENTS.RGB_FRAME, (e) => {
      useStore.getState().setDeviceColors(e.payload);
    }),
  );
  unsubs.push(
    await listen<boolean>(EVENTS.WALLPAUSE, (e) => {
      useStore.getState().setWallpaperPaused(e.payload);
    }),
  );
  return () => unsubs.forEach((u) => u());
}
