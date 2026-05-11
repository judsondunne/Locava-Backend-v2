#!/usr/bin/env npx tsx
/**
 * CLI for Reels MVP publisher (wraps the same service as HTTP routes).
 *
 * Examples:
 *   REELS_MVP_PUBLISHER_ENABLED=true npx tsx scripts/reels-mvp-publisher.mts dry-run --stageId=abc
 *   REELS_MVP_PUBLISHER_ENABLED=true npx tsx scripts/reels-mvp-publisher.mts dry-run-batch --limit=5
 *   REELS_MVP_PUBLISHER_ENABLED=true REELS_MVP_PUBLISHER_WRITE_ENABLED=true npx tsx scripts/reels-mvp-publisher.mts publish-one --stageId=abc --confirmWrite
 *   REELS_MVP_PUBLISHER_ENABLED=true npx tsx scripts/reels-mvp-publisher.mts verify-post --postId=post_xxx
 */
import { loadEnv } from "../src/config/env.js";
import {
  batchDryRun,
  dryRunOne,
  publishOne,
  regenerateReelMediaFromStage,
  verifyPostById
} from "../src/admin/reelsMvpPublisher/reelsMvpPublisher.service.js";
import { runReelsColorPreviewPackage } from "../src/admin/reelsMvpPublisher/reelsColorPreview.service.js";
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (!hit) return null;
  return hit.slice(prefix.length) || null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const cmd = process.argv[2] ?? "";
  const env = loadEnv();
  if (cmd === "dry-run") {
    const stageId = arg("stageId");
    if (!stageId) throw new Error("missing --stageId=");
    const r = await dryRunOne({ env, stageId, allowFallbackAuthor: hasFlag("allowFallbackAuthor") });
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  if (cmd === "dry-run-batch") {
    const lim = Number(arg("limit") ?? "5");
    const r = await batchDryRun({ env, limit: lim });
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  if (cmd === "publish-one") {
    const stageId = arg("stageId");
    if (!stageId) throw new Error("missing --stageId=");
    const confirmWrite = hasFlag("confirmWrite");
    const colorPipelinePreset = arg("colorPipelinePreset") ?? undefined;
    const r = await publishOne({
      env,
      stageId,
      confirmWrite,
      forceRebuild: hasFlag("forceRebuild"),
      allowFallbackAuthor: hasFlag("allowFallbackAuthor"),
      colorPipelinePreset
    });
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  if (cmd === "color-preview") {
    const stageId = arg("stageId");
    if (!stageId) throw new Error("missing --stageId=");
    const db = getFirestoreSourceClient();
    if (!db) throw new Error("firestore_unavailable");
    const r = await runReelsColorPreviewPackage({ db, stageId });
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  if (cmd === "regenerate-media") {
    const stageId = arg("stageId");
    const postId = arg("postId");
    const colorPipelinePreset = arg("colorPipelinePreset");
    if (!stageId || !postId || !colorPipelinePreset) {
      throw new Error("missing --stageId= / --postId= / --colorPipelinePreset=");
    }
    if (!hasFlag("confirmWrite")) throw new Error("missing --confirmWrite");
    const r = await regenerateReelMediaFromStage({
      env,
      stageId,
      postId,
      colorPipelinePreset,
      confirmWrite: true
    });
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  if (cmd === "verify-post") {
    const postId = arg("postId");
    if (!postId) throw new Error("missing --postId=");
    const r = await verifyPostById({ env, postId });
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  console.error(
    "Usage: dry-run | dry-run-batch | publish-one | color-preview | regenerate-media | verify-post (see script header for flags)",
  );
  process.exit(2);
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
