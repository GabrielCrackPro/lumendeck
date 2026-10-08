
export function avatarInitial(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  const first = Array.from(trimmed)[0];
  return first ? first.toLocaleUpperCase() : "";
}
