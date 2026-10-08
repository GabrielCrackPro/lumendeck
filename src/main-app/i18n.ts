import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import en from "../../locales/en.json";
import es from "../../locales/es.json";
import { useStore } from "./store";

export type Locale = "en" | "es";

export const LOCALES: { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "es", label: "Español" },
];

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Español",
};

export const SUPPORTED: Locale[] = LOCALES.map((l) => l.id);

export function fromTag(tag: string | null | undefined): Locale {
  if (!tag) return "en";
  const norm = tag.toLowerCase();
  if ((SUPPORTED as string[]).includes(norm)) return norm as Locale;
  const primary = norm.split(/[-_]/)[0] ?? "";
  return (SUPPORTED as string[]).includes(primary)
    ? (primary as Locale)
    : "en";
}

export function resolveLocale(
  pref: string | null | undefined,
  systemTag: string | null | undefined,
): Locale {
  if (pref && pref !== "auto") {
    return (SUPPORTED as string[]).includes(pref) ? (pref as Locale) : "en";
  }
  return fromTag(systemTag);
}

void i18next.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function currentLocale(): Locale {
  const s = useStore.getState();
  return resolveLocale(s.cfg?.general.language, s.systemLanguage);
}

export function applyLocale(locale: Locale): void {
  if (i18next.language !== locale) void i18next.changeLanguage(locale);
}

export const t = i18next.t.bind(i18next) as (
  key: string,
  vars?: Record<string, string | number>,
) => string;

export function useLocale(): Locale {
  return useStore((s) => resolveLocale(s.cfg?.general.language, s.systemLanguage));
}
