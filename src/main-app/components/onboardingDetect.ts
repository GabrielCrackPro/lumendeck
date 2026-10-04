// What the detection-first onboarding found, and whether that counts as found.
//
// Extracted for the reason the rest of this directory is: vitest runs in node
// with no DOM, so the judgements have to live somewhere they can be tested.
// Each fact below drives a row in the wizard AND a line in the closing summary,
// so "is this found" is asked once here rather than twice in JSX that could
// disagree with itself.
//
// The reference flow this follows shows what it detected as editable rows
// instead of asking an open question, which only works if "detected" is a
// decision rather than a display of whatever a command happened to return.

/** The things the wizard can report on. Fixed set: the rows are a layout. */
export type FactId = "displays" | "lighting" | "vault" | "audio";

export interface DetectInputs {
  /** Monitors reported by `ipc::monitors`. */
  monitorCount: number;
  /** Primary monitor resolution, when one could be read. */
  primaryWidth: number | null;
  primaryHeight: number | null;
  /** The OpenRGB server answered. */
  rgbConnected: boolean;
  /** Lighting devices behind that server. */
  rgbDeviceCount: number;
  /** Items already in the vault. */
  vaultCount: number;
  /** A working audio output, which is what the reactive modes sample. */
  audioAvailable: boolean;
}

export interface DetectedFact {
  id: FactId;
  /**
   * Whether this counts as found.
   *
   * Distinct from "the value exists": a lighting server that answers with zero
   * devices is a worse result than one that never answered, because the user
   * has something to fix. Both read as not-found, and the copy for each says so.
   */
  ok: boolean;
  /** How many, for the rows that report a count. 0 when not applicable. */
  count: number;
}

const FACT_ORDER: FactId[] = ["displays", "lighting", "vault", "audio"];

/**
 * The facts, in the order the wizard shows them.
 *
 * Order is display order, so it lives here rather than being re-derived from
 * object keys at each call site.
 */
export function detectSetup(i: DetectInputs): DetectedFact[] {
  const found: Record<FactId, DetectedFact> = {
    // No monitor means no wallpaper window and no place to put stickers, so
    // this is the one fact the app genuinely cannot run without.
    displays: { id: "displays", ok: i.monitorCount > 0, count: i.monitorCount },
    lighting: {
      id: "lighting",
      ok: i.rgbConnected && i.rgbDeviceCount > 0,
      count: i.rgbDeviceCount,
    },
    vault: { id: "vault", ok: i.vaultCount > 0, count: i.vaultCount },
    audio: { id: "audio", ok: i.audioAvailable, count: 0 },
  };
  return FACT_ORDER.map((id) => found[id]);
}

/**
 * Whether the setup is complete enough to call itself configured.
 *
 * Every fact, not most of them. A wallpaper app with no display and no vault is
 * not "mostly set up", and the closing screen says so rather than congratulating
 * someone onto an empty desktop. Audio is included: the reactive lighting modes
 * are built on sampling it, so a machine without it has silently lost a feature.
 */
export function setupIsComplete(facts: DetectedFact[]): boolean {
  return facts.length > 0 && facts.every((f) => f.ok);
}

/**
 * How many facts came back found, for "3 of 4 detected" style copy.
 */
export function foundCount(facts: DetectedFact[]): number {
  return facts.filter((f) => f.ok).length;
}

/**
 * A display resolution as "1920x1080", or "" when it could not be read.
 *
 * Empty rather than a placeholder because the caller draws the two differently:
 * an unknown resolution is missing information, not a resolution of zero.
 *
 * Multi-monitor is not folded in here. The wizard reports the primary monitor's
 * size because it is the one the dashboard opens on, and the total monitor count
 * is reported separately — a summed bounding box would be a number nobody
 * recognises.
 */
export function resolutionLabel(
  width: number | null,
  height: number | null,
): string {
  if (width === null || height === null) return "";
  if (width <= 0 || height <= 0) return "";
  return `${width}x${height}`;
}