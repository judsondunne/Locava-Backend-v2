import type { PbfRawEntity, PbfRawNode, PbfRawWay } from "./pbfElementAdapter.js";

export type PbfNodeCoord = { lat: number; lon: number };
export type PbfNodeCoordCache = Map<number, PbfNodeCoord>;

export function cachePbfNodeCoords(cache: PbfNodeCoordCache, entity: PbfRawNode): void {
  const id = Number(entity.id);
  const lat = entity.lat;
  const lon = entity.lon;
  if (!Number.isFinite(id) || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
  cache.set(id, { lat, lon });
}

export function resolveWayRefsToGeometry(
  refs: Array<number | string>,
  cache: PbfNodeCoordCache
): Array<{ lat: number; lon: number }> {
  const geometry: Array<{ lat: number; lon: number }> = [];
  for (const ref of refs) {
    const nodeId = Number(ref);
    if (!Number.isFinite(nodeId)) continue;
    const coord = cache.get(nodeId);
    if (!coord) continue;
    geometry.push({ lat: coord.lat, lon: coord.lon });
  }
  return geometry;
}

function wayNodeRefs(entity: PbfRawWay): Array<number | string> {
  if (Array.isArray(entity.refs) && entity.refs.length > 0) return entity.refs;
  const nodes = (entity as PbfRawWay & { nodes?: Array<number | string> }).nodes;
  return Array.isArray(nodes) ? nodes : [];
}

/** Attach resolved geometry to ways when the parser only emitted node refs. */
export function enrichPbfWayWithGeometry(entity: PbfRawWay, cache: PbfNodeCoordCache): PbfRawWay {
  if (Array.isArray(entity.geometry) && entity.geometry.length >= 2) return entity;
  const refs = wayNodeRefs(entity);
  if (refs.length < 2) return entity;
  const geometry = resolveWayRefsToGeometry(refs, cache);
  if (geometry.length < 2) return entity;
  return { ...entity, geometry };
}

export function enrichPbfEntityWithWayGeometry(
  entity: PbfRawEntity,
  cache: PbfNodeCoordCache
): PbfRawEntity | null {
  if (!entity?.type) return null;
  if (entity.type === "node") {
    cachePbfNodeCoords(cache, entity);
    return entity;
  }
  if (entity.type === "way") return enrichPbfWayWithGeometry(entity, cache);
  if (entity.type === "relation") return entity;
  return null;
}
