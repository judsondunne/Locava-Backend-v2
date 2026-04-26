/**
 * Notification lifecycle + legacy compat checks against a running Backendv2 server.
 *
 * Usage from `Locava Backendv2`:
 *   DEBUG_BASE_URL=http://127.0.0.1:8080 npm run debug:notifications:validate
 */
import { resolveLocalDebugViewerId } from "../src/lib/local-dev-identity.ts";

const BASE_URL = process.env.DEBUG_BASE_URL ?? "http://127.0.0.1:8090";
const VIEWER_ID = resolveLocalDebugViewerId(process.env.DEBUG_VIEWER_ID);

function assert(condition: boolean, msg: string, notes: string[]): void {
  if (!condition) notes.push(msg);
}

async function json(method: string, path: string, body?: unknown): Promise<{ status: number; payload: any }> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: body
        ? { "content-type": "application/json", "x-viewer-id": VIEWER_ID, "x-viewer-roles": "internal" }
        : { "x-viewer-id": VIEWER_ID, "x-viewer-roles": "internal" },
      body: body ? JSON.stringify(body) : undefined
    });
    const payload = await res.json().catch(() => ({}));
    return { status: res.status, payload };
  } catch (error) {
    return {
      status: 0,
      payload: { error: error instanceof Error ? error.message : String(error) }
    };
  }
}

async function main(): Promise<void> {
  const notes: string[] = [];

  const list = await json("GET", "/v2/notifications?limit=10");
  assert(list.status === 200, `v2 list status ${list.status}`, notes);
  const items = list.payload?.data?.items ?? [];
  assert(Array.isArray(items), "v2 list items missing", notes);
  if (items.length > 0) {
    const a = items[0].actor;
    assert(a && typeof a.userId === "string", "actor.userId", notes);
    assert(typeof a.handle === "string", "actor.handle", notes);
    assert(items[0].readState === "read" || items[0].readState === "unread", "readState", notes);
    assert(typeof items[0].preview?.text === "string" || items[0].preview?.text === null, "preview.text", notes);
  }
  const unreadV2 = list.payload?.data?.unread?.count;
  assert(typeof unreadV2 === "number", "v2 unread.count missing", notes);

  const stats = await json("GET", "/api/v1/product/notifications/stats");
  assert(stats.status === 200, `legacy stats ${stats.status}`, notes);
  assert(typeof stats.payload?.stats?.unread === "number", "legacy stats.unread", notes);

  const boot = await json("GET", "/api/v1/product/notifications/bootstrap?limit=10");
  assert(boot.status === 200, `legacy bootstrap ${boot.status}`, notes);
  const legacyItems = boot.payload?.notifications ?? [];
  assert(Array.isArray(legacyItems), "legacy bootstrap notifications[]", notes);
  if (legacyItems.length > 0) {
    const n = legacyItems[0] as Record<string, unknown>;
    assert(typeof n.read === "boolean", "legacy item read boolean (mapped from readState)", notes);
    assert(typeof n.message === "string" && n.message.length > 0, "legacy message from preview", notes);
    assert(typeof n.timestamp === "number", "legacy timestamp seconds", notes);
    assert(typeof n.senderUserId === "string", "legacy senderUserId", notes);
  }
  const bootUnread = boot.payload?.stats?.unread;
  assert(typeof bootUnread === "number", "bootstrap stats.unread", notes);
  if (typeof unreadV2 === "number" && typeof bootUnread === "number") {
    assert(bootUnread === unreadV2, `bootstrap unread ${bootUnread} vs v2 ${unreadV2}`, notes);
  }

  const ids = (items as Array<{ notificationId?: string }>).map((i) => i.notificationId).filter(Boolean).slice(0, 2);
  if (ids.length > 0) {
    const mr = await json("POST", "/v2/notifications/mark-read", { notificationIds: ids });
    assert(mr.status === 200, `mark-read ${mr.status}`, notes);
    const uAfter = mr.payload?.data?.updated?.unreadCount;
    assert(typeof uAfter === "number", "mark-read unreadCount", notes);
  }

  const putReadAll = await json("PUT", "/api/v1/product/notifications/read-all", {});
  assert(putReadAll.status === 200, `PUT read-all ${putReadAll.status}`, notes);

  const postReadAll = await json("POST", "/api/v1/product/notifications/read-all", {});
  assert(postReadAll.status === 200, `POST read-all ${postReadAll.status}`, notes);

  if (notes.length > 0) {
    for (const n of notes) console.error(`FAIL: ${n}`);
    process.exit(1);
  }
  console.log("PASS notifications parity validation");
}

await main();
