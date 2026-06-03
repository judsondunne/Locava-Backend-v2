const WARN_BYTES = 800 * 1024;
const MAX_BYTES = 1024 * 1024;

export type DocSizeAssessment = {
  estimatedBytes: number;
  action: "allow" | "trim" | "offload";
  trimmedFields: string[];
};

export function estimateFirestoreDocSize(doc: unknown): number {
  return Buffer.byteLength(JSON.stringify(doc), "utf8");
}

export function assessFirestoreDocSize(doc: Record<string, unknown>): DocSizeAssessment {
  const estimatedBytes = estimateFirestoreDocSize(doc);
  if (estimatedBytes <= WARN_BYTES) {
    return { estimatedBytes, action: "allow", trimmedFields: [] };
  }
  if (estimatedBytes <= MAX_BYTES) {
    return { estimatedBytes, action: "trim", trimmedFields: [] };
  }
  return { estimatedBytes, action: "offload", trimmedFields: [] };
}

const TRIMMABLE_FIELDS = [
  "rawProperties",
  "sourceTags",
  "existingMediaRefs",
  "activityReasons",
  "coordinatesPreview",
  "parkingCandidatesSummary",
  "trailheadCandidatesSummary",
] as const;

export function trimDocForFirestore<T extends Record<string, unknown>>(doc: T): {
  doc: T;
  trimmedFields: string[];
} {
  const assessment = assessFirestoreDocSize(doc);
  if (assessment.action === "allow") {
    return { doc, trimmedFields: [] };
  }

  const trimmed: Record<string, unknown> = { ...doc };
  const trimmedFields: string[] = [];

  for (const field of TRIMMABLE_FIELDS) {
    if (field in trimmed) {
      delete trimmed[field];
      trimmedFields.push(field);
    }
  }

  const reassessed = assessFirestoreDocSize(trimmed);
  if (reassessed.action === "offload") {
    if ("encodedPolyline" in trimmed && typeof trimmed.encodedPolyline === "string") {
      trimmed.encodedPolyline = trimmed.encodedPolyline.slice(0, 2000);
      trimmedFields.push("encodedPolyline_truncated");
    }
    if ("coordinatesPreview" in trimmed) {
      delete trimmed.coordinatesPreview;
      trimmedFields.push("coordinatesPreview");
    }
  }

  return { doc: trimmed as T, trimmedFields };
}

export function splitLargeGeometry(input: {
  coordinates?: Array<{ lat: number; lng: number }>;
  maxPointsPerChunk?: number;
}): Array<Array<{ lat: number; lng: number }>> {
  const coords = input.coordinates ?? [];
  const max = input.maxPointsPerChunk ?? 500;
  if (coords.length <= max) return [coords];
  const chunks: Array<Array<{ lat: number; lng: number }>> = [];
  for (let i = 0; i < coords.length; i += max) {
    chunks.push(coords.slice(i, i + max));
  }
  return chunks;
}
