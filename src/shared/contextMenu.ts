
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

export type ContextMenuTarget = {
  tagName: string;
  type?: string | null;
  isContentEditable?: boolean;
};

export function shouldSuppressContextMenu(
  target: ContextMenuTarget,
): boolean {
  if (target.isContentEditable) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "textarea") return false;
  if (tag === "input") {
    return CARETLESS_INPUT_TYPES.has((target.type ?? "text").toLowerCase());
  }
  return true;
}

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
