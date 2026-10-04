// Killing the webview's own right-click menu.
//
// Every window here is a webview, and WebView2 ships a browser context menu
// that appears on right-click: Back, Forward, Reload, Inspect, View source. It
// is chrome from a surface that has none of the browser's behaviour behind it,
// so it offered Inspect on a window that cannot navigate and Reload on a
// wallpaper. Nothing in the app has a context menu to fall back on, so the
// whole surface is dead weight -- and worse than dead weight, because a menu
// that appears over the UI implies the UI missed a right-click handler it does
// not have.
//
// The one place it is not dead weight is a field the user is typing into. The
// app has search boxes, a rename field and URL inputs with no in-app way to
// paste, so the native menu is the only route to paste and to spellcheck
// there. `shouldSuppressContextMenu` is the decision, separated from the
// listener so it can be tested without a DOM.

/**
 * Input types that hold no caret and no selection.
 *
 * Everything else keeps the menu, including `number` and `time`, which a user
 * can still paste into and select inside. The default therefore errs towards
 * leaving a capability in place: an input type nobody has thought about yet is
 * treated as typable until it is named here.
 */
export const CARETLESS_INPUT_TYPES: ReadonlySet<string> = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * The part of an element this decision reads.
 *
 * Structural rather than `Element` so the tests can pass plain objects; vitest
 * runs in a node environment with no DOM.
 */
export type ContextMenuTarget = {
  tagName: string;
  type?: string | null;
  isContentEditable?: boolean;
};

/** Whether the native menu should be suppressed for the element right-clicked. */
export function shouldSuppressContextMenu(
  target: ContextMenuTarget,
): boolean {
  // Checked before the tag: a contenteditable element is typable whatever it
  // is, and the app has no explicit contenteditable regions yet, so this is
  // the guard that keeps a rich text field added later from losing paste.
  if (target.isContentEditable) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "textarea") return false;
  if (tag === "input") {
    // A missing type attribute is text, which is the common case for the
    // search boxes, so it resolves through the same set rather than escaping it.
    return CARETLESS_INPUT_TYPES.has((target.type ?? "text").toLowerCase());
  }
  return true;
}

/**
 * Suppress the native menu for every right-click the app does not want.
 *
 * Registered on the document in the capture phase so it runs ahead of any
 * handler a component might add, and so a component stopping propagation
 * cannot hand the user back the WebView menu.
 */
export function installContextMenuSuppression(
  doc: Pick<Document, "addEventListener"> = document,
): void {
  doc.addEventListener(
    "contextmenu",
    (event) => {
      const target = event.target as unknown as ContextMenuTarget | null;
      if (target && shouldSuppressContextMenu(target)) event.preventDefault();
    },
    { capture: true },
  );
}
