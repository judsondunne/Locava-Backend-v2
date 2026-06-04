import { FieldValue } from "firebase-admin/firestore";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { buildXpState } from "../surfaces/achievements-core.js";
import {
  buildCaptureDocId,
  scoreClaimCandidate,
  claimDistanceToMarker,
  maxRadiusForMarker,
  HARD_MAX_ROUTE_RADIUS_METERS,
  HARD_MAX_SPOT_RADIUS_METERS,
  buildExplicitClaimCandidate,
  countRouteGeometryPoints,
  inferClaimCandidateTarget,
  type ClaimMatchCandidate
} from "./postingClaimMatching.js";
import { resolvePostingClaimCandidate } from "./postingClaimCandidate.service.js";
import { fetchUnexploredMapMarkerById } from "../map/unexploredMapMarkers.service.js";
import {
  buildClaimedRouteFieldsFromUnexploredDoc,
  buildClaimedRouteFieldsFromUnexploredDocSync,
  detectColdOpenRoutePost,
  resolveSourceUnexploredRouteId,
} from "../../lib/posts/claimed-route-post.js";

const FIRST_CAPTURE_XP = 25;

type FirestoreMap = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
}

function buildCapturedSpotDisplayFields(input: {
  postData: FirestoreMap;
  inputLat: number;
  inputLng: number;
  inputActivities?: string[];
  unexploredData?: FirestoreMap;
}): {
  thumbnailUrl: string | null;
  lat: number;
  lng: number;
  address: string | null;
  activities: string[];
  category: string | null;
} {
  const location = (input.postData.location as FirestoreMap | undefined) ?? {};
  const thumbnailUrl =
    asString(input.postData.displayPhotoLink) ?? asString(input.postData.photoLink) ?? null;
  const postLat =
    asNumber(input.postData.lat) ?? asNumber(location.lat) ?? input.inputLat;
  const postLng =
    asNumber(input.postData.long) ??
    asNumber(input.postData.lng) ??
    asNumber(location.long) ??
    asNumber(location.lng) ??
    input.inputLng;
  const address =
    asString(input.postData.address) ??
    asString(location.address) ??
    asString(input.unexploredData?.address) ??
    null;
  const postActivities = asStringArray(input.postData.activities);
  const unexploredActivities = asStringArray(input.unexploredData?.activities);
  const activities =
    postActivities.length > 0
      ? postActivities
      : (input.inputActivities?.length ?? 0) > 0
        ? (input.inputActivities ?? [])
        : unexploredActivities;
  const category =
    asString(input.unexploredData?.category) ??
    asStringArray(input.unexploredData?.categories)[0] ??
    asString(input.unexploredData?.primaryActivity) ??
    null;
  return {
    thumbnailUrl,
    lat: postLat,
    lng: postLng,
    address,
    activities,
    category
  };
}

async function resolveVerifiedCandidate(input: {
  lat: number;
  lng: number;
  activities?: string[];
  title?: string;
  candidateId?: string;
  sourceCollection?: "unexploredSpots" | "unexploredRoutes";
  itemType?: "unexploredSpot" | "unexploredRoute";
  postId?: string;
}): Promise<{ candidate: ClaimMatchCandidate | null; reason?: string }> {
  if (input.candidateId) {
    let sourceCollection = input.sourceCollection;
    let itemType = input.itemType;
    if (!sourceCollection || !itemType) {
      const inferred = inferClaimCandidateTarget(input.candidateId);
      sourceCollection = sourceCollection ?? inferred.sourceCollection;
      itemType = itemType ?? inferred.itemType;
    }

    const marker = await fetchUnexploredMapMarkerById({
      id: input.candidateId,
      sourceCollection,
      itemType,
      includeRouteGeometry: itemType === "unexploredRoute",
    });

    if (itemType === "unexploredRoute") {
      const routeFound = marker != null;
      const routePointCount = marker ? countRouteGeometryPoints(marker) : 0;
      let nearestRouteDistanceMeters: number | null = null;
      let allowedRadiusMeters = HARD_MAX_ROUTE_RADIUS_METERS;
      if (marker) {
        const dist = claimDistanceToMarker({
          marker,
          postLat: input.lat,
          postLng: input.lng,
        });
        nearestRouteDistanceMeters = dist.distanceMeters;
        allowedRadiusMeters = Math.min(
          HARD_MAX_ROUTE_RADIUS_METERS,
          maxRadiusForMarker(marker),
        );
      }

      console.info(
        `[claim-finalize.route.lookup] routeId=${input.candidateId} routeFound=${routeFound} source=${sourceCollection} postId=${input.postId ?? "null"} routePointCount=${routePointCount}`,
      );

      if (!marker) {
        console.info("[claim-finalize.route.validity]", {
          postId: input.postId ?? null,
          candidateId: input.candidateId,
          validCandidate: false,
          reason: "route_not_found",
        });
        return { candidate: null, reason: "route_not_found" };
      }

      if (routePointCount < 2) {
        console.info(
          `[claim-finalize.route.distance] nearestDistanceMeters=null allowedRadiusMeters=${allowedRadiusMeters} valid=false reason=route_geometry_missing routeId=${input.candidateId}`,
        );
        return { candidate: null, reason: "route_geometry_missing" };
      }

      const validDistance =
        nearestRouteDistanceMeters != null &&
        nearestRouteDistanceMeters <= allowedRadiusMeters;
      console.info(
        `[claim-finalize.route.distance] nearestDistanceMeters=${nearestRouteDistanceMeters ?? "null"} allowedRadiusMeters=${allowedRadiusMeters} valid=${validDistance} routeId=${input.candidateId}`,
      );

      const candidate = buildExplicitClaimCandidate({
        marker,
        postLat: input.lat,
        postLng: input.lng,
        postActivities: input.activities ?? [],
        postTitle: input.title,
      });

      console.info("[claim-finalize.route.validity]", {
        postId: input.postId ?? null,
        candidateId: input.candidateId,
        validCandidate: true,
        nearestRouteDistanceMeters: candidate.distanceMeters,
        allowedRadiusMeters: "explicit_bypass",
        reason: null,
      });

      return { candidate };
    }

    if (!marker) {
      return { candidate: null, reason: "spot_not_found" };
    }

    const scored = scoreClaimCandidate({
      marker,
      postLat: input.lat,
      postLng: input.lng,
      postActivities: input.activities ?? [],
      postTitle: input.title,
    });
    if (scored) return { candidate: scored };

    return {
      candidate: buildExplicitClaimCandidate({
        marker,
        postLat: input.lat,
        postLng: input.lng,
        postActivities: input.activities ?? [],
        postTitle: input.title,
      }),
    };
  }

  const resolved = await resolvePostingClaimCandidate({
    lat: input.lat,
    lng: input.lng,
    activities: input.activities,
    title: input.title,
    allowAlreadyCaptured: true
  });
  return { candidate: resolved.candidate, reason: resolved.candidate ? undefined : "no_valid_candidate" };
}

export function normalizeClaimFinalizeCandidateInput(input: {
  candidateId?: string;
  sourceCollection?: "unexploredSpots" | "unexploredRoutes";
  itemType?: "unexploredSpot" | "unexploredRoute";
  candidateItemType?: "unexploredSpot" | "unexploredRoute";
  undiscoveredSpotId?: string;
  undiscoveredRouteId?: string;
  unexploredRouteId?: string;
}): {
  candidateId?: string;
  sourceCollection?: "unexploredSpots" | "unexploredRoutes";
  itemType?: "unexploredSpot" | "unexploredRoute";
} {
  let candidateId = input.candidateId?.trim() || undefined;
  let sourceCollection = input.sourceCollection;
  let itemType = input.itemType ?? input.candidateItemType;

  const routeId =
    input.unexploredRouteId?.trim() ||
    input.undiscoveredRouteId?.trim() ||
    (candidateId?.startsWith("unx_route_") ? candidateId : undefined) ||
    (input.undiscoveredSpotId?.startsWith("unx_route_") ? input.undiscoveredSpotId.trim() : undefined);

  const isRouteClaim =
    itemType === "unexploredRoute" ||
    input.candidateItemType === "unexploredRoute" ||
    Boolean(routeId) ||
    candidateId?.startsWith("unx_route_") === true ||
    input.undiscoveredSpotId?.startsWith("unx_route_") === true;

  if (isRouteClaim) {
    candidateId = routeId ?? candidateId ?? input.undiscoveredSpotId?.trim();
    sourceCollection = sourceCollection ?? "unexploredRoutes";
    itemType = "unexploredRoute";
  } else if (input.undiscoveredSpotId?.trim() && !candidateId) {
    candidateId = input.undiscoveredSpotId.trim();
    sourceCollection = sourceCollection ?? "unexploredSpots";
    itemType = itemType ?? "unexploredSpot";
  }

  if (candidateId && (!sourceCollection || !itemType)) {
    const inferred = inferClaimCandidateTarget(candidateId);
    sourceCollection = sourceCollection ?? inferred.sourceCollection;
    itemType = itemType ?? inferred.itemType;
  }

  return { candidateId, sourceCollection, itemType };
}

function buildClaimCaptureSummary(input: {
  candidate: ClaimMatchCandidate;
  isFirstCapture: boolean;
}): {
  status: string;
  sourceCollection: "unexploredSpots" | "unexploredRoutes";
  itemType: "unexploredSpot" | "unexploredRoute";
  itemId: string;
  title: string;
  emoji: string | null;
  distanceMeters: number;
  matchScore: number;
  isFirstCapture: boolean;
} {
  return {
    status: "captured",
    sourceCollection: input.candidate.sourceCollection,
    itemType: input.candidate.itemType,
    itemId: input.candidate.id,
    title: input.candidate.title,
    emoji: input.candidate.emoji ?? null,
    distanceMeters: input.candidate.distanceMeters,
    matchScore: input.candidate.matchScore,
    isFirstCapture: input.isFirstCapture
  };
}
function logRouteClaimPersist(input: {
  postId: string;
  sourceUnexploredRouteId: string | null;
  routeGeometrySaved: boolean;
  reason?: string;
}): void {
  console.info(
    `[route_claim.persist] sourceUnexploredRouteId=${input.sourceUnexploredRouteId ?? "null"} routeGeometrySaved=${input.routeGeometrySaved}${input.reason ? ` reason=${input.reason}` : ""} postId=${input.postId}`,
  );
}

function resolveClaimRouteFields(input: {
  candidate: ClaimMatchCandidate;
  unexploredData: FirestoreMap;
  postData: FirestoreMap;
  prefetchedRouteFields: Record<string, unknown> | null;
  postActivities?: string[];
}): Record<string, unknown> | null {
  if (input.candidate.itemType !== "unexploredRoute") return null;
  const existingIsRoute = input.postData.isRoute === true || input.postData.postType === "route";
  if (existingIsRoute && detectColdOpenRoutePost(input.postData).routeGeometryPresent) return null;

  const clientSummary =
    (input.unexploredData.routeSummary as Record<string, unknown> | undefined) ??
    (input.postData.routeSummary as Record<string, unknown> | undefined) ??
    null;

  return (
    input.prefetchedRouteFields ??
    buildClaimedRouteFieldsFromUnexploredDocSync({
      undiscoveredRouteId: input.candidate.id,
      unexploredData: input.unexploredData,
      routeName: input.candidate.title,
      routeActivity:
        input.candidate.firstActivity ??
        asStringArray(input.postActivities)[0] ??
        asStringArray(input.unexploredData.activities)[0] ??
        undefined,
      category:
        asString(input.unexploredData.category) ??
        asStringArray(input.unexploredData.categories)[0] ??
        undefined,
      clientRouteSummary: clientSummary,
    })
  );
}

function logClaimDistanceComparison(input: {
  postId: string;
  userId: string;
  enforcePostDistanceCheck: boolean;
  skipped: boolean;
  requestLat: number;
  requestLng: number;
  postLat: number | null;
  postLng: number | null;
  candidate: ClaimMatchCandidate;
  distanceMeters: number;
  maxRadius: number;
  matchedBy: string;
  withinRadius: boolean;
}): void {
  console.info("[posting.claim_finalize.distance_check]", {
    postId: input.postId,
    userId: input.userId,
    enforcePostDistanceCheck: input.enforcePostDistanceCheck,
    skipped: input.skipped,
    requestLat: input.requestLat,
    requestLng: input.requestLng,
    postLat: input.postLat,
    postLng: input.postLng,
    candidateId: input.candidate.id,
    candidateLat: input.candidate.lat,
    candidateLng: input.candidate.lng,
    itemType: input.candidate.itemType,
    distanceMeters: Number(input.distanceMeters.toFixed(2)),
    maxRadiusMeters: input.maxRadius,
    matchedBy: input.matchedBy,
    withinRadius: input.withinRadius,
    deltaRequestVsPostMeters:
      input.postLat != null && input.postLng != null
        ? Number(
            Math.hypot(
              (input.requestLat - input.postLat) * 111_320,
              (input.requestLng - input.postLng) *
                111_320 *
                Math.max(0.2, Math.cos((input.postLat * Math.PI) / 180))
            ).toFixed(2)
          )
        : null
  });
}

export async function finalizePostingClaim(input: {
  viewerId: string;
  postId: string;
  userId: string;
  lat: number;
  lng: number;
  candidateId?: string;
  sourceCollection?: "unexploredSpots" | "unexploredRoutes";
  itemType?: "unexploredSpot" | "unexploredRoute";
  candidateItemType?: "unexploredSpot" | "unexploredRoute";
  undiscoveredSpotId?: string;
  undiscoveredRouteId?: string;
  unexploredRouteId?: string;
  activities?: string[];
  title?: string;
  enforcePostDistanceCheck?: boolean;
}): Promise<{
  captured: boolean;
  isFirstCapture?: boolean;
  sourceCollection?: "unexploredSpots" | "unexploredRoutes";
  itemType?: "unexploredSpot" | "unexploredRoute";
  itemId?: string;
  title?: string;
  emoji?: string | null;
  firstActivity?: string | null;
  distanceMeters?: number;
  matchScore?: number;
  alreadyCaptured?: boolean;
  xpAward?: number;
  reason?: string;
  captureSummary?: {
    status: string;
    sourceCollection: "unexploredSpots" | "unexploredRoutes";
    itemType: "unexploredSpot" | "unexploredRoute";
    itemId: string;
    title?: string;
    emoji?: string | null;
    distanceMeters?: number;
    matchScore?: number;
    isFirstCapture?: boolean;
  };
}> {
  if (input.viewerId !== input.userId) {
    return { captured: false, reason: "forbidden_user_mismatch" };
  }

  const db = getFirestoreSourceClient();
  if (!db) {
    return { captured: false, reason: "firestore_unavailable" };
  }

  const normalizedCandidate = normalizeClaimFinalizeCandidateInput(input);

  const verified = await resolveVerifiedCandidate({
    lat: input.lat,
    lng: input.lng,
    activities: input.activities,
    title: input.title,
    candidateId: normalizedCandidate.candidateId,
    sourceCollection: normalizedCandidate.sourceCollection,
    itemType: normalizedCandidate.itemType,
    postId: input.postId,
  });
  const candidate = verified.candidate;
  if (!candidate) {
    return { captured: false, reason: verified.reason ?? "no_valid_candidate" };
  }

  const postRef = db.collection("posts").doc(input.postId);
  const captureDocId = buildCaptureDocId(candidate.sourceCollection, candidate.id);
  const spotCaptureRef = db.collection("spotCaptures").doc(captureDocId);
  const userCaptureRef = db
    .collection("users")
    .doc(input.userId)
    .collection("capturedSpots")
    .doc(captureDocId);
  const awardRef = db
    .collection("users")
    .doc(input.userId)
    .collection("achievements_awards")
    .doc(`spot_capture_${input.postId}`);
  const achievementsRef = db.collection("users").doc(input.userId).collection("achievements").doc("state");
  const unexploredRef = db.collection(candidate.sourceCollection).doc(candidate.id);

  let prefetchedRouteFields: Record<string, unknown> | null = null;
  if (candidate.itemType === "unexploredRoute") {
    const unexploredSnap = await unexploredRef.get();
    const unexploredPrefetchData = (unexploredSnap.data() as FirestoreMap | undefined) ?? {};
    prefetchedRouteFields = await buildClaimedRouteFieldsFromUnexploredDoc({
      undiscoveredRouteId: candidate.id,
      unexploredData: unexploredPrefetchData,
      routeName: candidate.title,
      routeActivity:
        candidate.firstActivity ?? asStringArray(input.activities)[0] ?? undefined,
      category:
        asString(unexploredPrefetchData.category) ??
        asStringArray(unexploredPrefetchData.categories)[0] ??
        undefined,
      clientRouteSummary:
        (unexploredPrefetchData.routeSummary as Record<string, unknown> | undefined) ?? null
    });
    if (!prefetchedRouteFields) {
      prefetchedRouteFields = buildClaimedRouteFieldsFromUnexploredDocSync({
        undiscoveredRouteId: candidate.id,
        unexploredData: unexploredPrefetchData,
        routeName: candidate.title,
        routeActivity:
          candidate.firstActivity ?? asStringArray(input.activities)[0] ?? undefined,
        category:
          asString(unexploredPrefetchData.category) ??
          asStringArray(unexploredPrefetchData.categories)[0] ??
          undefined,
        clientRouteSummary:
          (unexploredPrefetchData.routeSummary as Record<string, unknown> | undefined) ?? null
      });
    }
  }

  const txResult = await db.runTransaction(async (tx) => {
    const [postDoc, spotCaptureDoc, userCaptureDoc, awardDoc, achievementsDoc, unexploredDoc] =
      await Promise.all([
        tx.get(postRef),
        tx.get(spotCaptureRef),
        tx.get(userCaptureRef),
        tx.get(awardRef),
        tx.get(achievementsRef),
        tx.get(unexploredRef)
      ]);

    if (!postDoc.exists) {
      return { captured: false, reason: "post_not_found" as const };
    }
    const postData = (postDoc.data() as FirestoreMap | undefined) ?? {};
    const unexploredData = (unexploredDoc.data() as FirestoreMap | undefined) ?? {};
    const capturedDisplay = buildCapturedSpotDisplayFields({
      postData,
      inputLat: input.lat,
      inputLng: input.lng,
      inputActivities: input.activities,
      unexploredData
    });
    const postOwnerId = asString(postData.userId) ?? asString(postData.ownerId);
    if (postOwnerId && postOwnerId !== input.userId) {
      return { captured: false, reason: "post_not_owned" as const };
    }

    const existingPostCapture = (postData.capture as FirestoreMap | undefined) ?? undefined;
    const existingItemId = asString(existingPostCapture?.itemId);
    const existingSource = asString(existingPostCapture?.sourceCollection);
    if (
      existingItemId === candidate.id &&
      existingSource === candidate.sourceCollection &&
      asString(existingPostCapture?.status) === "captured"
    ) {
      const idempotentRouteFields = resolveClaimRouteFields({
        candidate,
        unexploredData,
        postData,
        prefetchedRouteFields,
        postActivities: input.activities,
      });
      if (idempotentRouteFields) {
        tx.set(
          postRef,
          {
            ...idempotentRouteFields,
            routeSummary: {
              ...(asRecord(postData.routeSummary) ?? {}),
              ...(asRecord(idempotentRouteFields.routeSummary) ?? {}),
            },
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
      return {
        captured: true,
        isFirstCapture: existingPostCapture?.isFirstCapture === true,
        alreadyCaptured: existingPostCapture?.isFirstCapture !== true,
        sourceCollection: candidate.sourceCollection,
        itemType: candidate.itemType,
        itemId: candidate.id,
        title: asString(existingPostCapture?.title) ?? candidate.title,
        emoji: asString(existingPostCapture?.emoji) ?? candidate.emoji,
        firstActivity: candidate.firstActivity,
        distanceMeters: candidate.distanceMeters,
        matchScore: candidate.matchScore,
        xpAward: 0,
        routeClaimed:
          candidate.itemType === "unexploredRoute"
            ? Boolean(idempotentRouteFields) ||
              postData.isRoute === true ||
              postData.postType === "route"
            : undefined,
        reason: "idempotent_existing_post_capture"
      };
    }

    const postLat = asNumber(postData.lat) ?? asNumber((postData.location as FirestoreMap | undefined)?.lat);
    const postLng =
      asNumber(postData.long) ??
      asNumber(postData.lng) ??
      asNumber((postData.location as FirestoreMap | undefined)?.long) ??
      asNumber((postData.location as FirestoreMap | undefined)?.lng);
    const enforcePostDistanceCheck =
      input.enforcePostDistanceCheck === true
        ? true
        : input.enforcePostDistanceCheck === false
          ? false
          : !input.candidateId;
    if (postLat != null && postLng != null) {
      const markerForDistance = {
        id: candidate.id,
        sourceCollection: candidate.sourceCollection,
        itemType: candidate.itemType,
        title: candidate.title,
        lat: candidate.lat,
        lng: candidate.lng,
        firstActivity: candidate.firstActivity,
        emoji: candidate.emoji,
        hasMedia: false,
        isUnexplored: true as const,
        isRoute: candidate.itemType === "unexploredRoute",
        routeSummary:
          candidate.itemType === "unexploredRoute"
            ? ((unexploredData.routeSummary as Record<string, unknown> | undefined) ??
              (unexploredData.route as Record<string, unknown> | undefined) ??
              undefined)
            : undefined
      };
      const { distanceMeters, matchedBy } = claimDistanceToMarker({
        marker: markerForDistance,
        postLat,
        postLng
      });
      const maxRadius = Math.min(
        candidate.itemType === "unexploredRoute"
          ? HARD_MAX_ROUTE_RADIUS_METERS
          : HARD_MAX_SPOT_RADIUS_METERS,
        maxRadiusForMarker(markerForDistance)
      );
      const withinRadius = distanceMeters <= maxRadius;

      if (!enforcePostDistanceCheck) {
        logClaimDistanceComparison({
          postId: input.postId,
          userId: input.userId,
          enforcePostDistanceCheck,
          skipped: true,
          requestLat: input.lat,
          requestLng: input.lng,
          postLat,
          postLng,
          candidate,
          distanceMeters,
          maxRadius,
          matchedBy,
          withinRadius
        });
      } else {
        const verified = scoreClaimCandidate({
          marker: markerForDistance,
          postLat,
          postLng,
          postActivities: input.activities ?? [],
          postTitle: input.title
        });
        logClaimDistanceComparison({
          postId: input.postId,
          userId: input.userId,
          enforcePostDistanceCheck,
          skipped: false,
          requestLat: input.lat,
          requestLng: input.lng,
          postLat,
          postLng,
          candidate,
          distanceMeters,
          maxRadius,
          matchedBy,
          withinRadius
        });
        if (!verified) {
          return { captured: false, reason: "post_too_far_from_candidate" as const };
        }
      }
    }

    const existingCapture = spotCaptureDoc.exists ? (spotCaptureDoc.data() as FirestoreMap | undefined) : undefined;
    const isFirstCapture = !existingCapture;
    const alreadyCaptured = existingCapture != null;
    if (alreadyCaptured && !isFirstCapture) {
      const firstCapturedByUserId = asString(existingCapture?.firstCapturedByUserId);
      if (firstCapturedByUserId && firstCapturedByUserId !== input.userId) {
        if (userCaptureDoc.exists) {
          return {
            captured: true,
            isFirstCapture: false,
            alreadyCaptured: true,
            sourceCollection: candidate.sourceCollection,
            itemType: candidate.itemType,
            itemId: candidate.id,
            title: candidate.title,
            emoji: candidate.emoji,
            firstActivity: candidate.firstActivity,
            distanceMeters: candidate.distanceMeters,
            matchScore: candidate.matchScore,
            xpAward: 0,
            reason: "already_captured_by_other_user"
          };
        }
      }
    }

    const captureSummary = {
      status: "captured",
      sourceCollection: candidate.sourceCollection,
      itemType: candidate.itemType,
      itemId: candidate.id,
      title: candidate.title,
      emoji: candidate.emoji ?? null,
      capturedAt: FieldValue.serverTimestamp(),
      distanceMeters: candidate.distanceMeters,
      matchScore: candidate.matchScore,
      isFirstCapture
    };

    const postCaptureMerge: Record<string, unknown> = {
      capture: captureSummary,
      updatedAt: FieldValue.serverTimestamp()
    };

    let routeClaimed = postData.isRoute === true || postData.postType === "route";
    if (candidate.itemType === "unexploredRoute") {
      const routeFields = resolveClaimRouteFields({
        candidate,
        unexploredData,
        postData,
        prefetchedRouteFields,
        postActivities: input.activities,
      });
      if (routeFields) {
        Object.assign(postCaptureMerge, routeFields);
        postCaptureMerge.routeSummary = {
          ...(asRecord(postData.routeSummary) ?? {}),
          ...(asRecord(routeFields.routeSummary) ?? {}),
        };
        routeClaimed = true;
      }
    }

    tx.set(postRef, postCaptureMerge, { merge: true });

    tx.set(
      userCaptureRef,
      {
        sourceCollection: candidate.sourceCollection,
        itemType: candidate.itemType,
        itemId: candidate.id,
        title: candidate.title,
        emoji: candidate.emoji ?? null,
        firstActivity: candidate.firstActivity ?? capturedDisplay.activities[0] ?? null,
        postId: input.postId,
        capturedAt: FieldValue.serverTimestamp(),
        distanceMeters: candidate.distanceMeters,
        matchScore: candidate.matchScore,
        isFirstCapture,
        captureType: candidate.itemType === "unexploredRoute" ? "route" : "spot",
        thumbnailUrl: capturedDisplay.thumbnailUrl,
        lat: capturedDisplay.lat,
        lng: capturedDisplay.lng,
        address: capturedDisplay.address,
        activities: capturedDisplay.activities,
        category: capturedDisplay.category
      },
      { merge: true }
    );

    if (isFirstCapture) {
      tx.set(spotCaptureRef, {
        sourceCollection: candidate.sourceCollection,
        itemType: candidate.itemType,
        itemId: candidate.id,
        title: candidate.title,
        firstCapturedByUserId: input.userId,
        firstCapturedByPostId: input.postId,
        firstCapturedAt: FieldValue.serverTimestamp(),
        firstCaptureLat: input.lat,
        firstCaptureLng: input.lng,
        firstCaptureDistanceMeters: candidate.distanceMeters,
        firstCaptureMatchScore: candidate.matchScore,
        status: "captured",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
    } else {
      tx.set(
        spotCaptureRef,
        {
          updatedAt: FieldValue.serverTimestamp(),
          capturedCount: FieldValue.increment(1)
        },
        { merge: true }
      );
    }

    tx.set(
      unexploredRef,
      {
        captureStatus: "captured",
        ...(isFirstCapture
          ? {
              firstCapturedByUserId: input.userId,
              firstCapturedByPostId: input.postId,
              firstCapturedAt: FieldValue.serverTimestamp()
            }
          : {}),
        capturedCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    let xpAward = 0;
    if (isFirstCapture && !awardDoc.exists) {
      xpAward = FIRST_CAPTURE_XP;
      tx.set(awardRef, {
        type: "unexplored_spot_first_capture",
        xp: xpAward,
        postId: input.postId,
        sourceCollection: candidate.sourceCollection,
        itemType: candidate.itemType,
        itemId: candidate.id,
        title: candidate.title,
        createdAt: FieldValue.serverTimestamp()
      });
      const achievementsData = (achievementsDoc.data() as FirestoreMap | undefined) ?? {};
      const xpObject = (achievementsData.xp as FirestoreMap | undefined) ?? {};
      const currentXP =
        typeof xpObject.current === "number" && Number.isFinite(xpObject.current)
          ? Math.max(0, Math.floor(xpObject.current))
          : 0;
      tx.set(
        achievementsRef,
        {
          xp: buildXpState(currentXP + xpAward),
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    } else if (awardDoc.exists) {
      xpAward = 0;
    }

    return {
      captured: true,
      isFirstCapture,
      alreadyCaptured: !isFirstCapture,
      sourceCollection: candidate.sourceCollection,
      itemType: candidate.itemType,
      itemId: candidate.id,
      title: candidate.title,
      emoji: candidate.emoji,
      firstActivity: candidate.firstActivity,
      distanceMeters: candidate.distanceMeters,
      matchScore: candidate.matchScore,
      xpAward,
      routeClaimed:
        candidate.itemType === "unexploredRoute"
          ? routeClaimed || postData.isRoute === true || postData.postType === "route"
          : undefined
    };
  });

  if (process.env.NODE_ENV !== "production") {
    console.info("[posting.claim_finalize]", {
      postId: input.postId,
      userId: input.userId,
      itemId: txResult.itemId,
      itemType: txResult.itemType,
      captured: txResult.captured,
      routeClaimed: (txResult as { routeClaimed?: boolean }).routeClaimed ?? null,
      reason: txResult.reason,
      isFirstCapture: txResult.isFirstCapture,
      xpAward: txResult.xpAward
    });
  }
  if (normalizedCandidate.itemType === "unexploredRoute" && txResult.captured) {
    console.info(
      `[claim-finalize.route.capture_written] postId=${input.postId} routeId=${normalizedCandidate.candidateId ?? txResult.itemId ?? "null"} captured=true`,
    );
  }

  if (normalizedCandidate.itemType === "unexploredRoute" && txResult.captured) {
    try {
      const persisted = await postRef.get();
      const persistedData = (persisted.data() as FirestoreMap | undefined) ?? {};
      const coldOpen = detectColdOpenRoutePost(persistedData);
      logRouteClaimPersist({
        postId: input.postId,
        sourceUnexploredRouteId:
          coldOpen.sourceUnexploredRouteId ??
          resolveSourceUnexploredRouteId(persistedData) ??
          normalizedCandidate.candidateId ??
          txResult.itemId ??
          null,
        routeGeometrySaved: coldOpen.routeGeometryPresent,
        reason: txResult.reason,
      });
    } catch {
      logRouteClaimPersist({
        postId: input.postId,
        sourceUnexploredRouteId: normalizedCandidate.candidateId ?? txResult.itemId ?? null,
        routeGeometrySaved: (txResult as { routeClaimed?: boolean }).routeClaimed === true,
        reason: "persist_verify_failed",
      });
    }
  }

  return {
    ...txResult,
    ...(txResult.captured && candidate && txResult.isFirstCapture != null
      ? {
          captureSummary: buildClaimCaptureSummary({
            candidate,
            isFirstCapture: txResult.isFirstCapture === true
          })
        }
      : {})
  };
}

export async function listUserCapturedSpots(input: {
  userId: string;
  limit?: number;
}): Promise<
  Array<{
    id: string;
    sourceCollection: "unexploredSpots" | "unexploredRoutes";
    itemType: "unexploredSpot" | "unexploredRoute";
    itemId: string;
    title: string;
    emoji: string | null;
    firstActivity: string | null;
    postId: string | null;
    capturedAt: string | null;
    isFirstCapture: boolean;
    thumbnailUrl: string | null;
    lat: number | null;
    lng: number | null;
    address: string | null;
    activities: string[];
    category: string | null;
  }>
> {
  const db = getFirestoreSourceClient();
  if (!db) return [];
  const limit = Math.max(1, Math.min(input.limit ?? 20, 50));
  const snap = await db
    .collection("users")
    .doc(input.userId)
    .collection("capturedSpots")
    .orderBy("capturedAt", "desc")
    .limit(limit)
    .get();

  return snap.docs.map((doc) => {
    const data = (doc.data() as FirestoreMap | undefined) ?? {};
    const capturedAtRaw = data.capturedAt;
    const capturedAt =
      capturedAtRaw && typeof capturedAtRaw === "object" && "toDate" in (capturedAtRaw as { toDate?: () => Date })
        ? (capturedAtRaw as { toDate: () => Date }).toDate().toISOString()
        : typeof capturedAtRaw === "string"
          ? capturedAtRaw
          : null;
    return {
      id: doc.id,
      sourceCollection:
        data.sourceCollection === "unexploredRoutes" ? "unexploredRoutes" : "unexploredSpots",
      itemType: data.itemType === "unexploredRoute" ? "unexploredRoute" : "unexploredSpot",
      itemId: asString(data.itemId) ?? doc.id,
      title: asString(data.title) ?? "Captured spot",
      emoji: asString(data.emoji),
      firstActivity: asString(data.firstActivity),
      postId: asString(data.postId),
      capturedAt,
      isFirstCapture: data.isFirstCapture === true,
      thumbnailUrl: asString(data.thumbnailUrl),
      lat: asNumber(data.lat),
      lng: asNumber(data.lng),
      address: asString(data.address),
      activities: asStringArray(data.activities),
      category: asString(data.category)
    };
  });
}
