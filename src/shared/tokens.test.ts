import { describe, expect, it } from "vitest";
import raw from "./tokens.json";
import {
  DEFAULT_GLOW,
  HOTKEY_BLINK_COLOR,
  STICKER_DEFAULT_H,
  STICKER_DEFAULT_W,
  STICKER_MAX_SIZE,
  STICKER_MIN_SIZE,
} from "./tokens";


describe("shared tokens", () => {
  it("are the documented values", () => {
    expect(DEFAULT_GLOW).toEqual([56, 189, 248]);
    expect(HOTKEY_BLINK_COLOR).toEqual([255, 255, 255]);
    expect(STICKER_DEFAULT_W).toBe(220);
    expect(STICKER_DEFAULT_H).toBe(220);
    expect(STICKER_MIN_SIZE).toBe(48);
    expect(STICKER_MAX_SIZE).toBe(2000);
  });

  it("expose the colours as three-element tuples, not arrays", () => {
    for (const c of [DEFAULT_GLOW, HOTKEY_BLINK_COLOR]) {
      expect(c).toHaveLength(3);
      for (const channel of c) {
        expect(Number.isInteger(channel)).toBe(true);
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });

  it("keeps the sticker default inside the resize bounds", () => {
    expect(STICKER_DEFAULT_W).toBeGreaterThanOrEqual(STICKER_MIN_SIZE);
    expect(STICKER_DEFAULT_H).toBeGreaterThanOrEqual(STICKER_MIN_SIZE);
    expect(STICKER_DEFAULT_W).toBeLessThanOrEqual(STICKER_MAX_SIZE);
    expect(STICKER_DEFAULT_H).toBeLessThanOrEqual(STICKER_MAX_SIZE);
  });

  it("reads every value out of the shared file rather than declaring its own", () => {
    expect(DEFAULT_GLOW).toEqual(raw.defaultGlow);
    expect(HOTKEY_BLINK_COLOR).toEqual(raw.hotkeyBlink);
    expect(STICKER_DEFAULT_W).toBe(raw.stickerDefaultW);
    expect(STICKER_DEFAULT_H).toBe(raw.stickerDefaultH);
    expect(STICKER_MIN_SIZE).toBe(raw.stickerMinSize);
    expect(STICKER_MAX_SIZE).toBe(raw.stickerMaxSize);
  });
});
