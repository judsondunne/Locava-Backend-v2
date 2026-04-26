const MAX_EXCLUDE = 40;

export function parseExcludeUserIds(raw: string | undefined | null): string[] {
  if (!raw || !raw.trim()) return [];
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return [...new Set(parts)].slice(0, MAX_EXCLUDE);
}

export function excludeKey(ids: string[]): string {
  if (ids.length === 0) return "none";
  return [...ids].sort().join("|");
}
