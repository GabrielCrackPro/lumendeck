
export interface LiveInputs {
  rgbConnected: boolean;
  rgbEnabled: boolean;
  wallpaperRunning: boolean;
}

export function isLiveStatus(s: LiveInputs): boolean {
  return s.rgbConnected && s.rgbEnabled && s.wallpaperRunning;
}
