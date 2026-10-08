
import {
  buildIndex,
  cachedCount,
  type IndexProgress,
  type StampMap,
  type VaultIndex,
} from "./vaultIndex";
import { api } from "../../ipc";
import type { GalleryEntry } from "@shared/types";

export interface AutoIndexRequest {
  added: number;
  building: boolean;
  entries: GalleryEntry[];
  stamps: StampMap;
  index: VaultIndex;
}

export function autoIndexEnabled(cfg: { indexAfterImport?: boolean } | undefined): boolean {
  return cfg?.indexAfterImport !== false;
}

export function shouldAutoIndex(req: AutoIndexRequest): boolean {
  if (req.added <= 0) return false;
  if (req.building) return false;
  return cachedCount(req.entries, req.index, req.stamps) < probeableCount(req.entries);
}

function probeableCount(entries: GalleryEntry[]): number {
  let n = 0;
  for (const e of entries) if (e.kind === "video" || e.kind === "image") n += 1;
  return n;
}

export interface AutoIndexResult {
  index: VaultIndex;
  stamps: StampMap;
}

export async function buildAfterImport(
  req: Omit<AutoIndexRequest, "stamps">,
  hooks: {
    onProgress?: (p: IndexProgress) => void;
    onStart?: () => void;
  } = {},
): Promise<AutoIndexResult | null> {
  const stamps = await api.vaultStamps();
  if (!shouldAutoIndex({ ...req, stamps })) return null;
  hooks.onStart?.();
  return { index: await buildIndex(req.entries, stamps, hooks.onProgress), stamps };
}