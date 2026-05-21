import { FieldPath, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";

const RUNS_COLLECTION = "wikimedia_mvp_staged_runs";
const SPOTS_SUBCOLLECTION = "spots";

export type WikiCurationRunSummary = {
  stageRunId: string;
  sourceRunId: string;
  pipelineType: string;
  createdAtMs: number;
  updatedAtMs: number;
  placeCount: number;
  postCount: number;
  imageCount: number;
  stateCode?: string;
  status?: string;
};

export type WikiCurationSpotSummary = {
  spotId: string;
  stageRunId: string;
  placeName: string;
  order: number | null;
  latitude: number | null;
  longitude: number | null;
  createdAtMs: number | null;
};

export type WikiCurationCandidateMedia = {
  assetTitle: string;
  imageUrl: string;
  sourceUrl: string;
  width: number | null;
  height: number | null;
  orientation: string | null;
  score: number | null;
};

export type WikiCurationCandidatePost = {
  postId: string;
  title: string;
  caption: string | null;
  activities: string[];
  moderatorTier: number | null;
  day: string;
  dayScore: number | null;
  latitude: number | null;
  longitude: number | null;
  coordinateSource: string | null;
  primaryMediaIndex: number;
  media: WikiCurationCandidateMedia[];
  sourcePrimaryUrl: string | null;
  coordinatePendingNominatimSkip?: boolean;
};

const RUN_SUMMARY_SELECT = new Set([
  "stageRunId",
  "sourceRunId",
  "pipelineType",
  "createdAtMs",
  "updatedAtMs",
  "placeCount",
  "postCount",
  "imageCount",
  "stateCode",
  "status"
]);

const SPOT_SUMMARY_SELECT = new Set([
  "spotId",
  "stageRunId",
  "placeName",
  "order",
  "latitude",
  "longitude",
  "createdAtMs"
]);

function requireDb(): Firestore {
  const db = getFirestoreSourceClient();
  if (!db) {
    throw new Error("firestore_unavailable");
  }
  return db;
}

export async function listWikiCurationRuns(input: { limit: number }): Promise<WikiCurationRunSummary[]> {
  const db = requireDb();
  const lim = Math.max(1, Math.min(100, Math.floor(input.limit) || 50));
  const snap = await db
    .collection(RUNS_COLLECTION)
    .orderBy("createdAtMs", "desc")
    .limit(lim)
    .select(...Array.from(RUN_SUMMARY_SELECT))
    .get();
  return snap.docs.map((d) => {
    const x = d.data() as DocumentData;
    return {
      stageRunId: String(x.stageRunId ?? d.id),
      sourceRunId: String(x.sourceRunId ?? ""),
      pipelineType: String(x.pipelineType ?? "wikimedia_mvp"),
      createdAtMs: Number(x.createdAtMs ?? 0),
      updatedAtMs: Number(x.updatedAtMs ?? 0),
      placeCount: Number(x.placeCount ?? 0),
      postCount: Number(x.postCount ?? 0),
      imageCount: Number(x.imageCount ?? 0),
      ...(typeof x.stateCode === "string" ? { stateCode: x.stateCode } : {}),
      ...(typeof x.status === "string" ? { status: x.status } : {})
    };
  });
}

export async function listWikiCurationSpotsPage(input: {
  runId: string;
  limit: number;
  cursor?: string | null;
}): Promise<{ spots: WikiCurationSpotSummary[]; nextCursor: string | null; hasMore: boolean }> {
  const db = requireDb();
  const runId = String(input.runId || "").trim();
  if (!runId) throw new Error("runId_required");
  const lim = Math.max(1, Math.min(100, Math.floor(input.limit) || 40));
  const cursor = String(input.cursor || "").trim();
  let q = db
    .collection(RUNS_COLLECTION)
    .doc(runId)
    .collection(SPOTS_SUBCOLLECTION)
    .orderBy(FieldPath.documentId())
    .limit(lim)
    .select(...Array.from(SPOT_SUMMARY_SELECT));
  if (cursor) {
    q = q.startAfter(cursor);
  }
  const snap = await q.get();
  const spots: WikiCurationSpotSummary[] = snap.docs.map((d) => {
    const x = d.data() as DocumentData;
    return {
      spotId: String(x.spotId ?? d.id),
      stageRunId: String(x.stageRunId ?? runId),
      placeName: String(x.placeName ?? ""),
      order: typeof x.order === "number" && Number.isFinite(x.order) ? x.order : null,
      latitude: typeof x.latitude === "number" && Number.isFinite(x.latitude) ? x.latitude : null,
      longitude: typeof x.longitude === "number" && Number.isFinite(x.longitude) ? x.longitude : null,
      createdAtMs: typeof x.createdAtMs === "number" && Number.isFinite(x.createdAtMs) ? x.createdAtMs : null
    };
  });
  const hasMore = snap.size >= lim;
  const nextCursor = hasMore && snap.docs.length ? String(snap.docs[snap.docs.length - 1]?.id ?? "") : null;
  return { spots, nextCursor: nextCursor || null, hasMore };
}

function slimMedia(m: DocumentData): WikiCurationCandidateMedia {
  return {
    assetTitle: String(m.assetTitle ?? ""),
    imageUrl: String(m.imageUrl ?? "").slice(0, 800),
    sourceUrl: String(m.sourceUrl ?? "").slice(0, 800),
    width: typeof m.width === "number" && Number.isFinite(m.width) ? m.width : null,
    height: typeof m.height === "number" && Number.isFinite(m.height) ? m.height : null,
    orientation: typeof m.orientation === "string" ? m.orientation : null,
    score: typeof m.score === "number" && Number.isFinite(m.score) ? m.score : null
  };
}

function slimPost(p: DocumentData): WikiCurationCandidatePost {
  const mediaRaw = Array.isArray(p.media) ? p.media : [];
  const media = mediaRaw.map((m) => slimMedia((m || {}) as DocumentData));
  const primaryMediaIndex = typeof p.primaryMediaIndex === "number" ? Math.max(0, Math.floor(p.primaryMediaIndex)) : 0;
  const hero = media[primaryMediaIndex] ?? media[0];
  const sa = (p.sourceAttribution || {}) as DocumentData;
  const sourcePrimaryUrl =
    (typeof sa.primarySourceUrl === "string" && sa.primarySourceUrl) ||
    (hero?.sourceUrl ? String(hero.sourceUrl) : null);
  return {
    postId: String(p.postId ?? ""),
    title: String(p.title ?? "").slice(0, 220),
    caption: typeof p.caption === "string" ? p.caption.slice(0, 2000) : p.caption == null ? null : String(p.caption),
    activities: Array.isArray(p.activities) ? p.activities.map((a) => String(a)).slice(0, 16) : [],
    moderatorTier: typeof p.moderatorTier === "number" && Number.isFinite(p.moderatorTier) ? p.moderatorTier : null,
    day: String(p.day ?? ""),
    dayScore: typeof p.dayScore === "number" && Number.isFinite(p.dayScore) ? p.dayScore : null,
    latitude: typeof p.latitude === "number" && Number.isFinite(p.latitude) ? p.latitude : null,
    longitude: typeof p.longitude === "number" && Number.isFinite(p.longitude) ? p.longitude : null,
    coordinateSource: typeof p.coordinateSource === "string" ? p.coordinateSource : null,
    primaryMediaIndex,
    media,
    sourcePrimaryUrl: sourcePrimaryUrl ? String(sourcePrimaryUrl).slice(0, 800) : null,
    ...(p.coordinatePendingNominatimSkip === true ? { coordinatePendingNominatimSkip: true as const } : {})
  };
}

export async function loadWikiCurationSpotCandidates(input: {
  runId: string;
  spotId: string;
}): Promise<{
  spotName: string;
  anchorLat: number | null;
  anchorLng: number | null;
  posts: WikiCurationCandidatePost[];
}> {
  const db = requireDb();
  const runId = String(input.runId || "").trim();
  const spotId = String(input.spotId || "").trim();
  if (!runId || !spotId) throw new Error("runId_and_spotId_required");
  const ref = db.collection(RUNS_COLLECTION).doc(runId).collection(SPOTS_SUBCOLLECTION).doc(spotId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { spotName: "", anchorLat: null, anchorLng: null, posts: [] };
  }
  const x = snap.data() as DocumentData;
  const postsRaw = Array.isArray(x.posts) ? x.posts : [];
  const posts = postsRaw.map((p) => slimPost((p || {}) as DocumentData)).filter((p) => p.postId);
  return {
    spotName: String(x.placeName ?? ""),
    anchorLat: typeof x.latitude === "number" && Number.isFinite(x.latitude) ? x.latitude : null,
    anchorLng: typeof x.longitude === "number" && Number.isFinite(x.longitude) ? x.longitude : null,
    posts
  };
}

export async function patchWikiCurationOnStagedPosts(input: {
  runId: string;
  spotId: string;
  byPostId: Record<
    string,
    {
      aiCuration: Record<string, unknown>;
    }
  >;
}): Promise<{ updated: number }> {
  const db = requireDb();
  const ref = db.collection(RUNS_COLLECTION).doc(input.runId).collection(SPOTS_SUBCOLLECTION).doc(input.spotId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("spot_not_found");
  const x = snap.data() as DocumentData;
  const postsRaw = Array.isArray(x.posts) ? x.posts : [];
  let updated = 0;
  const nextPosts = postsRaw.map((raw) => {
    const p = (raw || {}) as DocumentData;
    const id = String(p.postId ?? "");
    const patch = id ? input.byPostId[id] : undefined;
    if (!patch) return raw;
    updated += 1;
    return {
      ...p,
      aiCuration: patch.aiCuration
    };
  });
  await ref.set({ posts: nextPosts, updatedAtMs: Date.now() }, { merge: true });
  return { updated };
}
