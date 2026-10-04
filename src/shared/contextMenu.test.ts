import { describe, expect, it } from "vitest";
import {
  CARETLESS_INPUT_TYPES,
  shouldSuppressContextMenu,
  type ContextMenuTarget,
} from "./contextMenu";

/** Shorthand for the element shape the predicate reads. */
function el(
  tagName: string,
  extra: Partial<ContextMenuTarget> = {},
): ContextMenuTarget {
  return { tagName, ...extra };
}

describe("shouldSuppressContextMenu", () => {
  it("suppresses it on ordinary UI", () => {
    // The case being fixed: WebView2's Back, Reload and Inspect over a card
    // that has no browser behind it.
    for (const tag of ["div", "span", "button", "canvas", "img", "p"]) {
      expect(shouldSuppressContextMenu(el(tag)), tag).toBe(true);
    }
  });

  it("keeps it where the user types", () => {
    // No in-app paste anywhere, so removing this would make these fields
    // unusable for anything typed from the clipboard.
    expect(shouldSuppressContextMenu(el("textarea"))).toBe(false);
    expect(shouldSuppressContextMenu(el("input"))).toBe(false);
    expect(shouldSuppressContextMenu(el("input", { type: "text" }))).toBe(false);
    expect(shouldSuppressContextMenu(el("input", { type: "search" }))).toBe(false);
    expect(shouldSuppressContextMenu(el("input", { type: "url" }))).toBe(false);
  });

  it("keeps it on a number and time field, which still take a paste", () => {
    // They have no word to spellcheck, but they do have a caret and a
    // selection, so the menu is not empty on them.
    expect(shouldSuppressContextMenu(el("input", { type: "number" }))).toBe(false);
    expect(shouldSuppressContextMenu(el("input", { type: "time" }))).toBe(false);
  });

  it("suppresses it on the input types with no caret at all", () => {
    // A slider's menu offers nothing but itself. These are the only types
    // named in the set, so the test follows the set rather than restating it.
    for (const type of CARETLESS_INPUT_TYPES) {
      expect(shouldSuppressContextMenu(el("input", { type })), type).toBe(true);
    }
  });

  it("does not mistake a control for a text field by tag alone", () => {
    // Every range input in the app is styled to look like a plain row, so the
    // tag cannot be what decides this.
    expect(shouldSuppressContextMenu(el("input", { type: "range" }))).toBe(true);
    expect(shouldSuppressContextMenu(el("input", { type: "button" }))).toBe(true);
    expect(shouldSuppressContextMenu(el("input", { type: "checkbox" }))).toBe(true);
  });

  it("treats a missing type attribute as text", () => {
    // The search boxes write no type, and an empty result here would have put
    // a wall of dead controls in the dropdowns.
    expect(shouldSuppressContextMenu(el("input", { type: null }))).toBe(false);
    expect(shouldSuppressContextMenu(el("input", { type: "" }))).toBe(false);
    expect(shouldSuppressContextMenu(el("input", {}))).toBe(false);
  });

  it("keeps it on a contenteditable element whatever its tag", () => {
    // The app has no such region yet; this is the guard for one added later.
    expect(shouldSuppressContextMenu(el("div", { isContentEditable: true }))).toBe(
      false,
    );
    expect(shouldSuppressContextMenu(el("span", { isContentEditable: true }))).toBe(
      false,
    );
  });

  it("does not depend on the DOM's uppercase tag names", () => {
    // `tagName` is uppercase for HTML elements, so a lowercase comparison that
    // missed this would suppress the menu on every text field.
    expect(shouldSuppressContextMenu(el("TEXTAREA"))).toBe(false);
    expect(shouldSuppressContextMenu(el("INPUT", { type: "RANGE" }))).toBe(true);
    expect(shouldSuppressContextMenu(el("INPUT"))).toBe(false);
  });

  it("suppresses it on an element that claims no tag", () => {
    // Nothing typable was identified, so there is nothing to protect.
    expect(shouldSuppressContextMenu(el(""))).toBe(true);
  });
});
