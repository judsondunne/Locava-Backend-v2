const baseUrl = process.env.BACKENDV2_BASE_URL ?? "http://127.0.0.1:3000";
const viewerId = process.env.DEBUG_VIEWER_ID ?? "debug-feed-viewer";
const limit = Number(process.env.DEBUG_LIMIT ?? 5);

type ForYouResponse = {
  ok: boolean;
  data?: {
    items: Array<{ postId: string; media: { type: "image" | "video" }; author: { userId: string } }>;
    nextCursor: string | null;
    exhausted: boolean;
    feedState?: { reelQueueIndex: number; reelQueueCount: number; remainingReels: number };
    debug?: {
      engineVersion: string;
      returnedCount: number;
      reelCount: number;
      regularCount: number;
      recycledRegularCount: number;
      servedWriteCount: number;
      latencyMs: number;
    };
  };
  error?: string;
};

async function run(): Promise<void> {
  let cursor: string | null = null;
  const seen = new Set<string>();
  for (let page = 1; page <= 4; page += 1) {
    const search = new URLSearchParams();
    search.set("limit", String(limit));
    search.set("debug", "1");
    if (cursor) search.set("cursor", cursor);
    const res = await fetch(`${baseUrl}/v2/feed/for-you?${search.toString()}`, {
      headers: {
        "x-viewer-id": viewerId,
        "x-viewer-roles": "internal"
      }
    });
    const body = (await res.json()) as ForYouResponse;
    if (!res.ok || !body?.data) {
      throw new Error(`request_failed status=${res.status} body=${JSON.stringify(body).slice(0, 250)}`);
    }
    const items = body.data.items;
    const duplicates = items.filter((item) => seen.has(item.postId)).map((item) => item.postId);
    for (const item of items) seen.add(item.postId);
    const reelCount = items.filter((item) => item.media.type === "video").length;
    const regularCount = items.length - reelCount;
    const debug = body.data.debug;
    console.log(
      JSON.stringify({
        page,
        count: items.length,
        reelCount,
        regularCount,
        duplicates,
        nextCursor: Boolean(body.data.nextCursor),
        exhausted: body.data.exhausted,
        engineVersion: debug?.engineVersion ?? null,
        reelQueueIndex: body.data.feedState?.reelQueueIndex ?? null,
        reelQueueCount: body.data.feedState?.reelQueueCount ?? null,
        remainingReels: body.data.feedState?.remainingReels ?? null,
        servedWriteCount: debug?.servedWriteCount ?? null,
        reelCountDebug: debug?.reelCount ?? null,
        regularCountDebug: debug?.regularCount ?? null,
        recycledRegularCount: debug?.recycledRegularCount ?? null,
        latencyMs: debug?.latencyMs ?? null
      })
    );
    cursor = body.data.nextCursor;
    if (!cursor || body.data.exhausted) break;
  }
  console.log(JSON.stringify({ totalUniqueServed: seen.size }));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
