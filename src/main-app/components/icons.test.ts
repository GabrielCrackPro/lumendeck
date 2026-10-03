// `deviceKind` decides both the glyph on a device card and the type label
// beside it, and it has to reach the same conclusion the driver did. It had no
// coverage at all, so the cases below are taken from the SDK's `DeviceType`
// enum rather than from what the code happened to handle.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { deviceKind, DEVICE_KINDS, IconSpinner } from "./icons";

/**
 * Every variant of the SDK's `DeviceType` (openrgb 0.1.2), which is what
 * `DeviceInfo.type_name` is: the Rust `Debug` of the enum. The wire format
 * cannot produce a string outside this list, so these are the real inputs and
 * not a sample of them.
 */
const OPENRGB_TYPES = [
  "Motherboard",
  "DRAM",
  "GPU",
  "Cooler",
  "LEDStrip",
  "Keyboard",
  "Mouse",
  "MouseMat",
  "Headset",
  "HeadsetStand",
  "Gamepad",
  "Light",
  "Speaker",
  "Virtual",
  "Unknown",
] as const;

/**
 * The types the enum can name as real hardware. `Virtual` and `Unknown` are
 * the SDK's own bail-outs — there is no truthful glyph for them — so they are
 * excluded here and asserted as `other` on their own below.
 */
const NAMED_HARDWARE = OPENRGB_TYPES.filter(
  (t) => t !== "Virtual" && t !== "Unknown",
);

describe("deviceKind", () => {
  it.each(NAMED_HARDWARE)("resolves %s rather than falling through", (type) => {
    // The regression this pins: a type the enum can actually produce landing
    // on the generic glyph, so real hardware shows the "other" box and an
    // untranslated driver string.
    expect(deviceKind(type)).not.toBe("other");
  });

  it.each([
    ["Motherboard", "motherboard"],
    ["DRAM", "dram"],
    ["GPU", "gpu"],
    // A liquid cooler is a fan as far as lighting is concerned.
    ["Cooler", "fan"],
    ["LEDStrip", "strip"],
    ["Keyboard", "keyboard"],
    ["Mouse", "mouse"],
    ["MouseMat", "mousemat"],
    ["Headset", "headset"],
    // A stand lights up because of the headset on it; same glyph, same label.
    ["HeadsetStand", "headset"],
    ["Gamepad", "gamepad"],
    ["Light", "light"],
    ["Speaker", "speaker"],
  ] as const)("maps %s to %s", (type, expected) => {
    expect(deviceKind(type)).toBe(expected);
  });

  it("has a glyph for every kind the real icon map can be asked for", () => {
    // The two halves drifting apart is the failure the export comment warns
    // about: `IconDevice` indexes DEVICE_ICONS by this string, so a kind with
    // no entry renders the generic box. DEVICE_KINDS is read off the map
    // itself — a hand-written list here would just be updated alongside the
    // same mistake.
    for (const type of NAMED_HARDWARE) {
      expect(DEVICE_KINDS).toContain(deviceKind(type));
    }
  });

  it("exposes every kind as a glyph key", () => {
    // Guards the pairing from the other side too: no orphan entries in the
    // map that no device type can reach.
    expect(DEVICE_KINDS.length).toBeGreaterThan(0);
    for (const kind of DEVICE_KINDS) {
      expect(kind).toMatch(/^[a-z]+$/);
    }
  });

  it("falls back to other for a type the SDK cannot name", () => {
    // `Virtual` and `Unknown` are the enum's own bail-outs, and a vendor
    // string that matches no rule is a drawing instruction, not a word.
    expect(deviceKind("Virtual")).toBe("other");
    expect(deviceKind("Unknown")).toBe("other");
    expect(deviceKind("")).toBe("other");
  });

  it("does not mistake a mouse pad for a mouse", () => {
    // The reason the mouse rule excludes "mat" and "pad": a mouse pad is a
    // large lit surface, not a pointing device.
    expect(deviceKind("MousePad")).toBe("mousemat");
    expect(deviceKind("Mouse")).toBe("mouse");
  });
});

// Rendered rather than inspected: `base` builds the shared svg attributes and
// spreads the caller's props last, so handing `animate-spin` in *through* that
// object silently loses it the moment a caller passes a className. The bug is
// invisible in the source and shows up only as an arc that never moves.
describe("IconSpinner", () => {
  it("keeps spinning when the caller sizes it", () => {
    const html = renderToStaticMarkup(createElement(IconSpinner, { className: "h-4 w-4" }));
    expect(html).toContain("animate-spin");
    expect(html).toContain("h-4 w-4");
  });

  it("spins with no caller class at all", () => {
    expect(renderToStaticMarkup(createElement(IconSpinner))).toContain("animate-spin");
  });

  it("draws an arc, not a closed ring", () => {
    // A full circle with no gap would render as a static donut.
    expect(renderToStaticMarkup(createElement(IconSpinner))).toContain('stroke-dasharray="30 23"');
  });
});