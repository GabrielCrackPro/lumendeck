
import { DEFAULT_GLOW } from "./tokens";

export type ThemeName = "light" | "dark";

export interface ThemeBlock {
  selector: string;
  colorScheme?: ThemeName;
  tokens: Record<string, string>;
}

export const THEME_BLOCKS: readonly ThemeBlock[] = [
  {
    selector: ":root",
    colorScheme: "light",
    tokens: {
      glow: DEFAULT_GLOW.join(" "),
      "on-accent": "#06121f",
      bg: "#e9e7e0",
      panel: "rgba(255, 255, 254, 0.78)",
      "panel-strong": "rgba(255, 255, 255, 0.96)",
      "panel-sunken": "rgba(12, 14, 18, 0.05)",
      line: "rgba(28, 27, 24, 0.12)",
      "line-strong": "rgba(28, 27, 24, 0.24)",
      text: "#17150f",
      "text-dim": "#4d4a41",
      "text-faint": "#847f72",
      "accent-lift": "#110f0a",
      shadow:
        "0 0 0 1px rgba(28, 27, 24, 0.05), 0 2px 6px rgba(28, 27, 24, 0.06), 0 20px 48px -32px rgba(28, 27, 24, 0.4)",
    },
  },
  {
    selector: ".dark",
    colorScheme: "dark",
    tokens: {
      bg: "#101214",
      panel: "rgba(255, 255, 255, 0.026)",
      "panel-strong": "rgba(255, 255, 255, 0.055)",
      "panel-sunken": "rgba(0, 0, 0, 0.35)",
      line: "rgba(255, 255, 255, 0.075)",
      "line-strong": "rgba(255, 255, 255, 0.17)",
      text: "#ecedef",
      "text-dim": "#a5a8ae",
      "text-faint": "#66696f",
      "accent-lift": "#ffffff",
      shadow:
        "0 0 0 1px rgba(0, 0, 0, 0.5), 0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 24px 60px -34px rgba(0, 0, 0, 0.9)",
    },
  },
  {
    selector: ".dark.amoled",
    tokens: {
      bg: "#000000",
      panel: "rgba(255, 255, 255, 0.02)",
      "panel-strong": "rgba(255, 255, 255, 0.04)",
      "panel-sunken": "rgba(0, 0, 0, 0.6)",
      line: "rgba(255, 255, 255, 0.09)",
      "line-strong": "rgba(255, 255, 255, 0.2)",
      shadow:
        "0 0 0 1px rgba(0, 0, 0, 0.8), 0 24px 60px -34px rgba(0, 0, 0, 1)",
    },
  },
];

export const CODE_ONLY_TOKENS: ReadonlySet<string> = new Set(["accent-lift"]);

export function themeSelector(theme: ThemeName): string {
  return theme === "light" ? ":root" : ".dark";
}

function blockFor(selector: string): ThemeBlock {
  const found = THEME_BLOCKS.find((b) => b.selector === selector);
  if (!found) throw new Error(`no theme block for ${selector}`);
  return found;
}

export function themeToken(
  theme: ThemeName,
  amoled: boolean,
  token: string,
): string {
  const selectors =
    theme === "light"
      ? [":root"]
      : amoled
        ? [".dark.amoled", ".dark", ":root"]
        : [".dark", ":root"];
  for (const selector of selectors) {
    const value = blockFor(selector).tokens[token];
    if (value !== undefined) return value;
  }
  const declared = Object.keys(blockFor(":root").tokens)
    .map((n) => `--${n}`)
    .join(", ");
  throw new Error(
    `no theme declares --${token}; the palette has: ${declared}`,
  );
}
