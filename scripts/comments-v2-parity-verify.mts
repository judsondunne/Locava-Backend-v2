import process from "node:process";

const baseUrl = process.env.BACKEND_V2_URL ?? "http://localhost:4000";
const postId = process.env.COMMENTS_VERIFY_POST_ID ?? "WhjaCVvclAxpSQitZMBF";
const viewerId = process.env.COMMENTS_VERIFY_VIEWER_ID ?? "internal-viewer";

async function getJson(path: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "x-viewer-id": viewerId, "x-viewer-roles": "internal" }
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  const bootstrap = await getJson(`/v2/posts/${encodeURIComponent(postId)}/comments/bootstrap?limit=10`);
  const data = (bootstrap.body?.data ?? {}) as any;
  const items = Array.isArray(data.items) ? data.items : [];
  console.log("bootstrap status:", bootstrap.status);
  console.log("comment count:", data.page?.count ?? 0);
  console.log("first comment ids:", items.slice(0, 3).map((c: any) => c.commentId).join(", "));
  console.log("pagination cursor:", data.page?.nextCursor ?? null);

  if (data.page?.nextCursor) {
    const page = await getJson(
      `/v2/posts/${encodeURIComponent(postId)}/comments/page?limit=10&cursor=${encodeURIComponent(data.page.nextCursor)}`
    );
    console.log("page status:", page.status);
    console.log("page count:", page.body?.data?.items?.length ?? 0);
  }

  console.log("mutation dry-run: skipped (safe mode)");
}

main().catch((error) => {
  console.error("comments parity verify failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
