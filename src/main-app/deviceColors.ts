// Per-device colour cache maintenance. Pure so the pruning rule can be pinned
// without a DOM or a running OpenRGB server.

import type { DeviceColor } from "@shared/types";

/**
 * Latest colour per device id, as held by the store.
 *
 * Keyed by id rather than a list because the engine sends one entry per device
 * per frame and the consumers look up by id.
 */
export type DeviceColors = Record<number, DeviceColor>;

/**
 * Drop colour entries for devices that are no longer connected.
 *
 * The store accumulates this map rather than replacing it — `setDeviceColors`
 * merges, because the engine legitimately omits a device from some frames (an
 * idle blink, a device with nothing to push this tick) and replacing wholesale
 * would strobe its preview black. Merging means an unplugged device's last
 * colour is never overwritten again, so without this it stays in the map for
 * the life of the process.
 *
 * That is not cosmetic. Three consumers read the whole map rather than a
 * device they have already looked up:
 *
 *   - `Sidebar.tsx` averages every entry into the sidebar's accent colour
 *   - `Shell.tsx` falls back to `Object.values(...).find(...)` when the
 *     configured accent device has no live colour
 *   - `RgbTab.tsx` takes `Object.values(...)[0]`
 *
 * so a phantom entry keeps tinting the interface, and because those two
 * fallbacks are order-dependent, an unplugged device can win outright against
 * a real one.
 *
 * The live id list comes from the `rgb-status` payload, which is the
 * authoritative answer to "what is plugged in" — polling `deviceColors` for
 * staleness cannot tell a device that is idle from one that is gone.
 *
 * Returns the input unchanged when nothing needs dropping. `RgbTab` decides
 * whether to re-render by comparing the map's reference, so allocating a fresh
 * object on every status event would cost a render that shows nothing new.
 */
export function pruneDeviceColors(
  colors: DeviceColors,
  live: Iterable<number>,
): DeviceColors {
  const keep = live instanceof Set ? live : new Set(live);
  const stale: number[] = [];
  for (const id of Object.keys(colors)) {
    if (!keep.has(Number(id))) {
      stale.push(Number(id));
    }
  }
  if (stale.length === 0) {
    return colors;
  }
  // Copy first: the map is handed out to every subscriber by reference, and
  // mutating it in place would re-render nothing while corrupting what they
  // are currently rendering.
  const next: DeviceColors = { ...colors };
  for (const id of stale) {
    delete next[id];
  }
  return next;
}