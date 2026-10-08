
export const STAGGER_STEP_MS = 16;

export const STAGGER_CAP = 10;

export function staggerDelay(
  index: number,
  step: number = STAGGER_STEP_MS,
  cap: number = STAGGER_CAP,
): number {
  const safeStep = Number.isFinite(step) && step > 0 ? step : STAGGER_STEP_MS;
  const safeCap = Number.isFinite(cap) && cap >= 0 ? Math.floor(cap) : STAGGER_CAP;
  const i = Math.min(Math.max(Math.floor(index) || 0, 0), safeCap);
  return i * safeStep;
}
