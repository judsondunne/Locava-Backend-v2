/**
 * Repair invalid `classification.visibility` on posts (claimed routes wrote
 * `privacy: "Public Route"` → master post `visibility: "unknown"`, which breaks
 * `/v2/posts/render-standardized:batch`).
 *
 * Usage:
 *   npx tsx scripts/repair-classification-visibility.mts --dry-run --postId post_84dba1ae67a0860f
 *   npx tsx scripts/repair-classification-visibility.mts --apply --postId post_84dba1ae67a0860f
 *   npx tsx scripts/repair-classification-visibility.mts --dry-run --scanClaimed --limit 200
 *
 * Only updates `classification.visibility` (and top-level `visibility` when present).
 * Does not modify media fields.
 */
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";
import {
  normalizePostVisibilityForWrite,
} from "../src/lib/posts/postVisibilityNormalize.js";

const ALLOWED_MASTER = new Set(["public", "friends", "private", "unknown"]);

function parseArgs(argv: string[]): {
  dryRun: boolean;
  apply: boolean;
  postId?: string;
  scanClaimed: boolean;
  limit: number;
} {
  const dryRun = argv.includes("--dry-run") || !argv.includes("--apply");
  const apply = argv.includes("--apply");
  const scanClaimed = argv.includes("--scanClaimed");
  const postIdx = argv.indexOf("--postId");
  const postId = postIdx >= 0 && argv[postIdx + 1] ? String(argv[postIdx + 1]).trim() : undefined;
  const limitIdx = argv.indexOf("--limit");
  const limit =
    limitIdx >= 0 && argv[limitIdx + 1] ? Math.max(1, Number(argv[limitIdx + 1])) : 100;
  return { dryRun, apply, postId, scanClaimed, limit };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readVisibility(post: Record<string, unknown>): string | null {
  const cls = asRecord(post.classification);
  const app = asRecord(post.appPostV2) ?? asRecord(post.appPost);
  const appCls = app ? asRecord(app.classification) : null;
  const raw = cls?.visibility ?? appCls?.visibility ?? post.visibility;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function isClaimedCandidate(post: Record<string, unknown>): boolean {
  return (
    post.routeSource === "undiscovered_claim" ||
    post.isRoute === true ||
    post.postType === "route" ||
    asRecord(post.capture)?.itemType === "unexploredRoute" ||
    asRecord(post.capture)?.itemType === "unexploredSpot" ||
    typeof post.undiscoveredRouteId === "string" ||
    typeof post.undiscoveredSpotId === "string"
  );
}

function needsRepair(post: Record<string, unknown>): {
  needed: boolean;
  current: string | null;
  next: string;
  reason: string;
} {
  const current = readVisibility(post);
  if (!current) {
    return { needed: true, current, next: "public", reason: "missing_visibility" };
  }
  if (ALLOWED_MASTER.has(current)) {
    return { needed: false, current, next: current, reason: "already_valid_master" };
  }
  const next = normalizePostVisibilityForWrite(current);
  return {
    needed: next !== current,
    current,
    next,
    reason: "invalid_legacy_visibility",
  };
}

async function repairOne(
  db: NonNullable<ReturnType<typeof getFirestoreSourceClient>>,
  postId: string,
  dryRun: boolean,
): Promise<{ postId: string; repaired: boolean; current: string | null; next: string }> {
  const ref = db.collection("posts").doc(postId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { postId, repaired: false, current: null, next: "public" };
  }
  const post = (snap.data() ?? {}) as Record<string, unknown>;
  const { needed, current, next, reason } = needsRepair(post);
  if (!needed) {
    return { postId, repaired: false, current, next, reason };
  }
  console.log(
    JSON.stringify({
      postId,
      oldVisibility: current,
      newVisibility: next,
      reason,
      dryRun,
    }),
  );
  if (!dryRun) {
    await ref.set(
      {
        classification: {
          ...(asRecord(post.classification) ?? {}),
          visibility: next,
        },
        visibility: next,
      },
      { merge: true },
    );
  }
  return { postId, repaired: true, current, next, reason };
}

async function main(): Promise<void> {
  const { dryRun, apply, postId, scanClaimed, limit } = parseArgs(process.argv.slice(2));
  const db = getFirestoreSourceClient();
  if (!db) {
    console.error("Firestore unavailable");
    process.exit(1);
  }

  const ids: string[] = [];
  if (postId) {
    ids.push(postId);
  } else if (scanClaimed) {
    const snap = await db
      .collection("posts")
      .orderBy("time", "desc")
      .limit(Math.min(limit * 4, 800))
      .get();
    for (const doc of snap.docs) {
      const data = (doc.data() ?? {}) as Record<string, unknown>;
      if (!isClaimedCandidate(data)) continue;
      const { needed } = needsRepair(data);
      if (needed) ids.push(doc.id);
      if (ids.length >= limit) break;
    }
  } else {
    console.error("Provide --postId <id> or --scanClaimed");
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      { mode: dryRun ? "dry-run" : apply ? "apply" : "dry-run", count: ids.length, ids: ids.slice(0, 20) },
      null,
      2,
    ),
  );

  for (const id of ids) {
    const result = await repairOne(db, id, dryRun);
    console.log(JSON.stringify({ ...result, dryRun }));
  }
}

void main();
