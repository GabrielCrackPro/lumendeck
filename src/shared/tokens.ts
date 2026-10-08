
import raw from "./tokens.json";

export type RGB = [number, number, number];

function rgb(name: string, value: number[]): RGB {
  if (value.length !== 3) {
    throw new Error(`tokens.json ${name} must be [r, g, b], got ${value.length}`);
  }
  return [value[0]!, value[1]!, value[2]!];
}

export const DEFAULT_GLOW: RGB = rgb("defaultGlow", raw.defaultGlow);

export const HOTKEY_BLINK_COLOR: RGB = rgb("hotkeyBlink", raw.hotkeyBlink);

export const STICKER_DEFAULT_W = raw.stickerDefaultW;
export const STICKER_DEFAULT_H = raw.stickerDefaultH;
export const STICKER_MIN_SIZE = raw.stickerMinSize;
export const STICKER_MAX_SIZE = raw.stickerMaxSize;
