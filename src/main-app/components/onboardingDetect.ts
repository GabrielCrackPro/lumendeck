
export type FactId = "displays" | "lighting" | "vault" | "audio";

export interface DetectInputs {
  monitorCount: number;
  primaryWidth: number | null;
  primaryHeight: number | null;
  rgbConnected: boolean;
  rgbDeviceCount: number;
  vaultCount: number;
  audioAvailable: boolean;
}

export interface DetectedFact {
  id: FactId;
  ok: boolean;
  count: number;
}

const FACT_ORDER: FactId[] = ["displays", "lighting", "vault", "audio"];

export function detectSetup(i: DetectInputs): DetectedFact[] {
  const found: Record<FactId, DetectedFact> = {
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

export function setupIsComplete(facts: DetectedFact[]): boolean {
  return facts.length > 0 && facts.every((f) => f.ok);
}

export function foundCount(facts: DetectedFact[]): number {
  return facts.filter((f) => f.ok).length;
}

export function resolutionLabel(
  width: number | null,
  height: number | null,
): string {
  if (width === null || height === null) return "";
  if (width <= 0 || height <= 0) return "";
  return `${width}x${height}`;
}