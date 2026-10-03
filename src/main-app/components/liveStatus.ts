// What the status dot on the profile avatar means.
//
// Extracted because it is a judgement, not a lookup: three independent things
// can be wrong and the dot only has two states to show them in, so the rule for
// what counts as "fine" is worth stating once and testing rather than reading
// off a ternary.
//
// Pure, and vitest has no DOM to click the dot in.

export interface LiveInputs {
  /** The OpenRGB server answered. */
  rgbConnected: boolean;
  /** The user has not switched the lights off. */
  rgbEnabled: boolean;
  /** The wallpaper is enabled and not paused. */
  wallpaperRunning: boolean;
}

/**
 * Whether everything is running as asked.
 *
 * All three, not any. A dot next to a profile is claiming *this setup is
 * working*, and a setup with the wallpaper paused is not working however
 * healthy the lights are.
 */
export function isLiveStatus(s: LiveInputs): boolean {
  return s.rgbConnected && s.rgbEnabled && s.wallpaperRunning;
}
