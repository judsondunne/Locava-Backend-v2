const DESCRIPTION_PATHS = [
  "description",
  "caption",
  "text.description",
  "text.caption",
  "appPostV2.text.description",
  "appPostV2.text.caption",
] as const;

export type DescriptionFieldPath = (typeof DESCRIPTION_PATHS)[number];

export const POST_DESCRIPTION_FIELD_PATHS: readonly DescriptionFieldPath[] = DESCRIPTION_PATHS;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function readNestedString(doc: Record<string, unknown>, dotPath: string): string | undefined {
  const segments = dotPath.split(".");
  let cur: unknown = doc;
  for (const seg of segments) {
    const next = asRecord(cur);
    if (!next || !(seg in next)) return undefined;
    cur = next[seg];
  }
  return typeof cur === "string" ? cur : undefined;
}

/**
 * All description/caption paths that exist on the document with a string value (including empty).
 */
export function collectDescriptionFieldStrings(doc: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of DESCRIPTION_PATHS) {
    const v = readNestedString(doc, path);
    if (v !== undefined) {
      out[path] = v;
    }
  }
  return out;
}

/**
 * Paths with non-empty trimmed string values (used for classification / clearing).
 */
export function nonEmptyDescriptionPaths(doc: Record<string, unknown>): Record<string, string> {
  const all = collectDescriptionFieldStrings(doc);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) {
    if (v.trim().length > 0) out[k] = v.trim();
  }
  return out;
}
