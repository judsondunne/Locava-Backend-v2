import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { ReelsMvpPublishMeta, StagedReelsMvpDoc } from "./types.js";
import { REELS_MVP_FIRESTORE_COLLECTION } from "./types.js";

export function pickEffectiveDraftAndMedia(doc: StagedReelsMvpDoc): {
  draft: Record<string, unknown>;
  media: Record<string, unknown>;
  moderatorTier: number | null;
} {
  const rs = doc.readySnapshot && typeof doc.readySnapshot === "object" ? doc.readySnapshot : null;
  const baseDraft = (doc.draft && typeof doc.draft === "object" ? doc.draft : {}) as Record<string, unknown>;
  const snapDraft = rs && typeof rs.draft === "object" ? (rs.draft as Record<string, unknown>) : {};
  const draft = doc.reviewState === "ready" && rs ? { ...baseDraft, ...snapDraft } : { ...baseDraft };

  const baseMedia = (doc.media && typeof doc.media === "object" ? doc.media : {}) as Record<string, unknown>;
  const snapMedia = rs && typeof rs.media === "object" ? (rs.media as Record<string, unknown>) : {};
  const media = doc.reviewState === "ready" && rs ? { ...baseMedia, ...snapMedia } : { ...baseMedia };

  const rawTier = (rs?.moderatorTier ?? draft.moderatorTier) as unknown;
  let moderatorTier: number | null = null;
  if (typeof rawTier === "number" && Number.isFinite(rawTier)) {
    moderatorTier = Math.min(5, Math.max(1, Math.trunc(rawTier)));
  }

  return { draft, media, moderatorTier };
}

function toEpochMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value === "object" && "toMillis" in value && typeof (value as { toMillis: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}

export async function listStagedReelsMvpDocs(input: {
  db: Firestore;
  limit: number;
  readyOnly: boolean;
}): Promise<Array<{ id: string; data: StagedReelsMvpDoc }>> {
  const cap = Math.min(500, Math.max(1, input.limit));
  const snap = await input.db.collection(REELS_MVP_FIRESTORE_COLLECTION).limit(800).get();
  let rows = snap.docs.map((d) => ({ id: d.id, data: (d.data() ?? {}) as StagedReelsMvpDoc }));
  if (input.readyOnly) {
    rows = rows.filter(
      (r) => String(r.data.reviewState ?? "") === "ready" && String(r.data.status ?? "") === "staged",
    );
  }
  rows.sort((a, b) => toEpochMs(b.data.createdAt) - toEpochMs(a.data.createdAt));
  return rows.slice(0, cap);
}

export async function getStagedDoc(input: {
  db: Firestore;
  stageId: string;
}): Promise<{ id: string; data: StagedReelsMvpDoc } | null> {
  const snap = await input.db.collection(REELS_MVP_FIRESTORE_COLLECTION).doc(input.stageId).get();
  if (!snap.exists) return null;
  return { id: snap.id, data: (snap.data() ?? {}) as StagedReelsMvpDoc };
}

export async function runPublishMetaTransaction(input: {
  db: Firestore;
  stageId: string;
  mutate: (prev: ReelsMvpPublishMeta | null) => ReelsMvpPublishMeta;
}): Promise<ReelsMvpPublishMeta> {
  let next: ReelsMvpPublishMeta | null = null;
  await input.db.runTransaction(async (tx) => {
    const ref = input.db.collection(REELS_MVP_FIRESTORE_COLLECTION).doc(input.stageId);
    const snap = await tx.get(ref);
    const prev = (snap.data()?.publish ?? null) as ReelsMvpPublishMeta | null;
    next = input.mutate(prev);
    tx.set(
      ref,
      {
        publish: next,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true },
    );
  });
  return next!;
}
