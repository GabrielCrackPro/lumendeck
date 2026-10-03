// Global dashboard state: config + rgb status + pause, synced with the backend.
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
// i18n.ts reads the config off this store, so importing its bound `t` back
// would close an import cycle. i18next is the same singleton underneath and
// has no such dependency.
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
  /**
   * When each device id arrived, ms. Drives the "just connected" highlight on
   * the device card, which has to outlive the toast because a toast only helps
   * someone already looking at the dashboard.
   *
   * A device with no entry was present when we started watching — it has not
   * been seen to arrive, so it gets no badge.
   */
  deviceAddedAt: ArrivalMarks;
  /** Live audio level from the audio-reactive mode. */
  audioLevel: AudioLevel;
  /** What the OS media session is playing (null = nothing). */
  media: MediaInfo | null;
  /** Wallpaper's current dominant color — drives the UI glow. */
  wallpaperColor: [number, number, number] | null;
  /** The user's Windows accent color; live-updated via SYSTEM_ACCENT. */
  systemAccent: [number, number, number] | null;
  /** The Windows display language as a BCP-47 tag ("es-ES"), fetched once at
   *  boot. Read by the UI only when `general.language` is "auto"; the backend
   *  reads the same preference for the tray. */
  systemLanguage: string | null;
  /** Latest [volume_percent, muted_flag] from the backend volume watcher. */
  systemVolume: [number, number] | null;
  wallpaperPaused: boolean;
  /**
   * Bindings the OS refused on the last registration pass. Held here rather
   * than only toasted, so the settings row can keep saying "this combo does
   * nothing" for as long as it is true — a toast is gone in four seconds,
   * which is easy to miss for a binding that silently never fires.
   */
  hotkeyFailures: HotkeyError[];
  updateAvailable: AvailableUpdate | null;
  loaded: boolean;
  /** True while a config save is in flight (optimistic UI already applied). */
  saving: boolean;
  loadError: string | null;
  load: () => Promise<void>;
  save: (mutate: (cfg: Config) => void) => Promise<void>;
  setRgb: (rgb: RgbStatus) => void;
  /**
   * Adopt a device list we asked for rather than were told, without recording
   * arrivals. Only the boot poll may use this: hardware already plugged in
   * when the app launched did not just connect, and a dashboard that opens
   * with six "just connected" cards is worse than one that says nothing.
   */
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
      get().toast("error", i18next.t("common.backend-unreachable-{error}", { error: patch.loadError }));
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
            label: i18next.t("common.undo"),
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
      get().toast("error", i18next.t("common.save-failed-{error}", { error: truncateError(e, 140) }));
      // Re-sync with the truth so the optimistic state doesn't linger.
      get()
        .load()
        .catch(() => {});
    } finally {
      set({ saving: false });
    }
  },

  // Pruning lives here rather than at the event listener so that every route
  // into a new device list gets it: the `rgb-status` event, the boot poll, and
  // the onboarding probe. A caller that remembered to prune would have been
  // the same class of bug as the one that never emitted the event at all.
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
  // The one status we requested rather than were told. Diffing it against an
  // empty baseline would report every device the user already owns as a fresh
  // arrival, so it is adopted without recording anything.
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
      // Turning lighting off in the settings clears the backend's device list
      // too, which would otherwise read as OpenRGB having crashed and raise a
      // toast every time the user toggled the feature they were looking at.
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
  // A hotkey that could not be bound (another app owns the combo) or that had
  // nothing to act on. Keyed per accelerator so a combo another app holds
  // produces one toast rather than one per failed save. A press with nothing
  // to act on is informational, not a failure — the binding itself is fine.
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
  // The full post-registration picture. Replaces the list outright each pass,
  // so a combo the user has just fixed stops showing as broken without any
  // extra bookkeeping on the frontend.
  unsubs.push(
    await listen<HotkeyError[]>(EVENTS.HOTKEY_STATUS, (e) => {
      useStore.getState().setHotkeyFailures(e.payload ?? []);
    }),
  );
  // The backend only emits on a *transition* — emitting every poll would wake
  // all four webviews once a second to re-render an unchanged list. So a
  // machine whose gear never changes emits nothing, and the dashboard would
  // sit on its boot-time default showing no devices at all. One poll is the
  // baseline; every later change arrives as an event. Seeding
  // `lastDeviceIds` at the same time is what keeps the first real transition
  // from looking like a mass disconnect.
  //
  // Last, deliberately: this is an awaited round-trip, and every listener
  // above needs to be subscribed before it returns or early `rgb-frame`s have
  // nowhere to land.
  try {
    const initial = await api.rgbStatus();
    lastDeviceIds = initial.connected ? initial.devices.map((d) => d.id) : [];
    useStore.getState().seedRgb(initial);
  } catch (e) {
    // Not swallowing this: an unreachable IPC host is a real fault, and the
    // device list stays empty with nothing to say why. A missing OpenRGB
    // server is not — `rgbStatus` still returns a status in that case.
    console.error("[rgb] initial status poll failed", e);
  }
  return () => {
    unsubs.forEach((u) => u());
    if (frameTimer != null) clearInterval(frameTimer);
  };
}
