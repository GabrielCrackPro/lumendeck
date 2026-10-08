import { describe, expect, it } from "vitest";
import {
  CARETLESS_INPUT_TYPES,
  shouldSuppressContextMenu,
  type ContextMenuTarget,
} from "./contextMenu";

function el(
  tagName: string,
  extra: Partial<ContextMenuTarget> = {},
): ContextMenuTarget {
  return { tagName, ...extra };
}

describe("shouldSuppressContextMenu", () => {
  it("suppresses it on ordinary UI", () => {
    for (const tag of ["div", "span", "button", "canvas", "img", "p"]) {
      expect(shouldSuppressContextMenu(el(tag)), tag).toBe(true);
    }
  });

  it("keeps it where the user types", () => {
    expect(shouldSuppressContextMenu(el("textarea"))).toBe(false);
    expect(shouldSuppressContextMenu(el("input"))).toBe(false);
    expect(shouldSuppressContextMenu(el("input", { type: "text" }))).toBe(false);
    expect(shouldSuppressContextMenu(el("input", { type: "search" }))).toBe(false);
    expect(shouldSuppressContextMenu(el("input", { type: "url" }))).toBe(false);
  });

  it("keeps it on a number and time field, which still take a paste", () => {
    expect(shouldSuppressContextMenu(el("input", { type: "number" }))).toBe(false);
    expect(shouldSuppressContextMenu(el("input", { type: "time" }))).toBe(false);
  });

  it("suppresses it on the input types with no caret at all", () => {
    for (const type of CARETLESS_INPUT_TYPES) {
      expect(shouldSuppressContextMenu(el("input", { type })), type).toBe(true);
    }
  });

  it("does not mistake a control for a text field by tag alone", () => {
    expect(shouldSuppressContextMenu(el("input", { type: "range" }))).toBe(true);
    expect(shouldSuppressContextMenu(el("input", { type: "button" }))).toBe(true);
    expect(shouldSuppressContextMenu(el("input", { type: "checkbox" }))).toBe(true);
  });

  it("treats a missing type attribute as text", () => {
    expect(shouldSuppressContextMenu(el("input", { type: null }))).toBe(false);
    expect(shouldSuppressContextMenu(el("input", { type: "" }))).toBe(false);
    expect(shouldSuppressContextMenu(el("input", {}))).toBe(false);
  });

  it("keeps it on a contenteditable element whatever its tag", () => {
    expect(shouldSuppressContextMenu(el("div", { isContentEditable: true }))).toBe(
      false,
    );
    expect(shouldSuppressContextMenu(el("span", { isContentEditable: true }))).toBe(
      false,
    );
  });

  it("does not depend on the DOM's uppercase tag names", () => {
    expect(shouldSuppressContextMenu(el("TEXTAREA"))).toBe(false);
    expect(shouldSuppressContextMenu(el("INPUT", { type: "RANGE" }))).toBe(true);
    expect(shouldSuppressContextMenu(el("INPUT"))).toBe(false);
  });

  it("suppresses it on an element that claims no tag", () => {
    expect(shouldSuppressContextMenu(el(""))).toBe(true);
  });
});
