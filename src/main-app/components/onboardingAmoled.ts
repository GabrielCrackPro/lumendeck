// Whether first-run setup should switch AMOLED on for the theme it just picked.
//
// Extracted for the same reason onboardingDetect.ts is: vitest runs in node with
// no DOM, so the judgement has to live somewhere testable rather than inside an
// effect nobody can exercise. The effect that applies it is one call.
import type { ResolvedTheme } from "../theme";

/**
 * The value to write to `general.amoled`, or null to leave it alone.
 *
 * Null is the important return. Someone who turned AMOLED off in dark theme
 * did that on purpose, and a rule that re-asserts itself whenever the theme is
 * re-resolved would undo it in front of them — with no visible cause, since the
 * write happens in an effect they never touched. So the caller's `touched`
 * flag is not advisory: it is what makes the rule stop.
 *
 * Light theme writes `false` rather than null. True black is the point of an
 * OLED panel; on a lit background it renders as an ordinary light theme and
 * the "dark theme" part of the toggle's own description stops being true.
 */
export function amoledDefault(
  resolved: ResolvedTheme,
  touched: boolean,
): boolean | null {
  return touched ? null : resolved === "dark";
}