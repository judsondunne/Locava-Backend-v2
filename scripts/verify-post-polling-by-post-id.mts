#!/usr/bin/env node
/**
 * Verify canonical post polling route behavior.
 *
 * Usage:
 *   npx tsx scripts/verify-post-polling-by-post-id.mts --base http://localhost:8080 --postId post_123 --viewerId internal-viewer --token <jwt?>
 */

type Args = {
  base: string;
  postId: string;
  viewerId: string;
  token?: string;
};

function parseArgs(argv: string[]): Args {
  const read = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    if (idx < 0 || idx + 1 >= argv.length) return undefined;
    return String(argv[idx + 1] ?? "").trim();
  };
  const base = read("--base") ?? "http://localhost:8080";
  const postId = read("--postId") ?? "";
  const viewerId = read("--viewerId") ?? "internal-viewer";
  const token = read("--token");
  if (!postId) {
    throw new Error("Missing required --postId");
  }
  return { base: base.replace(/\/+$/, ""), postId, viewerId, token };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const url = `${args.base}/api/posts/${encodeURIComponent(args.postId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "x-viewer-id": args.viewerId,
      "x-viewer-roles": "internal",
      ...(args.token ? { authorization: `Bearer ${args.token}` } : {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        ok: res.ok,
        status: res.status,
        url,
        hasPost: Boolean(body?.post || body?.postData),
        postId: body?.post?.postId ?? body?.postData?.postId ?? null,
        diagnostics: body?.diagnostics ?? null,
        error: body?.error ?? null,
      },
      null,
      2,
    ),
  );
}

void main();
