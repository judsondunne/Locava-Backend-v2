import { createHash } from "node:crypto";

function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

export function buildInventorySpotSourceKey(input: {
  source: string;
  sourceType?: string;
  sourceId: string;
}): string {
  return `${input.source}:${input.sourceType ?? "unknown"}:${input.sourceId}`;
}

export function buildInventoryRouteSourceKey(input: {
  source: string;
  sourceType?: string;
  sourceId: string;
}): string {
  return `${input.source}:${input.sourceType ?? "unknown"}:${input.sourceId}`;
}

export function buildInventorySpotId(input: {
  source: string;
  sourceType?: string;
  sourceId: string;
  normalizedName: string;
  lat: number;
  lng: number;
}): string {
  const material = [
    input.source,
    input.sourceType ?? "",
    input.sourceId,
    input.normalizedName,
    input.lat.toFixed(5),
    input.lng.toFixed(5),
  ].join("|");
  return `inv_spot_${shortHash(material)}`;
}

export function buildInventoryRouteId(input: {
  source: string;
  sourceType?: string;
  sourceId: string;
  normalizedName: string;
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number };
}): string {
  const material = [
    input.source,
    input.sourceType ?? "",
    input.sourceId,
    input.normalizedName,
    input.bbox.minLat.toFixed(5),
    input.bbox.minLng.toFixed(5),
    input.bbox.maxLat.toFixed(5),
    input.bbox.maxLng.toFixed(5),
  ].join("|");
  return `inv_route_${shortHash(material)}`;
}

export function buildInventoryImportRunId(): string {
  const ts = Date.now().toString(36);
  const rand = createHash("sha256").update(`${Date.now()}:${Math.random()}`).digest("hex").slice(0, 8);
  return `inv_run_${ts}_${rand}`;
}

export function buildInventoryTileVersion(runId: string, generatedAt: string): string {
  return shortHash(`${runId}:${generatedAt}`);
}
