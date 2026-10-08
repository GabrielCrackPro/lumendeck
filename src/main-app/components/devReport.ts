
export type ReportFact = readonly [string, string];

export function buildReport(
  header: string,
  facts: readonly ReportFact[],
  lastPanic: string | null,
): string {
  const lines: string[] = [];
  if (header.trim()) lines.push(header.trim());
  for (const [label, value] of facts) {
    if (!label || !value) continue;
    lines.push(`${label}: ${value}`);
  }
  if (lastPanic) lines.push(lastPanic);
  return lines.join("\n");
}
