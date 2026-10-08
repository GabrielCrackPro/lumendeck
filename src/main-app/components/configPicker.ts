
export function canDeleteProfile(count: number): boolean {
  return count > 1;
}

export function configPendingKey(id: string): string {
  return `scene-${id}`;
}

export function applyingConfigKey(pending: Iterable<string>): string | null {
  for (const key of pending) {
    if (key === "scene-save") continue;
    if (key.startsWith("scene-")) return key.slice("scene-".length);
  }
  return null;
}

export function configName(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function wallpaperSourceLabel(source: string): string {
  const clean = source.split(/[?#]/)[0] ?? source;
  if (/^https?:\/\//i.test(clean)) {
    try {
      const host = new URL(clean).hostname;
      if (host) return host;
    } catch {
      // Not a URL the parser accepts — fall through and show its last segment.
    }
  }
  const segment = clean.split(/[\\/]/).filter(Boolean).pop();
  return segment || clean;
}

export function isDuplicateConfigName(
  raw: string,
  existing: readonly string[],
): boolean {
  const candidate = raw.trim().toLocaleLowerCase();
  if (candidate.length === 0) return false;
  return existing.some((name) => name.trim().toLocaleLowerCase() === candidate);
}
