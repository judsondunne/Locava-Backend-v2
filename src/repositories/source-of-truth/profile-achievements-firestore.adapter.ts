import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { globalCache } from "../../cache/global-cache.js";
import { withTimeout } from "../../orchestration/timeouts.js";
import { getFirestoreSourceClient } from "./firestore-client.js";
import { readMaybeMillis } from "./post-firestore-projection.js";

export type FirestoreProfileAchievementPreviewItem = {
  achievementId: string;
  title: string;
  description?: string | null;
  iconUrl?: string | null;
  emoji?: string | null;
  badgeSource: "static" | "competitive";
  badgeType?: "activity" | "region" | null;
  earnedAtMs: number | null;
  progressCurrent: number;
  progressTarget: number;
  visibility: "public";
};

export type FirestoreProfileAchievementPreviewPage = {
  items: FirestoreProfileAchievementPreviewItem[];
  nextCursor: string | null;
  queryCount: number;
  readCount: number;
  emptyReason: string | null;
};

type BadgeDefinitionRecord = {
  id: string;
  name: string;
  description?: string;
  emoji?: string;
  image?: string;
  iconUrl?: string;
  targetNumber?: number;
  badgeType?: "activity" | "region" | null;
};

type CursorPayload = {
  earnedAtMs: number;
  achievementId: string;
};

const FIRESTORE_TIMEOUT_MS = 1200;
const BADGE_DEF_CACHE_PREFIX = "profile-achievements:badge-definition:v1:";

function encodeCursor(input: CursorPayload): string {
  return `pachievements:v1:${Buffer.from(JSON.stringify(input), "utf8").toString("base64url")}`;
}

function decodeCursor(raw: string | null): CursorPayload | null {
  if (!raw?.trim()) return null;
  const match = /^pachievements:v1:(.+)$/.exec(raw.trim());
  if (!match?.[1]) throw new Error("invalid_cursor");
  const parsed = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")) as Partial<CursorPayload>;
  if (
    typeof parsed.earnedAtMs !== "number" ||
    !Number.isFinite(parsed.earnedAtMs) ||
    typeof parsed.achievementId !== "string" ||
    parsed.achievementId.trim().length === 0
  ) {
    throw new Error("invalid_cursor");
  }
  return {
    earnedAtMs: Math.max(0, Math.floor(parsed.earnedAtMs)),
    achievementId: parsed.achievementId.trim(),
  };
}

function toOptionalText(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

function toProgressValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function isMissingIndexError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("FAILED_PRECONDITION") && message.toLowerCase().includes("requires an index");
}

export class ProfileAchievementsFirestoreAdapter {
  private readonly db = getFirestoreSourceClient();

  isEnabled(): boolean {
    return Boolean(this.db);
  }

  private async loadBadgeDefinitions(ids: string[]): Promise<{
    defs: Map<string, BadgeDefinitionRecord>;
    queryCount: number;
    readCount: number;
  }> {
    if (!this.db) throw new Error("firestore_source_unavailable");
    const mapped = new Map<string, BadgeDefinitionRecord>();
    const missingIds: string[] = [];
    for (const id of ids) {
      if (!id) continue;
      const cacheKey = `${BADGE_DEF_CACHE_PREFIX}${id}`;
      const cached = await globalCache.get<BadgeDefinitionRecord | null>(cacheKey);
      if (cached) {
        mapped.set(id, cached);
      } else {
        missingIds.push(id);
      }
    }
    if (missingIds.length === 0) {
      return { defs: mapped, queryCount: 0, readCount: 0 };
    }
    const snapshot = await withTimeout(
      this.db.getAll(...missingIds.map((id) => this.db!.collection("achievements").doc(id))),
      FIRESTORE_TIMEOUT_MS,
      "profile-achievements-badge-definitions"
    );
    for (const doc of snapshot) {
      if (!doc.exists) continue;
      const data = (doc.data() ?? {}) as Record<string, unknown>;
      const definition = {
        id: doc.id,
        name: String(data.name ?? doc.id),
        description: toOptionalText(data.description) ?? undefined,
        emoji: toOptionalText(data.emoji) ?? undefined,
        image: toOptionalText(data.image) ?? undefined,
        iconUrl: toOptionalText(data.iconUrl) ?? undefined,
        targetNumber:
          typeof data.targetNumber === "number" && Number.isFinite(data.targetNumber) && data.targetNumber > 0
            ? Math.floor(data.targetNumber)
            : undefined,
        badgeType:
          data.badgeType === "activity" || data.badgeType === "region"
            ? data.badgeType
            : null,
      } satisfies BadgeDefinitionRecord;
      mapped.set(doc.id, definition);
      void globalCache.set(`${BADGE_DEF_CACHE_PREFIX}${doc.id}`, definition, 5 * 60_000).catch(() => undefined);
    }
    return { defs: mapped, queryCount: 1, readCount: snapshot.filter((doc) => doc.exists).length };
  }

  async listAchievements(input: {
    userId: string;
    cursor: string | null;
    limit: number;
  }): Promise<FirestoreProfileAchievementPreviewPage> {
    if (!this.db) throw new Error("firestore_source_unavailable");
    const safeLimit = Math.max(1, Math.min(Math.floor(input.limit || 8), 12));
    const queryLimit = Math.min(20, safeLimit + 1 + 4);
    const cursor = decodeCursor(input.cursor);

    let query = this.db
      .collection("users")
      .doc(input.userId)
      .collection("badges")
      .where("earned", "==", true)
      .orderBy("earnedAt", "desc")
      .orderBy(FieldPath.documentId(), "desc")
      .select("earned", "claimed", "progress", "earnedAt", "visible");
    if (cursor) {
      query = query.startAfter(Timestamp.fromMillis(cursor.earnedAtMs), cursor.achievementId);
    }
    let snapshot: FirebaseFirestore.QuerySnapshot;
    try {
      snapshot = await withTimeout(query.limit(queryLimit).get(), FIRESTORE_TIMEOUT_MS, "profile-achievements-page");
    } catch (error) {
      if (!isMissingIndexError(error)) throw error;
      snapshot = await withTimeout(
        this.db
          .collection("users")
          .doc(input.userId)
          .collection("badges")
          .where("earned", "==", true)
          .select("earned", "claimed", "progress", "earnedAt", "visible")
          .limit(queryLimit)
          .get(),
        FIRESTORE_TIMEOUT_MS,
        "profile-achievements-page-fallback"
      );
    }
    const visibleDocs = snapshot.docs
      .filter((doc) => doc.get("visible") !== false)
      .sort((a, b) => (readMaybeMillis(b.get("earnedAt")) ?? 0) - (readMaybeMillis(a.get("earnedAt")) ?? 0))
      .slice(0, safeLimit);
    const badgeDefinitions = await this.loadBadgeDefinitions(visibleDocs.map((doc) => doc.id));
    const items = visibleDocs.map((doc) => {
      const definition = badgeDefinitions.defs.get(doc.id);
      const progress = (doc.get("progress") ?? {}) as { current?: unknown; target?: unknown };
      return {
        achievementId: doc.id,
        title: definition?.name ?? doc.id,
        description: definition?.description ?? null,
        iconUrl: definition?.iconUrl ?? definition?.image ?? null,
        emoji: definition?.emoji ?? null,
        badgeSource: "static",
        badgeType: definition?.badgeType ?? null,
        earnedAtMs: readMaybeMillis(doc.get("earnedAt")),
        progressCurrent: Math.max(toProgressValue(progress.current), definition?.targetNumber ?? 0),
        progressTarget: Math.max(1, toProgressValue(progress.target) || definition?.targetNumber || 1),
        visibility: "public",
      } satisfies FirestoreProfileAchievementPreviewItem;
    });
    const lastScannedDoc = visibleDocs[visibleDocs.length - 1] ?? snapshot.docs[snapshot.docs.length - 1] ?? null;
    return {
      items,
      nextCursor:
        snapshot.docs.length === queryLimit && lastScannedDoc
          ? encodeCursor({
              earnedAtMs: readMaybeMillis(lastScannedDoc.get("earnedAt")) ?? 0,
              achievementId: lastScannedDoc.id,
            })
          : null,
      queryCount: 1 + badgeDefinitions.queryCount,
      readCount: snapshot.docs.length + badgeDefinitions.readCount,
      emptyReason: items.length > 0 ? null : "no_public_earned_badges",
    };
  }
}
