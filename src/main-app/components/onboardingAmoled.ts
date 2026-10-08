import type { ResolvedTheme } from "../theme";

export function amoledDefault(
  resolved: ResolvedTheme,
  touched: boolean,
): boolean | null {
  return touched ? null : resolved === "dark";
}