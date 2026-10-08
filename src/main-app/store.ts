import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import i18next from "i18next";
import { EVENTS, HOTKEY_ACTIONS } from "@shared/constants";
import type {
  AudioLevel,
  Config,
  DeviceColor,
  HotkeyError,
  MediaInfo,
  RgbStatus,
} from "@shared/types";
import { api } from "./ipc";
import { pruneDeviceColors } from "./deviceColors";
import { baselineArrivals, markArrivals, type ArrivalMarks } from "./hotplug";
import { truncateError } from "./utilities";
import type { AvailableUpdate } from "./updater";
import type { UpdateCheckRecord } from "./components/updateCheck";

export interface NavRequest {
  tab: string;
  anchor?: string;
}

export interface Toast {
  id: number;
  tone: "error" | "info" | "ok";
  msg: string;
  title?: string;
  progress?: number | null;
  sticky?: boolean;
  key?: string;
  count?: number;
  action?: { label: string; run: () => void; disabled?: boolean };
  link?: { label: string; run: () => void };
}

interface Store {
  cfg: Config | null;
  rgb: RgbStatus;
  deviceColors: Record<number, DeviceColor>;
  deviceAddedAt: ArrivalMarks;
  audioLevel: AudioLevel;
  media: MediaInfo | null;
  wallpaperColor: [number, number, number] | null;
  systemAccent: [number, number, number] | null;
  systemLanguage: string | null;
  systemVolume: [number, number] | null;
  wallpaperPaused: boolean;
  hotkeyFailures: HotkeyError[];
  updateAvailable: AvailableUpdate | null;
  navRequest: NavRequest | null;
  loaded: boolean;
  saving: boolean;
  loadError: string | null;
  load: () => Promise<void>;
  save: (mutate: (cfg: Config) => void) => Promise<void>;
  setRgb: (rgb: RgbStatus) => void;
  seedRgb: (rgb: RgbStatus) => void;
  setDeviceColors: (frame: DeviceColor[]) => void;
  setAudioLevel: (level: AudioLevel) => void;
  setMedia: (media: MediaInfo | null) => void;
  setWallpaperColor: (c: [number, number, number]) => void;
  setSystemAccent: (c: [number, number, number] | null) => void;
  setSystemLanguage: (tag: string | null) => void;
  setWallpaperPaused: (p: boolean) => void;
  setHotkeyFailures: (failures: HotkeyError[]) => void;
  setUpdateAvailable: (update: AvailableUpdate | null) => void;
  updateCheck: UpdateCheckRecord | null;
  setUpdateCheck: (record: UpdateCheckRecord | null) => void;
  navigateTo: (tab: string, anchor?: string) => void;
  clearNavRequest: () => void;
  toasts: Toast[];
  toast: (
    tone: Toast["tone"],
    msg: string,
    opts?: Partial<
      Pick<Toast, "action" | "link" | "title" | "progress" | "sticky" | "key">
    >,
  ) => void;
  patchToast: (id: number, patch: Partial<Omit<Toast, "id">>) => void;
  dismissToast: (id: number) => void;
  undoDelete: (msg: string, restore: (cfg: Config) => void) => void;
}

async function invokeWithTimeout<T>(
  cmd: string,
  args?: Record<string, unknown>,
  ms = 8000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`invoke("${cmd}") timed out after ${ms}ms`)),
      ms,
    );
  });
  try {
    return (await Promise.race([invoke<T>(cmd, args), timeout])) as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const useStore = create<Store>((set, get) => ({
  cfg: null,
  rgb: {
    connected: false,
    protocolVersion: null,
    devices: [],
    lastError: null,
  },
  deviceColors: {},
  deviceAddedAt: {},
  audioLevel: { volume: 0, pulse: 0, deviceName: "" },
  media: null,
  wallpaperColor: null,
  systemAccent: null,
  systemLanguage: null,
  systemVolume: null,
  wallpaperPaused: false,
  hotkeyFailures: [],
  updateAvailable: null,
  updateCheck: null,
  navRequest: null,
  loaded: false,
  saving: false,
  loadError: null,

  load: async () => {
    set({ loaded: false, loadError: null });
    const [cfgRes, rgbRes, mediaRes] = await Promise.allSettled([
      invokeWithTimeout<Config>("get_config"),
      invokeWithTimeout<RgbStatus>("rgb_status"),
      invokeWithTimeout<MediaInfo | null>("media_current"),
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
    if (mediaRes.status === "fulfilled") {
      patch.media = mediaRes.value;
    }

    patch.loadError = errors.length ? errors.join(" · ") : null;
    set(patch as Store);
    if (patch.loadError) {
      get().toast("error", i18next.t("common.backend-unreachable-{error}", { error: patch.loadError }));
    }
  },

  toasts: [],
  toast: (tone, msg, opts) =>
    set((s) => {
      if (opts?.key) {
        const i = s.toasts.findIndex((t) => t.key === opts.key);
        if (i !== -1) {
          const toasts = [...s.toasts];
          const prev = toasts[i]!;
          toasts[i] = {
            ...prev,
            tone,
            msg,
            title: opts.title,
            action: opts.action,
            progress: opts.progress,
            sticky: opts.sticky,
            count: (prev.count ?? 1) + 1,
          };
          return { toasts };
        }
      }
      return {
        toasts: [
          ...s.toasts,
          { id: Date.now() + Math.random(), tone, msg, ...opts },
        ],
      };
    }),
  patchToast: (id, patch) =>
    set((s) => ({
      toasts: s.toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  undoDelete: (msg, restore) => {
    const id = Date.now() + Math.random();
    set((s) => ({
      toasts: [
        ...s.toasts,
        {
          id,
          tone: "info" as const,
          msg,
          action: {
            label: i18next.t("common.undo"),
            run: () => {
              get().dismissToast(id);
              void get().save(restore);
            },
          },
        },
      ],
    }));
  },

  save: async (mutate) => {
    const current = get().cfg;
    if (!current) return;
    const next = structuredClone(current);
    mutate(next);
    set({ cfg: next, saving: true });
    try {
      const saved = await api.setConfig(next);
      set({ cfg: saved });
    } catch (e) {
      get().toast("error", i18next.t("common.save-failed-{error}", { error: truncateError(e, 140) }));
      get()
        .load()
        .catch(() => {});
    } finally {
      set({ saving: false });
    }
  },

  setRgb: (rgb) =>
    set((s) => ({
      rgb,
      deviceColors: pruneDeviceColors(
        s.deviceColors,
        rgb.devices.map((d) => d.id),
      ),
      deviceAddedAt: markArrivals(
        s.deviceAddedAt,
        s.rgb.devices.map((d) => d.id),
        rgb.devices.map((d) => d.id),
        Date.now(),
      ),
    })),
  seedRgb: (rgb) =>
    set((s) => ({
      rgb,
      deviceColors: pruneDeviceColors(
        s.deviceColors,
        rgb.devices.map((d) => d.id),
      ),
      deviceAddedAt: baselineArrivals(
        s.deviceAddedAt,
        rgb.devices.map((d) => d.id),
      ),
    })),
  setDeviceColors: (frame) =>
    set((s) => {
      const next = { ...s.deviceColors };
      for (const d of frame) next[d.id] = d;
      return { deviceColors: next };
    }),
  setAudioLevel: (audioLevel) => set({ audioLevel }),
  setMedia: (media) => set({ media }),
  setWallpaperColor: (wallpaperColor) => set({ wallpaperColor }),
  setSystemAccent: (systemAccent) => set({ systemAccent }),
  setSystemLanguage: (systemLanguage) => set({ systemLanguage }),
  setWallpaperPaused: (wallpaperPaused) => set({ wallpaperPaused }),
  setHotkeyFailures: (hotkeyFailures) => set({ hotkeyFailures }),
  setUpdateAvailable: (updateAvailable) => set({ updateAvailable }),
  setUpdateCheck: (updateCheck) => set({ updateCheck }),
  navigateTo: (tab, anchor) =>
    set({ navRequest: { tab, anchor } }),
  clearNavRequest: () => set({ navRequest: null }),
}));

export async function bindEvents(): Promise<() => void> {
  const unsubs: (() => void)[] = [];
  unsubs.push(
    await listen<Config>(EVENTS.CONFIG_CHANGED, (e) => {
      useStore.setState({ cfg: e.payload });
    }),
  );
  let lastDeviceIds: number[] | null = null;
  unsubs.push(
    await listen<RgbStatus>(EVENTS.RGB_STATUS, (e) => {
      const prev = lastDeviceIds;
      const next = e.payload.devices.map((d) => d.id);
      const userDisabled = useStore.getState().cfg?.rgb.enabled === false;
      if (prev !== null && !e.payload.connected && prev.length > 0 && !userDisabled) {
        useStore
          .getState()
          .toast("info", "OpenRGB disconnected", { key: "openrgb" });
      } else if (prev !== null && e.payload.connected) {
        const added = next.filter((id) => !prev.includes(id));
        const removed = prev.filter((id) => !next.includes(id));
        const nameOf = (id: number) =>
          e.payload.devices.find((d) => d.id === id)?.name ?? `Device ${id}`;
        for (const id of added) {
          useStore
            .getState()
            .toast("ok", `${nameOf(id)} connected`, { key: `device:${id}` });
        }
        for (const id of removed) {
          useStore
            .getState()
            .toast("info", `${nameOf(id)} disconnected`, {
              key: `device:${id}`,
            });
        }
      }
      lastDeviceIds = e.payload.connected ? next : [];
      useStore.getState().setRgb(e.payload);
    }),
  );
  let latestFrame: DeviceColor[] | null = null;
  let frameTimer: ReturnType<typeof setInterval> | null = null;
  unsubs.push(
    await listen<DeviceColor[]>(EVENTS.RGB_FRAME, (e) => {
      latestFrame = e.payload;
      if (frameTimer == null) {
        frameTimer = setInterval(() => {
          if (latestFrame != null) {
            useStore.getState().setDeviceColors(latestFrame);
            latestFrame = null;
          }
        }, 80);
      }
    }),
  );
  unsubs.push(
    await listen<boolean>(EVENTS.WALLPAUSE, (e) => {
      useStore.getState().setWallpaperPaused(e.payload);
    }),
  );
  unsubs.push(
    await listen<AudioLevel>(EVENTS.AUDIO_LEVEL, (e) => {
      useStore.getState().setAudioLevel(e.payload);
    }),
    await listen<MediaInfo | null>(EVENTS.MEDIA_SESSION, (e) => {
      useStore.getState().setMedia(e.payload);
    }),
  );
  unsubs.push(
    await listen<[number, number, number]>(EVENTS.WALLPAPER_COLOR, (e) => {
      useStore.getState().setWallpaperColor(e.payload);
    }),
  );
  unsubs.push(
    await listen<[number, number, number]>(EVENTS.SYSTEM_ACCENT, (e) => {
      useStore.getState().setSystemAccent(e.payload);
    }),
  );
  unsubs.push(
    await listen<[number, number]>(EVENTS.VOLUME_CHANGED, (e) => {
      useStore.setState({ systemVolume: e.payload });
    }),
  );
  unsubs.push(
    await listen<HotkeyError>(EVENTS.HOTKEY_ERROR, (e) => {
      const { action, accelerator, message } = e.payload;
      const label = HOTKEY_ACTIONS.find((a) => a.id === action)?.label ?? action;
      useStore
        .getState()
        .toast(
          accelerator ? "error" : "info",
          accelerator
            ? `${label}: ${accelerator} could not be bound — ${message}`
            : `${label} — ${message}`,
          { key: `hotkey:${action}:${accelerator}` },
        );
    }),
  );
  unsubs.push(
    await listen<HotkeyError[]>(EVENTS.HOTKEY_STATUS, (e) => {
      useStore.getState().setHotkeyFailures(e.payload ?? []);
    }),
  );
  try {
    const initial = await api.rgbStatus();
    lastDeviceIds = initial.connected ? initial.devices.map((d) => d.id) : [];
    useStore.getState().seedRgb(initial);
  } catch (e) {
    console.error("[rgb] initial status poll failed", e);
  }
  return () => {
    unsubs.forEach((u) => u());
    if (frameTimer != null) clearInterval(frameTimer);
  };
}
