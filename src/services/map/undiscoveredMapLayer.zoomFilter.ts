import type {
  MapLayerFeature,
  MapLayerPointFeature,
  MapLayerRouteFeature,
} from "../../contracts/surfaces/undiscovered-map-layer.contract.js";
import {
  clusterGridSizeForZoom,
  MAX_INDIVIDUAL_UNDISCOVERED_MARKERS_PER_VIEWPORT,
  MAX_ROUTE_ANCHORS_PER_VIEWPORT,
  MAX_ROUTE_LINES_PER_VIEWPORT,
  MIN_ZOOM_SHOW_INDIVIDUAL_POIS,
  minZoomForPoi,
  minZoomForRouteAnchor,
  readConfidence,
  readShowAtZoom,
  routePreviewPointCapForZoom,
  isUndiscoveredMarkerZoomGatingEnabled,
  shouldShowRouteLinesAtZoom,
} from "../../lib/map/undiscoveredMapVisibility.js";

export type MapLayerClusterFeature = {
  featureKind: "cluster";
  id: string;
  layerKind: "undiscovered";
  latitude: number;
  longitude: number;
  count: number;
  pointCount: number;
  routeCount: number;
};

export type UndiscoveredZoomFilterResult = {
  features: Array<MapLayerFeature | MapLayerClusterFeature>;
  counts: {
    clustersCount: number;
    individualPoiCount: number;
    routeAnchorCount: number;
    routeLineCount: number;
    hiddenDueToZoomCount: number;
    hiddenDueToDensityCount: number;
    lowConfidenceRouteCount: number;
    mergedRouteFragmentCount: number;
  };
};

function featureConfidence(data: Record<string, unknown> | undefined): "high" | "medium" | "low" {
  return readConfidence(data ?? {});
}

function priorityScore(confidence: "high" | "medium" | "low", locavaScore: number): number {
  const confBoost = confidence === "high" ? 30 : confidence === "medium" ? 10 : 0;
  return confBoost + (Number.isFinite(locavaScore) ? locavaScore : 0);
}

function downsamplePreview(
  coords: Array<{ latitude: number; longitude: number }>,
  maxPoints: number,
): Array<{ latitude: number; longitude: number }> {
  if (coords.length <= maxPoints) return coords;
  const step = Math.ceil(coords.length / maxPoints);
  const out: Array<{ latitude: number; longitude: number }> = [];
  for (let i = 0; i < coords.length; i += step) out.push(coords[i]!);
  const last = coords[coords.length - 1]!;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function stripRouteGeometry(feature: MapLayerRouteFeature): MapLayerRouteFeature {
  return {
    ...feature,
    routeSummary: {
      ...feature.routeSummary,
      routePreviewCoordinates: [],
      encodedPolyline: undefined,
      simplifiedLevel: "low",
    },
  };
}

function routeGeometryForZoom(feature: MapLayerRouteFeature, zoom: number): MapLayerRouteFeature {
  const cap = routePreviewPointCapForZoom(zoom);
  if (cap <= 0) return stripRouteGeometry(feature);
  const preview = feature.routeSummary.routePreviewCoordinates;
  if (preview.length <= cap) return feature;
  return {
    ...feature,
    routeSummary: {
      ...feature.routeSummary,
      routePreviewCoordinates: downsamplePreview(preview, cap),
      simplifiedLevel: zoom >= 16 ? "full" : "medium",
    },
  };
}

function buildClusters(
  items: Array<MapLayerPointFeature | MapLayerRouteFeature>,
  zoom: number,
): MapLayerClusterFeature[] {
  const cell = clusterGridSizeForZoom(zoom);
  const buckets = new Map<
    string,
    { lat: number; lng: number; n: number; points: number; routes: number }
  >();

  for (const f of items) {
    const lat = f.featureKind === "point" ? f.latitude : (f.centroid?.latitude ?? 0);
    const lng = f.featureKind === "point" ? f.longitude : (f.centroid?.longitude ?? 0);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const key = `${Math.floor(lat / cell)}:${Math.floor(lng / cell)}`;
    const cur = buckets.get(key);
    if (!cur) {
      buckets.set(key, {
        lat,
        lng,
        n: 1,
        points: f.featureKind === "point" ? 1 : 0,
        routes: f.featureKind === "route" ? 1 : 0,
      });
      continue;
    }
    cur.n += 1;
    cur.lat += lat;
    cur.lng += lng;
    if (f.featureKind === "point") cur.points += 1;
    else cur.routes += 1;
  }

  return [...buckets.entries()].map(([key, b]) => ({
    featureKind: "cluster" as const,
    id: `cluster:${zoom}:${key}`,
    layerKind: "undiscovered" as const,
    latitude: b.lat / b.n,
    longitude: b.lng / b.n,
    count: b.n,
    pointCount: b.points,
    routeCount: b.routes,
  }));
}

function passthroughUndiscoveredZoomFilter(input: {
  features: MapLayerFeature[];
  mergedRouteFragmentCount?: number;
}): UndiscoveredZoomFilterResult {
  const points = input.features.filter((f) => f.featureKind === "point");
  const routes = input.features.filter((f) => f.featureKind === "route");
  const routeFeaturesOut = routes.map((f) =>
    f.routeSummary.routePreviewCoordinates.length >= 2
      ? f
      : stripRouteGeometry(f),
  );
  return {
    features: [...points, ...routeFeaturesOut],
    counts: {
      clustersCount: 0,
      individualPoiCount: points.length,
      routeAnchorCount: routes.length,
      routeLineCount: routeFeaturesOut.filter(
        (f) => f.routeSummary.routePreviewCoordinates.length >= 2,
      ).length,
      hiddenDueToZoomCount: 0,
      hiddenDueToDensityCount: 0,
      lowConfidenceRouteCount: routes.filter((f) => f.routeConfidence === "low").length,
      mergedRouteFragmentCount: input.mergedRouteFragmentCount ?? 0,
    },
  };
}

export function applyUndiscoveredZoomFilter(input: {
  features: MapLayerFeature[];
  zoom: number;
  sourceDocs?: Map<string, Record<string, unknown>>;
  mergedRouteFragmentCount?: number;
}): UndiscoveredZoomFilterResult {
  if (!isUndiscoveredMarkerZoomGatingEnabled()) {
    return passthroughUndiscoveredZoomFilter(input);
  }

  const zoom = Math.max(1, Math.min(20, Math.round(input.zoom)));
  let hiddenDueToZoomCount = 0;
  let lowConfidenceRouteCount = 0;

  const hiddenByZoom: Array<MapLayerPointFeature | MapLayerRouteFeature> = [];
  const poiCandidates: Array<{ feature: MapLayerPointFeature; score: number }> = [];
  const routeCandidates: Array<{
    feature: MapLayerRouteFeature;
    score: number;
    confidence: "high" | "medium" | "low";
  }> = [];

  for (const feature of input.features) {
    if (feature.featureKind === "cluster") continue;
    const doc = input.sourceDocs?.get(feature.id);
    const confidence = featureConfidence(doc);
    const showAt = readShowAtZoom(doc ?? {}, confidence);
    const locavaScore = Number(doc?.locavaScore ?? 0);

    if (feature.featureKind === "point") {
      const minZoom = minZoomForPoi(confidence, showAt);
      if (zoom < minZoom) {
        hiddenByZoom.push(feature);
        hiddenDueToZoomCount += 1;
        continue;
      }
      poiCandidates.push({ feature, score: priorityScore(confidence, locavaScore) });
      continue;
    }

    if (confidence === "low") lowConfidenceRouteCount += 1;
    const minZoom = minZoomForRouteAnchor(confidence, showAt);
    if (zoom < minZoom) {
      hiddenByZoom.push(feature);
      hiddenDueToZoomCount += 1;
      continue;
    }
    routeCandidates.push({ feature, score: priorityScore(confidence, locavaScore), confidence });
  }

  // Very low zoom: clusters only (no emoji flood).
  if (zoom < MIN_ZOOM_SHOW_INDIVIDUAL_POIS) {
    const clusterSource = [
      ...hiddenByZoom,
      ...poiCandidates.map((p) => p.feature),
      ...routeCandidates.map((r) => r.feature),
    ];
    const clusters = buildClusters(clusterSource, zoom);
    return {
      features: clusters,
      counts: {
        clustersCount: clusters.length,
        individualPoiCount: 0,
        routeAnchorCount: 0,
        routeLineCount: 0,
        hiddenDueToZoomCount: clusterSource.length,
        hiddenDueToDensityCount: 0,
        lowConfidenceRouteCount,
        mergedRouteFragmentCount: input.mergedRouteFragmentCount ?? 0,
      },
    };
  }

  poiCandidates.sort((a, b) => b.score - a.score);
  routeCandidates.sort((a, b) => b.score - a.score);

  const poiKept = poiCandidates.slice(0, MAX_INDIVIDUAL_UNDISCOVERED_MARKERS_PER_VIEWPORT);
  const routesKept = routeCandidates.slice(0, MAX_ROUTE_ANCHORS_PER_VIEWPORT);
  const hiddenDueToDensityCount =
    poiCandidates.length - poiKept.length + (routeCandidates.length - routesKept.length);

  const clusterSource = [
    ...hiddenByZoom,
    ...poiCandidates.slice(MAX_INDIVIDUAL_UNDISCOVERED_MARKERS_PER_VIEWPORT).map((p) => p.feature),
    ...routeCandidates.slice(MAX_ROUTE_ANCHORS_PER_VIEWPORT).map((r) => r.feature),
  ];
  const clusters = clusterSource.length > 0 ? buildClusters(clusterSource, zoom) : [];

  const routeFeaturesOut: MapLayerRouteFeature[] = [];
  const lineCap = MAX_ROUTE_LINES_PER_VIEWPORT;
  for (let i = 0; i < routesKept.length; i++) {
    const { feature, confidence } = routesKept[i]!;
    const includeLine =
      i < lineCap && shouldShowRouteLinesAtZoom(zoom, confidence);
    routeFeaturesOut.push(
      includeLine ? routeGeometryForZoom(feature, zoom) : stripRouteGeometry(feature),
    );
  }

  const features: Array<MapLayerFeature | MapLayerClusterFeature> = [
    ...clusters,
    ...poiKept.map((p) => p.feature),
    ...routeFeaturesOut,
  ];

  return {
    features,
    counts: {
      clustersCount: clusters.length,
      individualPoiCount: poiKept.length,
      routeAnchorCount: routesKept.length,
      routeLineCount: routeFeaturesOut.filter(
        (f) => f.routeSummary.routePreviewCoordinates.length >= 2,
      ).length,
      hiddenDueToZoomCount,
      hiddenDueToDensityCount,
      lowConfidenceRouteCount,
      mergedRouteFragmentCount: input.mergedRouteFragmentCount ?? 0,
    },
  };
}
