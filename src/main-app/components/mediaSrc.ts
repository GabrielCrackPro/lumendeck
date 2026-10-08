
export function isServedUrl(ref: string): boolean {
  return /^https?:\/\//i.test(ref);
}

export function toMediaSrc(ref: string, convert: (path: string) => string): string {
  if (ref.length === 0) return ref;
  return isServedUrl(ref) ? ref : convert(ref);
}