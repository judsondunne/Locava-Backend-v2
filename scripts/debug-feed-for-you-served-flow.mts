const port = Number(process.env.PORT ?? 8080);
const baseUrl = `http://127.0.0.1:${port}`;
const viewerId = process.env.DEBUG_VIEWER_ID ?? "PYEY96qCc2erkFkwv0o4CnVqOjI3";

type Payload = {
  data?: {
    items: Array<{ postId: string }>;
    nextCursor: string | null;
    exhausted: boolean;
    feedState?: { reelQueueIndex?: number; reelQueueCount?: number; remainingReels?: number };
    debug?: { servedWriteCount?: number; servedWriteOk?: boolean; requestId?: string; engineVersion?: string };
  };
};

async function request(cursor?: string): Promise<Payload["data"]> {
  const params = new URLSearchParams({ viewerId, limit: "5", debug: "1" });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`${baseUrl}/v2/feed/for-you?${params.toString()}`, {
    headers: { "x-viewer-id": viewerId, "x-viewer-roles": "internal" }
  });
  const body = (await res.json()) as Payload;
  if (!res.ok || !body.data) throw new Error(`request_failed status=${res.status}`);
  return body.data;
}

function overlap(a: string[], b: string[]): string[] {
  return a.filter((id) => b.includes(id));
}

async function main(): Promise<void> {
  const r1 = await request();
  const ids1 = r1.items.map((item) => item.postId);
  const r2 = await request();
  const ids2 = r2.items.map((item) => item.postId);
  const r3 = r1.nextCursor ? await request(r1.nextCursor) : { items: [], nextCursor: null, exhausted: true, debug: {} };
  const ids3 = r3.items.map((item) => item.postId);

  console.log(JSON.stringify({
    request1: {
      ids: ids1,
      engineVersion: r1.debug?.engineVersion ?? null,
      reelQueueIndex: r1.feedState?.reelQueueIndex ?? null,
      servedWriteCount: r1.debug?.servedWriteCount ?? 0,
      servedWriteOk: r1.debug?.servedWriteOk ?? false
    },
    request2_restart: {
      ids: ids2,
      reelQueueIndex: r2.feedState?.reelQueueIndex ?? null,
      servedWriteCount: r2.debug?.servedWriteCount ?? 0,
      servedWriteOk: r2.debug?.servedWriteOk ?? false,
      overlapWith1: overlap(ids1, ids2)
    },
    request3_page2: {
      ids: ids3,
      reelQueueIndex: r3.feedState?.reelQueueIndex ?? null,
      servedWriteCount: r3.debug?.servedWriteCount ?? 0,
      servedWriteOk: r3.debug?.servedWriteOk ?? false,
      overlapWith1: overlap(ids1, ids3),
      overlapWith2: overlap(ids2, ids3)
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
