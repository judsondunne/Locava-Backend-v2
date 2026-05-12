export function dedupeReasonStrings(reasons: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const reason of reasons) {
    if (seen.has(reason)) continue;
    seen.add(reason);
    deduped.push(reason);
  }
  return deduped;
}
