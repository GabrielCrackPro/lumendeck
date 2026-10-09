import type { DiscoverSourceCfg } from "@shared/types";

export type DiscoverSourceId = "bing" | "wallhaven" | "pixabay" | "coverr";

export interface DiscoverSource {
  id: DiscoverSourceId;
  label: string;
  hint: string;
  searchable: boolean;
  needsKey?: boolean;
  video?: boolean;
  keyUrl?: string;
}

export const DISCOVER_SOURCES: DiscoverSource[] = [
  {
    id: "bing",
    label: "gallery.bing-daily",
    hint: "gallery.discover-hint-bing",
    searchable: false,
  },
  {
    id: "wallhaven",
    label: "gallery.wallhaven",
    hint: "gallery.discover-hint-wallhaven",
    searchable: true,
  },
  {
    id: "pixabay",
    label: "gallery.pixabay",
    hint: "gallery.discover-hint-pixabay",
    searchable: true,
    needsKey: true,
    video: true,
    keyUrl: "https://pixabay.com/api/docs/",
  },
  {
    id: "coverr",
    label: "gallery.coverr",
    hint: "gallery.discover-hint-coverr",
    searchable: true,
    video: true,
  },
];

export function sourceById(id: string): DiscoverSource {
  return DISCOVER_SOURCES.find((s) => s.id === id) ?? DISCOVER_SOURCES[0]!;
}

export function activeSources(
  configured: DiscoverSourceCfg[] | undefined,
): DiscoverSource[] {
  const entries = configured ?? [];
  const byId = new Map(DISCOVER_SOURCES.map((s) => [s.id as string, s]));
  const seen = new Set<string>();
  const active: DiscoverSource[] = [];
  for (const cfg of entries) {
    const src = byId.get(cfg.id);
    if (!src || seen.has(src.id)) continue;
    seen.add(src.id);
    if (cfg.enabled) active.push(src);
  }
  for (const src of DISCOVER_SOURCES) {
    if (!seen.has(src.id)) active.push(src);
  }
  return active;
}

export function sourceConfig(
  configured: DiscoverSourceCfg[] | undefined,
  id: string,
): DiscoverSourceCfg | undefined {
  return configured?.find((c) => c.id === id);
}

export function missingApiKey(
  source: DiscoverSource,
  cfg: DiscoverSourceCfg | undefined,
): boolean {
  return Boolean(source.needsKey) && !(cfg?.apiKey ?? "").trim();
}

export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0)
    return "";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  return `${m}:${String(total % 60).padStart(2, "0")}`;
}

export function canLoadMore(lastPage: number | null, page: number): boolean {
  if (lastPage === null || !Number.isFinite(lastPage)) return false;
  return page < lastPage;
}

export function thumbKey(thumbUrl: string): string {
  return thumbUrl;
}
