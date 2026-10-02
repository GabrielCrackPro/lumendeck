// What "Copy details" puts on the clipboard.
//
// Pulled out of the Developer card because the panel and the report are two
// different jobs: the panel is a grid of localized labels, the report is
// something a human pastes into an issue. They drift if one is derived from the
// other, and the thing that must not drift is the build identity — a report
// that names a version but not a commit cannot be acted on, because two builds
// of the same version are the same string.

/** One `label: value` row. */
export type ReportFact = readonly [string, string];

/**
 * Assemble the report body.
 *
 * The header comes from the backend and is written first, unconditionally. It
 * is the build identity, and it is here rather than in `facts` precisely so
 * that a row being dropped, reordered or relabelled cannot take the commit with
 * it. Everything after it is context for whoever reads the issue.
 */
export function buildReport(
  header: string,
  facts: readonly ReportFact[],
  lastPanic: string | null,
): string {
  const lines: string[] = [];
  if (header.trim()) lines.push(header.trim());
  for (const [label, value] of facts) {
    // A row with no value is a row the backend could not answer, and an empty
    // `Label: ` in a pasted report reads as a bug in the app rather than a gap
    // in the data. Skipped instead.
    if (!label || !value) continue;
    lines.push(`${label}: ${value}`);
  }
  if (lastPanic) lines.push(lastPanic);
  return lines.join("\n");
}
