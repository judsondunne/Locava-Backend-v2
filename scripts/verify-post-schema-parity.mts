#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";

type Args = {
  base: string;
  viewerId: string;
  token?: string;
};

type Fixture = {
  requiredTopLevelFields: string[];
  requiredGeoDataFields: string[];
  disallowedAssetUrlSubstringsWhenReady: string[];
  requiredAssetFields: string[];
  requiredImageVariantFields: string[];
};

function parseArgs(argv: string[]): Args {
  const read = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    if (idx < 0 || idx + 1 >= argv.length) return undefined;
    return String(argv[idx + 1] ?? "").trim();
  };
  return {
    base: (read("--base") ?? "http://localhost:8080").replace(/\/+$/, ""),
    viewerId: read("--viewerId") ?? "internal-viewer",
    token: read("--token")
  };
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function apiPost(url: string, body: Record<string, unknown>, args: Args): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-viewer-id": args.viewerId,
      "x-viewer-roles": "internal",
      ...(args.token ? { authorization: `Bearer ${args.token}` } : {})
    },
    body: JSON.stringify(body)
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Request failed ${url}: ${res.status} ${JSON.stringify(payload)}`);
  }
  return payload;
}

function collectAssetUrls(assets: Array<Record<string, unknown>>): string[] {
  const urls: string[] = [];
  for (const asset of assets) {
    const direct = String(asset.original ?? "").trim();
    if (direct) urls.push(direct);
    const poster = String(asset.poster ?? "").trim();
    if (poster) urls.push(poster);
    const variants = (asset.variants ?? {}) as Record<string, unknown>;
    for (const value of Object.values(variants)) {
      if (typeof value === "string" && value.trim()) urls.push(value.trim());
      if (value && typeof value === "object") {
        for (const nested of Object.values(value as Record<string, unknown>)) {
          if (typeof nested === "string" && nested.trim()) urls.push(nested.trim());
        }
      }
    }
  }
  return urls;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const fixture = JSON.parse(
    readFileSync(new URL("./fixtures/old-good-post-schema.fixture.json", import.meta.url), "utf8")
  ) as Fixture;
  const unique = randomUUID().slice(0, 8);

  const create = await apiPost(
    `${args.base}/v2/posting/upload-session`,
    { clientSessionKey: `schema-parity-${unique}`, mediaCountHint: 1 },
    args
  );
  const sessionId = String(create?.data?.uploadSession?.sessionId ?? "");
  assert(sessionId.length > 0, "missing upload session id");

  const register = await apiPost(
    `${args.base}/v2/posting/media/register`,
    { sessionId, assetIndex: 0, assetType: "photo", clientMediaKey: `media-${unique}` },
    args
  );
  const mediaId = String(register?.data?.media?.mediaId ?? "");
  assert(mediaId.length > 0, "missing media id");

  await apiPost(`${args.base}/v2/posting/media/${encodeURIComponent(mediaId)}/mark-uploaded`, {}, args);
  const finalize = await apiPost(
    `${args.base}/v2/posting/finalize`,
    { sessionId, idempotencyKey: `schema-parity-finalize-${unique}`, mediaCount: 1 },
    args
  );
  const postId = String(finalize?.data?.postId ?? "");
  assert(postId.length > 0, "missing postId from finalize");

  const db = getFirestoreSourceClient();
  assert(db, "Firestore source client unavailable");
  const doc = await db.collection("posts").doc(postId).get();
  assert(doc.exists, `Post doc not found for ${postId}`);
  const post = (doc.data() ?? {}) as Record<string, unknown>;

  for (const field of fixture.requiredTopLevelFields) {
    assert(field in post, `missing required field '${field}'`);
  }

  const geoData = (post.geoData ?? {}) as Record<string, unknown>;
  for (const field of fixture.requiredGeoDataFields) {
    assert(typeof geoData[field] === "string" && String(geoData[field]).trim().length > 0, `missing geoData.${field}`);
  }

  const assets = Array.isArray(post.assets) ? (post.assets as Array<Record<string, unknown>>) : [];
  assert(assets.length > 0, "assets array empty");
  for (const asset of assets) {
    for (const field of fixture.requiredAssetFields) {
      assert(field in asset, `asset missing field '${field}'`);
    }
    if (String(asset.type) === "image") {
      const variants = (asset.variants ?? {}) as Record<string, unknown>;
      for (const field of fixture.requiredImageVariantFields) {
        assert(field in variants, `image asset missing variants.${field}`);
      }
    }
  }

  const assetsReady = post.assetsReady === true;
  if (assetsReady) {
    const urls = collectAssetUrls(assets);
    for (const token of fixture.disallowedAssetUrlSubstringsWhenReady) {
      assert(!urls.some((url) => url.includes(token)), `found disallowed staging URL token '${token}' in ready assets`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        ok: true,
        postId,
        assetsReady: post.assetsReady === true,
        hasGeoFields: true,
        hasLegacyPhotoFields: Boolean(post.photoLink && post.photoLinks2 && post.photoLinks3)
      },
      null,
      2
    )
  );
}

void main();
