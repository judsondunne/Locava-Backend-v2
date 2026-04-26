/**
 * Maps Backendv2 notification list payload (`data` envelope) to legacy
 * `/api/v1/product/notifications*` item shapes expected by Locava-Native
 * when not using the v2 owner (HTTP list / bootstrap / stats helpers).
 */

export type LegacyProductNotificationRow = Record<string, unknown>;

function readStateToRead(readState: unknown, legacyRead: unknown): boolean {
  if (readState === "read") return true;
  if (readState === "unread") return false;
  return Boolean(legacyRead);
}

function previewText(n: Record<string, unknown>): string {
  const preview = n.preview as Record<string, unknown> | undefined;
  if (preview && typeof preview.text === "string") return preview.text;
  if (typeof n.message === "string") return n.message;
  return "";
}

function previewThumb(n: Record<string, unknown>): string | null {
  const preview = n.preview as Record<string, unknown> | undefined;
  const u = preview && typeof preview.thumbUrl === "string" ? preview.thumbUrl.trim() : "";
  return u.startsWith("http") ? u : null;
}

function timestampSecondsFromWire(n: Record<string, unknown>): number {
  const ms = Number(n.createdAtMs ?? 0);
  if (!Number.isFinite(ms) || ms <= 0) return Math.floor(Date.now() / 1000);
  return ms > 1_000_000_000_000 ? Math.floor(ms / 1000) : Math.floor(ms);
}

/** One notification row for legacy product JSON (`NotificationItem`-compatible). */
export function mapV2NotificationRowToLegacyProductItem(n: Record<string, unknown>, index: number): LegacyProductNotificationRow {
  const id = String(n.notificationId ?? `notif_${index + 1}`);
  const type = String(n.type ?? "post");
  const read = readStateToRead(n.readState, n.read);
  const actor = (n.actor as Record<string, unknown> | undefined) ?? {};
  const actorId = String(n.actorId ?? actor.userId ?? "");
  const targetId = String(n.targetId ?? "");
  const rowMeta = (n.metadata as Record<string, unknown> | undefined) ?? {};
  const thumb = previewThumb(n);
  const metaOut: Record<string, unknown> = { ...rowMeta };
  if (thumb) metaOut.postThumbUrl = thumb;

  const postId = type === "follow" ? undefined : targetId.length > 0 ? targetId : undefined;

  return {
    id,
    type,
    senderUserId: actorId,
    senderData: {
      name: typeof actor.name === "string" ? actor.name : undefined,
      handle: typeof actor.handle === "string" ? actor.handle : "",
      profilePic: typeof actor.pic === "string" && actor.pic.startsWith("http") ? actor.pic : undefined,
      photo: typeof actor.pic === "string" && actor.pic.startsWith("http") ? actor.pic : undefined
    },
    postId,
    commentId: typeof rowMeta.commentId === "string" ? rowMeta.commentId : undefined,
    collectionId: typeof rowMeta.collectionId === "string" ? rowMeta.collectionId : undefined,
    groupId: typeof rowMeta.groupId === "string" ? rowMeta.groupId : undefined,
    message: previewText(n) || `Notification ${index + 1}`,
    timestamp: timestampSecondsFromWire(n),
    seen: read,
    read,
    metadata: Object.keys(metaOut).length > 0 ? metaOut : undefined
  };
}

export function mapV2NotificationListToLegacyItems(items: unknown): LegacyProductNotificationRow[] {
  if (!Array.isArray(items)) return [];
  return (items as Record<string, unknown>[]).map((n, i) => mapV2NotificationRowToLegacyProductItem(n, i));
}
