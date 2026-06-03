import { FieldValue } from "firebase-admin/firestore";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { buildXpState } from "../surfaces/achievements-core.js";
import {
  buildCaptureDocId,
  scoreClaimCandidate,
  type ClaimMatchCandidate
} from "./postingClaimMatching.js";
import { resolvePostingClaimCandidate } from "./postingClaimCandidate.service.js";
import { fetchUnexploredMapMarkerSummaries } from "../map/unexploredMapMarkers.service.js";
import { bboxAroundPoint, HARD_MAX_SPOT_RADIUS_METERS } from "./postingClaimMatching.js";

const FIRST_CAPTURE_XP = 25;

type FirestoreMap = Record<string, unknown>;

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
}): Promise<ClaimMatchCandidate | null> {
  if (input.candidateId && input.sourceCollection && input.itemType) {
    const bbox = bboxAroundPoint(input.lat, input.lng, HARD_MAX_SPOT_RADIUS_METERS);
    const { markers } = await fetchUnexploredMapMarkerSummaries({ bbox, zoom: 14, limit: 200 });
    const marker = markers.find(
      (row) =>
        row.id === input.candidateId &&
        row.sourceCollection === input.sourceCollection &&
        row.itemType === input.itemType
    );
    if (!marker) return null;
    return scoreClaimCandidate({
      marker,
      postLat: input.lat,
      postLng: input.lng,
      postActivities: input.activities ?? [],
      postTitle: input.title
    });
  }

  const resolved = await resolvePostingClaimCandidate({
    lat: input.lat,
    lng: input.lng,
    activities: input.activities,
    title: input.title,
    allowAlreadyCaptured: true
  });
  return resolved.candidate;
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
  activities?: string[];
  title?: string;
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
}> {
  if (input.viewerId !== input.userId) {
    return { captured: false, reason: "forbidden_user_mismatch" };
  }

  const db = getFirestoreSourceClient();
  if (!db) {
    return { captured: false, reason: "firestore_unavailable" };
  }

  const candidate = await resolveVerifiedCandidate(input);
  if (!candidate) {
    return { captured: false, reason: "no_valid_candidate" };
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
        reason: "idempotent_existing_post_capture"
      };
    }

    const postLat = asNumber(postData.lat) ?? asNumber((postData.location as FirestoreMap | undefined)?.lat);
    const postLng =
      asNumber(postData.long) ??
      asNumber(postData.lng) ??
      asNumber((postData.location as FirestoreMap | undefined)?.long) ??
      asNumber((postData.location as FirestoreMap | undefined)?.lng);
    if (postLat != null && postLng != null) {
      const verified = scoreClaimCandidate({
        marker: {
          id: candidate.id,
          sourceCollection: candidate.sourceCollection,
          itemType: candidate.itemType,
          title: candidate.title,
          lat: candidate.lat,
          lng: candidate.lng,
          firstActivity: candidate.firstActivity,
          emoji: candidate.emoji,
          hasMedia: false,
          isUnexplored: true,
          isRoute: candidate.itemType === "unexploredRoute"
        },
        postLat,
        postLng,
        postActivities: input.activities ?? [],
        postTitle: input.title
      });
      if (!verified) {
        return { captured: false, reason: "post_too_far_from_candidate" as const };
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

    tx.set(
      postRef,
      {
        capture: captureSummary,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

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
      xpAward
    };
  });

  if (process.env.NODE_ENV !== "production" && txResult.captured) {
    console.info("[posting.claim_finalize]", {
      postId: input.postId,
      userId: input.userId,
      itemId: txResult.itemId,
      isFirstCapture: txResult.isFirstCapture,
      xpAward: txResult.xpAward
    });
  }

  return txResult;
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
