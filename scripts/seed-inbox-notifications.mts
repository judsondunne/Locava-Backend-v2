#!/usr/bin/env npx tsx
/**
 * Creates real notification rows + Expo pushes (same pipeline as production mutations)
 * without mutating follows, comments, or likes in product tables.
 *
 * Usage (from `Locava Backendv2`):
 *   npx tsx scripts/seed-inbox-notifications.mts <recipientUserId> [--actor=<otherUserId>] [--dry-run]
 *
 * If --actor is omitted, picks another user from `users` (first doc id !== recipient).
 * Requires Firestore access (GOOGLE_APPLICATION_CREDENTIALS / deployed identity).
 */
import type { Firestore } from "firebase-admin/firestore";
import "../src/config/env.js";
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";
import { notificationsRepository } from "../src/repositories/surfaces/notifications.repository.js";
import { assertEmulatorOnlyDestructiveFirestoreOperation } from "../src/safety/firestoreDestructiveGuard.js";
import { NotificationsService } from "../src/services/surfaces/notifications.service.js";

function trimStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function actorPushMetadata(actorData: Record<string, unknown>): Record<string, unknown> {
  const name = trimStr(actorData.name) ?? trimStr(actorData.displayName);
  const handle = trimStr(actorData.handle)?.replace(/^@+/, "") ?? trimStr(actorData.username)?.replace(/^@+/, "");
  const pic =
    trimStr(actorData.profilePic) ??
    trimStr(actorData.profilePicture) ??
    trimStr(actorData.photoURL) ??
    trimStr(actorData.photo);
  const senderDisplay = name || (handle ? `@${handle}` : "");
  const out: Record<string, unknown> = {};
  if (senderDisplay) out.senderName = senderDisplay;
  if (handle) out.senderHandle = handle;
  if (pic) out.senderProfilePic = pic;
  return out;
}

function parseArgs(argv: string[]): { recipient: string; actor: string | null; dryRun: boolean } {
  const positional: string[] = [];
  let actor: string | null = null;
  let dryRun = false;
  for (const a of argv) {
    if (a === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (a.startsWith("--actor=")) {
      const v = a.slice("--actor=".length).trim();
      actor = v.length > 0 ? v : null;
      continue;
    }
    if (a.startsWith("-")) continue;
    positional.push(a);
  }
  return { recipient: positional[0]?.trim() ?? "", actor, dryRun };
}

async function pickActorId(db: Firestore, recipient: string): Promise<string> {
  const snap = await db.collection("users").limit(50).get();
  for (const doc of snap.docs) {
    if (doc.id !== recipient) return doc.id;
  }
  throw new Error(
    "Could not auto-pick an actor user. Pass --actor=<firebaseUid> (must differ from recipient)."
  );
}

async function findRecipientPostId(db: Firestore, recipient: string): Promise<string | null> {
  for (const field of ["userId", "authorId", "ownerId"] as const) {
    const q = await db.collection("posts").where(field, "==", recipient).limit(1).get();
    if (!q.empty) return q.docs[0].id;
  }
  return null;
}

async function main(): Promise<void> {
  const { recipient, actor: actorArg, dryRun } = parseArgs(process.argv.slice(2));
  if (!recipient) {
    console.error("Usage: npx tsx scripts/seed-inbox-notifications.mts <recipientUserId> [--actor=uid] [--dry-run]");
    process.exitCode = 1;
    return;
  }

  if (!dryRun) {
    assertEmulatorOnlyDestructiveFirestoreOperation("seed-inbox-notifications", `users/${recipient}/notifications`);
    console.log(
      `EMULATOR_ONLY_SCRIPT_CONFIRMED operation=seed-inbox-notifications FIRESTORE_EMULATOR_HOST=${process.env.FIRESTORE_EMULATOR_HOST ?? ""} projectId=${process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? "unknown"}`
    );
  }

  const db = getFirestoreSourceClient();
  if (!db) {
    console.error("Firestore is not available. Set FIRESTORE / Firebase admin credentials.");
    process.exitCode = 1;
    return;
  }

  const recSnap = await db.collection("users").doc(recipient).get();
  if (!recSnap.exists) {
    console.error(`Recipient user not found: ${recipient}`);
    process.exitCode = 1;
    return;
  }

  const actorId = actorArg ?? (await pickActorId(db, recipient));
  if (actorId === recipient) {
    console.error("Actor must be a different user than recipient.");
    process.exitCode = 1;
    return;
  }

  const actorSnap = await db.collection("users").doc(actorId).get();
  if (!actorSnap.exists) {
    console.error(`Actor user not found: ${actorId}`);
    process.exitCode = 1;
    return;
  }

  const postId = await findRecipientPostId(db, recipient);
  const suffix = Date.now();
  const actorData = (actorSnap.data() ?? {}) as Record<string, unknown>;
  const chatMeta = actorPushMetadata(actorData);

  process.env.VITEST = "true";
  const svc = new NotificationsService(notificationsRepository);

  const scenarios: Array<{ label: string; fn: () => Promise<void> }> = [
    {
      label: "follow",
      fn: async () => {
        await svc.createFromMutation({
          type: "follow",
          actorId,
          recipientUserId: recipient,
          targetId: recipient,
        });
      },
    },
    ...(postId
      ? ([
          {
            label: "like",
            fn: async () => {
              await svc.createFromMutation({
                type: "like",
                actorId,
                recipientUserId: recipient,
                targetId: postId,
              });
            },
          },
          {
            label: "comment",
            fn: async () => {
              await svc.createFromMutation({
                type: "comment",
                actorId,
                recipientUserId: recipient,
                targetId: postId,
                commentId: `seed_comment_${suffix}`,
                metadata: {
                  commentText: "[seed] Test comment notification — not a real comment.",
                },
              });
            },
          },
          {
            label: "mention",
            fn: async () => {
              await svc.createFromMutation({
                type: "mention",
                actorId,
                recipientUserId: recipient,
                targetId: postId,
                commentId: `seed_mention_${suffix}`,
                message: "[seed] mentioned you in a post.",
              });
            },
          },
        ] as Array<{ label: string; fn: () => Promise<void> }>)
      : []),
    {
      label: "chat",
      fn: async () => {
        await svc.createFromMutation({
          type: "chat",
          actorId,
          recipientUserId: recipient,
          targetId: `seed_dm_${suffix}`,
          message: "[seed] Test chat push — no real chat message was written.",
          metadata: chatMeta,
        });
      },
    },
  ];

  console.log(
    JSON.stringify(
      {
        recipientUserId: recipient,
        actorUserId: actorId,
        postIdUsed: postId,
        dryRun,
        steps: scenarios.map((s) => s.label),
      },
      null,
      2
    )
  );

  if (dryRun) {
    return;
  }

  if (!postId) {
    console.warn(
      "[warn] No post owned by recipient found (userId/authorId/ownerId). Skipped like, comment, mention."
    );
  }

  const results: Array<{ label: string; ok: boolean; error?: string }> = [];
  for (const step of scenarios) {
    try {
      await step.fn();
      results.push({ label: step.label, ok: true });
      console.log(`[ok] ${step.label}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ label: step.label, ok: false, error: msg });
      console.error(`[err] ${step.label}: ${msg}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(JSON.stringify({ finished: true, results }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
