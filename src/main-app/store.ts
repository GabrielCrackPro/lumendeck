// Global dashboard state: config + rgb status + pause, synced with the backend.
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { EVENTS } from "@shared/constants";
import type { AudioLevel, Config, DeviceColor, MediaInfo, RgbStatus } from "@shared/types";
import { api } from "./ipc";
import { truncateError } from "./utilities";
import type { AvailableUpdate } from "./updater";

export interface Toast {
  id: number;
  tone: "error" | "info" | "ok";
  msg: string;
  /** Bold headline above the message. Omitted for one-line notices. */
  title?: string;
  /** 0..100 while a long task runs (an update download). */
  progress?: number | null;
  /** Stay until dismissed — for things the user should not miss. */
  sticky?: boolean;
  /**
   * Collapses repeats: a new toast with the same key updates this one in
   * place and bumps `count` instead of stacking. A device that reconnects
   * every few seconds should read as "flapping", not as fifty cards.
   */
  key?: string;
  /** How many times a keyed toast has fired. */
  count?: number;
  /** Optional single action — "Undo" on deletes, "Install" on an update. */
  action?: { label: string; run: () => void; disabled?: boolean };
}

interface Store {
  cfg: Config | null;
  rgb: RgbStatus;
  /** Latest colors actually pushed to OpenRGB, keyed by device id. */
  deviceColors: Record<number, DeviceColor>;
  /** Live audio level from the audio-reactive mode. */
  audioLevel: AudioLevel;
  /** What the OS media session is playing (null = nothing). */
  media: MediaInfo | null;
  /** Wallpaper's current dominant color — drives the UI glow. */
  wallpaperColor: [number, number, number] | null;
  wallpaperPaused: boolean;
  updateAvailable: AvailableUpdate | null;
  loaded: boolean;
  /** True while a config save is in flight (optimistic UI already applied). */
  saving: boolean;
  loadError: string | null;
  load: () => Promise<void>;
  save: (mutate: (cfg: Config) => void) => Promise<void>;
  setRgb: (rgb: RgbStatus) => void;
  setDeviceColors: (frame: DeviceColor[]) => void;
  setAudioLevel: (level: AudioLevel) => void;
  setMedia: (media: MediaInfo | null) => void;
  setWallpaperColor: (c: [number, number, number]) => void;
  setWallpaperPaused: (p: boolean) => void;
  setUpdateAvailable: (update: AvailableUpdate | null) => void;
  /** Transient notifications (auto-dismiss in Shell). */
  toasts: Toast[];
  toast: (
    tone: Toast["tone"],
    msg: string,
    opts?: Partial<
      Pick<Toast, "action" | "title" | "progress" | "sticky" | "key">
    >,
  ) => void;
  /** Patch an existing toast in place (progress ticks, disabling its action). */
  patchToast: (id: number, patch: Partial<Omit<Toast, "id">>) => void;
  dismissToast: (id: number) => void;
  /**
   * Toast offering to put a just-deleted config entity back, verbatim.
   * `restore` mutates the config the same way the delete removed it, so the
   * original id (and anything pointing at it) survives.
   */
  undoDelete: (msg: string, restore: (cfg: Config) => void) => void;
}

/** Invoke with a timeout so a hung command becomes a visible error. */
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
  audioLevel: { volume: 0, beat: false, deviceName: "" },
  media: null,
  wallpaperColor: null,
  wallpaperPaused: false,
  updateAvailable: null,
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
    // Media is optional chrome: a failure to read SMTC must never block the
    // dashboard, and "no session" (null) is a normal state.
    if (mediaRes.status === "fulfilled") {
      patch.media = mediaRes.value;
    }

    patch.loadError = errors.length ? errors.join(" · ") : null;
    set(patch as Store);
    // Surface load problems as toasts too (refreshes included).
    if (patch.loadError) {
      get().toast("error", `Backend unreachable — ${patch.loadError}`);
    }
  },

  toasts: [],
  toast: (tone, msg, opts) =>
    set((s) => {
      // A repeat with the same key updates the card already on screen: the
      // newest state wins, the card keeps one identity, and the count says
      // how noisy it has been. The dismiss timer restarts with it.
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
            label: "Undo",
            run: () => {
              get().dismissToast(id);
              // save() reports its own failures; a rejected restore just
              // re-syncs from the backend like any other failed write.
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
    set({ cfg: next, saving: true }); // optimistic
    try {
      const saved = await api.setConfig(next);
      set({ cfg: saved });
    } catch (e) {
      get().toast("error", `Save failed: ${truncateError(e, 140)}`);
      // Re-sync with the truth so the optimistic state doesn't linger.
      get()
        .load()
        .catch(() => {});
    } finally {
      set({ saving: false });
    }
  },

  setRgb: (rgb) => set({ rgb }),
  setDeviceColors: (frame) =>
    set((s) => {
      const next = { ...s.deviceColors };
      for (const d of frame) next[d.id] = d;
      return { deviceColors: next };
    }),
  setAudioLevel: (audioLevel) => set({ audioLevel }),
  setMedia: (media) => set({ media }),
  setWallpaperColor: (wallpaperColor) => set({ wallpaperColor }),
  setWallpaperPaused: (wallpaperPaused) => set({ wallpaperPaused }),
  setUpdateAvailable: (updateAvailable) => set({ updateAvailable }),
}));

/** Subscribe to backend events; returns a cleanup fn. */
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
      if (prev !== null && !e.payload.connected && prev.length > 0) {
        useStore
          .getState()
          .toast("info", "OpenRGB disconnected", { key: "openrgb" });
      } else if (prev !== null && e.payload.connected) {
        const added = next.filter((id) => !prev.includes(id));
        const removed = prev.filter((id) => !next.includes(id));
        const nameOf = (id: number) =>
          e.payload.devices.find((d) => d.id === id)?.name ?? `Device ${id}`;
        // Keyed per device: a USB hub that drops and comes back produces one
        // card that keeps count, not a new card on every transition.
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
  // The engine emits frames at up to 40Hz per device; the dashboard preview
  // only needs ~12Hz. Coalesce to the latest frame on a fixed interval so the
  // store (and every subscribing component) re-renders 3-4x less.
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
  return () => {
    unsubs.forEach((u) => u());
    if (frameTimer != null) clearInterval(frameTimer);
  };
}
