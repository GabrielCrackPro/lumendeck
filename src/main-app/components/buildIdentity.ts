
export function versionLabel(version: string): string {
  const trimmed = version.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

export function versionDisagreement(running: string, baked: string): boolean {
  const a = running.trim();
  const b = baked.trim();
  if (!a || !b) return false;
  return versionLabel(a) !== versionLabel(b);
}