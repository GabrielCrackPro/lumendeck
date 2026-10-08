import { useEffect, useState } from "react";
import type { ThemeMode } from "@shared/types";

export type ResolvedTheme = "light" | "dark";

export function resolveTheme(
  pref: ThemeMode | undefined,
  prefersLight: boolean,
): ResolvedTheme {
  if (pref === "light") return "light";
  if (pref === "dark") return "dark";
  return prefersLight ? "light" : "dark";
}

export function osPrefersLight(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  );
}

export function useEffectiveTheme(pref: ThemeMode | undefined): ResolvedTheme {
  const [prefersLight, setPrefersLight] = useState(osPrefersLight);

  useEffect(() => {
    if (
      pref !== "system" ||
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => setPrefersLight(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [pref]);

  return resolveTheme(pref, prefersLight);
}
