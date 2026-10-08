
function expandShorthand(digits: string): string {
  return digits
    .split("")
    .map((c) => c + c)
    .join("");
}

export function parseHex(text: string): [number, number, number] | null {
  const body = text.trim().replace(/^#/, "");
  let digits = body;
  if (digits.length === 3) {
    digits = expandShorthand(digits);
  } else if (digits.length === 4) {
    digits = expandShorthand(digits).slice(0, 6);
  } else if (digits.length === 8) {
    digits = digits.slice(0, 6);
  }
  if (!/^[0-9a-fA-F]{6}$/.test(digits)) return null;
  return [
    parseInt(digits.slice(0, 2), 16),
    parseInt(digits.slice(2, 4), 16),
    parseInt(digits.slice(4, 6), 16),
  ];
}

export function isParsableHex(text: string): boolean {
  return parseHex(text) !== null;
}

export function formatHex(rgb: [number, number, number]): string {
  const joined = rgb
    .map((c) => Math.round(c).toString(16).padStart(2, "0"))
    .join("");
  return `#${joined.toUpperCase()}`;
}

export function tidyHexDraft(text: string): string {
  return text.trim().replace(/^#/, "").toUpperCase();
}