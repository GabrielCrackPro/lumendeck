export function isInsideAnchoredPanel(
  target: Node,
  trigger: Element | null,
  panel: Element | null,
): boolean {
  return !!trigger?.contains(target) || !!panel?.contains(target);
}
