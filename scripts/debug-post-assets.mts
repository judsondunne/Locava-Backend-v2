#!/usr/bin/env npx tsx
/**
 * Print canonical post-media normalization for a synthetic or Firestore-backed post shape.
 *
 * Usage:
 *   npm run debug:post-assets -- --postJson '{"postId":"x","assets":[...]}'
 *   npm run debug:post-assets -- --postId <id>   # reads Firestore when configured (optional)
 */

import process from "node:process";

import {
  normalizePostAssets,
  normalizedAssetsToEnvelopeRows,
} from "../src/contracts/post-assets.contract.js";
import { buildPostEnvelope } from "../src/lib/posts/post-envelope.js";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return undefined;
}

async function maybeLoadFirestore(postId: string): Promise<Record<string, unknown> | null> {
  const enabled = process.env.FIRESTORE_SOURCE_ENABLED === "true";
  if (!enabled || !postId) return null;
  try {
    const { getFirestoreSourceClient } = await import("../src/repositories/source-of-truth/firestore-client.js");
    const db = getFirestoreSourceClient();
    if (!db) return null;
    const snap = await db.collection("posts").doc(postId).get();
    if (!snap.exists) return null;
    return { postId: snap.id, id: snap.id, ...(snap.data() as Record<string, unknown>) };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const rawJson = argValue("--postJson") ?? argValue("-j");
  const postId = argValue("--postId") ?? argValue("-p");

  let doc: Record<string, unknown>;
  if (rawJson) {
    doc = JSON.parse(rawJson) as Record<string, unknown>;
  } else if (postId) {
    const fromFs = await maybeLoadFirestore(postId);
    if (fromFs) {
      doc = fromFs;
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        "[debug-post-assets] Firestore not configured or missing doc — using skeleton. Set FIRESTORE_SOURCE_ENABLED=true to pull posts/<postId>.",
      );
      doc = {
        postId,
        assets: [],
        displayPhotoLink: null,
      };
    }
  } else {
    // Synthetic three-image carousel
    doc = {
      postId: "demo-multi",
      mediaType: "image",
      displayPhotoLink: "https://cdn.example/cover.webp",
      assets: [
        { id: "a0", type: "image", variants: { lg: { webp: "https://cdn.example/0-lg.webp" } } },
        { id: "a1", type: "image", variants: { lg: { webp: "https://cdn.example/1-lg.webp" } } },
        {
          id: "a2",
          type: "image",
          variants: {
            md: { webp: "https://cdn.example/2-md.webp" },
          },
        },
      ],
    };
  }

  const pid = String(doc.postId ?? doc.id ?? "unknown");
  const norm = normalizePostAssets(doc, { postId: pid, devDiagnostics: true });
  const envelopeAssets = normalizedAssetsToEnvelopeRows(norm.assets);
  const envelope = buildPostEnvelope({
    postId: pid,
    seed: {},
    rawPost: doc,
    sourcePost: doc,
    hydrationLevel: "card",
    sourceRoute: "debug.post_assets",
    debugSource: "debug-post-assets.mts",
  });

  const lines = [
    `postId: ${pid}`,
    `canonical assetCount=${norm.assetCount} hasMultipleAssets=${norm.hasMultipleAssets}`,
    `source diagnostics: ${norm.diagnostics?.source ?? "n/a"}`,
    ...(norm.diagnostics?.warnings?.length ? [`warnings: ${norm.diagnostics.warnings.join("; ")}`] : []),
    `displayPhotoLink(canonical)=${norm.displayPhotoLink}`,
    "--- normalized assets ---",
    ...norm.assets.map(
      (a) =>
        `  #${a.index} id=${a.id} type=${a.type} displayUri=${a.displayUri} poster=${a.posterUri ?? ""} playback=${JSON.stringify(a.playback ?? {})}`,
    ),
    "--- envelope rows (first fields) ---",
    ...envelopeAssets.map((e) => `  id=${String(e.id)} previewUrl=${String(e.previewUrl)} streamUrl=${String(e.streamUrl ?? "")}`),
    `--- buildPostEnvelope assets.length=${(envelope.assets as unknown[]).length} assetCount field=${String(envelope.assetCount)} ---`,
  ];
  // eslint-disable-next-line no-console
  console.log(lines.join("\n"));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
