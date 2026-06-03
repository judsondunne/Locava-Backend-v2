import type { LocavaInventoryRoute } from "../inventoryLocavaTypes.js";
import { normalizeLocavaName } from "../inventoryLocavaClassifier.js";
import {
  bboxOfTrailPoints,
  distanceLabel,
  distanceMetersForCoords,
  distanceMilesFromMeters,
  flattenSegmentsDistance,
  stitchSegments,
  type TrailPoint,
} from "../trails/inventoryTrailGraph.js";
import type { VtransRoadFeature, VtransRoadProperties } from "./sources/vtransPublicHighwaySystemSource.js";
import { geoJsonCoordsToTrailPoints } from "./sources/vtransPublicHighwaySystemSource.js";

function cleanStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

export function vtransRoadMergeKeyFromProps(props: VtransRoadProperties): string | null {
  const aotclass = props.AOTCLASS;
  if (aotclass !== 4 && aotclass !== 7) return null;
  const town = cleanStr(props.TWN_LR).toLowerCase();
  const rtn = cleanStr(props.RTNUMBER);
  const rdfl = cleanStr(props.RDFLNAME);
  const primary = cleanStr(props.PRIMARYNAME);
  const rtname = cleanStr(props.RTNAME);

  let nameKey = "";
  if (rdfl.length > 2) {
    nameKey = normalizeLocavaName(rdfl) ?? rdfl.toLowerCase();
  } else if (rtn) {
    nameKey = `town_hwy_${rtn.toLowerCase()}`;
  } else if (primary.length > 2) {
    nameKey = normalizeLocavaName(primary) ?? primary.toLowerCase();
  } else if (rtname.length > 2) {
    nameKey = normalizeLocavaName(rtname) ?? rtname.toLowerCase();
  } else {
    return null;
  }

  return `${aotclass}|${town}|${nameKey}`;
}

export function vtransRoadMergeKeyFromRoute(route: LocavaInventoryRoute): string | null {
  const aot = route.tags.AOTCLASS;
  if (aot !== "4" && aot !== "7") return null;
  return vtransRoadMergeKeyFromProps({
    AOTCLASS: Number(aot),
    TWN_LR: route.tags.TWN_LR,
    RTNUMBER: route.tags.RTNUMBER,
    RDFLNAME: route.tags.RDFLNAME,
    PRIMARYNAME: route.tags.PRIMARYNAME,
    RTNAME: route.tags.RTNAME,
  });
}

/** Merge VTrans ArcGIS features that belong to the same logical town highway / legal trail. */
export function mergeVtransRoadFeaturesByIdentity(features: VtransRoadFeature[]): VtransRoadFeature[] {
  const groups = new Map<string, VtransRoadFeature[]>();

  for (const feature of features) {
    const key = vtransRoadMergeKeyFromProps(feature.properties ?? {});
    if (!key) {
      groups.set(`__singleton__:${feature.properties?.OBJECTID ?? groups.size}`, [feature]);
      continue;
    }
    const list = groups.get(key) ?? [];
    list.push(feature);
    groups.set(key, list);
  }

  const merged: VtransRoadFeature[] = [];
  for (const [, group] of groups) {
    if (group.length === 1) {
      merged.push(group[0]!);
      continue;
    }
    merged.push(mergeVtransFeatureGroup(group));
  }
  return merged;
}

function mergeVtransFeatureGroup(group: VtransRoadFeature[]): VtransRoadFeature {
  const base = group[0]!;
  const segmentLines: TrailPoint[][] = [];
  const objectIds: number[] = [];

  for (const feature of group) {
    if (feature.properties?.OBJECTID != null) objectIds.push(Number(feature.properties.OBJECTID));
    if (!feature.geometry) continue;
    const { segments } = geoJsonCoordsToTrailPoints(feature.geometry);
    segmentLines.push(...segments.filter((s) => s.length >= 2));
  }

  const stitched = stitchSegments(segmentLines);
  const segments = stitched.stitched ? [stitched.coordinates] : stitched.segments.length > 0 ? stitched.segments : segmentLines;
  const flat = segments.flat();

  const geometry =
    segments.length === 1
      ? { type: "LineString" as const, coordinates: segments[0]!.map((p) => [p.lng, p.lat]) }
      : {
          type: "MultiLineString" as const,
          coordinates: segments.map((seg) => seg.map((p) => [p.lng, p.lat])),
        };

  return {
    type: "Feature",
    properties: {
      ...base.properties,
      OBJECTID: objectIds[0] ?? base.properties?.OBJECTID,
      _mergedObjectIds: objectIds.join(","),
      _mergedSegmentCount: String(group.length),
    },
    geometry,
  };
}

/** Merge normalized VTrans inventory routes (e.g. after statewide chunked fetch). */
export function mergeVtransInventoryRoutes(routes: LocavaInventoryRoute[]): LocavaInventoryRoute[] {
  const vtrans = routes.filter((r) => r.source === "vtrans_public_highway_system");
  const other = routes.filter((r) => r.source !== "vtrans_public_highway_system");
  if (vtrans.length <= 1) return routes;

  const groups = new Map<string, LocavaInventoryRoute[]>();
  const singletons: LocavaInventoryRoute[] = [];

  for (const route of vtrans) {
    const key = vtransRoadMergeKeyFromRoute(route);
    if (!key) {
      singletons.push(route);
      continue;
    }
    const list = groups.get(key) ?? [];
    list.push(route);
    groups.set(key, list);
  }

  const mergedVtrans: LocavaInventoryRoute[] = [...singletons];
  for (const [, group] of groups) {
    if (group.length === 1) {
      mergedVtrans.push(group[0]!);
      continue;
    }
    mergedVtrans.push(mergeVtransRouteGroup(group));
  }

  return [...mergedVtrans, ...other].sort((a, b) => b.distanceMeters - a.distanceMeters);
}

function mergeVtransRouteGroup(group: LocavaInventoryRoute[]): LocavaInventoryRoute {
  const base = group[0]!;
  const segmentLines: TrailPoint[][] = [];
  const sourceKeys: string[] = [];

  for (const route of group) {
    sourceKeys.push(...route.sourceKeys);
    if (route.segments?.length) segmentLines.push(...route.segments.filter((s) => s.length >= 2));
    else if (route.coordinates?.length) segmentLines.push(route.coordinates);
  }

  const stitched = stitchSegments(segmentLines);
  const segments =
    stitched.stitched && stitched.coordinates.length >= 2
      ? [stitched.coordinates]
      : segmentLines.length > 0
        ? segmentLines
        : [base.coordinates ?? []];
  const flat = segments.flat();
  const distanceMeters = stitched.stitched
    ? distanceMetersForCoords(flat)
    : flattenSegmentsDistance(segments);
  const distanceMiles = distanceMilesFromMeters(distanceMeters);
  const bbox = bboxOfTrailPoints(flat) ?? base.bbox;
  const center = { lat: (bbox.minLat + bbox.maxLat) / 2, lng: (bbox.minLng + bbox.maxLng) / 2 };

  return {
    ...base,
    sourceKey: base.sourceKey,
    sourceKeys: [...new Set(sourceKeys)],
    segments: segments.length > 1 ? segments : undefined,
    coordinates: segments.length === 1 ? segments[0] : undefined,
    geometryType: segments.length > 1 ? "MultiLineString" : "LineString",
    bbox,
    center,
    distanceMeters,
    distanceMiles,
    distanceLabel: distanceLabel(distanceMiles),
    tags: {
      ...base.tags,
      _mergedFrom: sourceKeys.join(","),
      _mergedSegmentCount: String(group.length),
    },
    assemblyWarnings: [...new Set([...(base.assemblyWarnings ?? []), "vtrans_segments_merged"])],
  };
}
