import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { FeedFirestoreAdapter } from "../../repositories/source-of-truth/feed-firestore.adapter.js";
import { ProfileFirestoreAdapter, parseProfileGridCursor } from "../../repositories/source-of-truth/profile-firestore.adapter.js";
import { SearchUsersFirestoreAdapter } from "../../repositories/source-of-truth/search-users-firestore.adapter.js";
import { chatsRepository } from "../../repositories/surfaces/chats.repository.js";
import { isLocalDevIdentityModeEnabled, resolveLocalDebugViewerId, resolveLocalDevIdentityContext } from "../../lib/local-dev-identity.js";

type ProbeResult = {
  ok: boolean;
  routeName: string;
  queryFamily: string;
  context: {
    projectId: string | null;
    credentialMode: "service_account_env" | "application_default" | "none";
  };
  firestoreReached: boolean;
  status: "success" | "error";
  error?: { code: string; message: string };
  timingMs: number;
  dbReads: number;
  dbQueries: number;
  payloadSummary: Record<string, unknown>;
  canonicalExpectation: "likely_should_work" | "likely_blocked" | "indeterminate";
  notes: string[];
  effectiveViewerId?: string;
  localDevIdentityModeUsed?: boolean;
};

function credentialMode(): "service_account_env" | "application_default" | "none" {
  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) return "service_account_env";
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return "application_default";
  return "none";
}

function classifyErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("PERMISSION_DENIED")) return "PERMISSION_DENIED";
  if (message.includes("firestore_source_unavailable")) return "FIRESTORE_SOURCE_UNAVAILABLE";
  if (message.includes("timeout")) return "TIMEOUT";
  if (message.includes("index")) return "MISSING_INDEX";
  return "OTHER";
}

async function runProbe(
  routeName: string,
  queryFamily: string,
  run: () => Promise<{
    firestoreReached: boolean;
    dbReads: number;
    dbQueries: number;
    payloadSummary: Record<string, unknown>;
    notes?: string[];
    effectiveViewerId?: string;
    localDevIdentityModeUsed?: boolean;
  }>
): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const result = await run();
    return {
      ok: true,
      routeName,
      queryFamily,
      context: {
        projectId: process.env.GCP_PROJECT_ID ?? process.env.FIREBASE_PROJECT_ID ?? null,
        credentialMode: credentialMode()
      },
      firestoreReached: result.firestoreReached,
      status: "success",
      timingMs: Date.now() - started,
      dbReads: result.dbReads,
      dbQueries: result.dbQueries,
      payloadSummary: result.payloadSummary,
      canonicalExpectation: result.firestoreReached ? "likely_should_work" : "indeterminate",
      notes: result.notes ?? [],
      effectiveViewerId: result.effectiveViewerId ?? resolveLocalDebugViewerId(),
      localDevIdentityModeUsed: result.localDevIdentityModeUsed ?? isLocalDevIdentityModeEnabled()
    };
  } catch (error) {
    return {
      ok: false,
      routeName,
      queryFamily,
      context: {
        projectId: process.env.GCP_PROJECT_ID ?? process.env.FIREBASE_PROJECT_ID ?? null,
        credentialMode: credentialMode()
      },
      firestoreReached: false,
      status: "error",
      error: {
        code: classifyErrorCode(error),
        message: error instanceof Error ? error.message : String(error)
      },
      timingMs: Date.now() - started,
      dbReads: 0,
      dbQueries: 0,
      payloadSummary: {},
      canonicalExpectation: "likely_blocked",
      notes: ["temporary_public_probe_route", "local_dev_only"],
      localDevIdentityModeUsed: isLocalDevIdentityModeEnabled()
    };
  }
}

export async function registerPublicFirestoreProbeRoutes(app: FastifyInstance): Promise<void> {
  if (app.config.NODE_ENV === "production" || !app.config.ENABLE_PUBLIC_FIRESTORE_PROBE || !isLocalDevIdentityModeEnabled()) {
    return;
  }

  const feedAdapter = new FeedFirestoreAdapter();
  const profileAdapter = new ProfileFirestoreAdapter();
  const searchAdapter = new SearchUsersFirestoreAdapter();

  app.get("/debug/public-firestore/feed/bootstrap", async (request) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(4).max(20).optional(),
        tab: z.enum(["explore", "following"]).optional()
      })
      .parse(request.query);
    return runProbe("public_firestore_feed_bootstrap", "posts.orderBy(time desc)", async () => {
      const identity = resolveLocalDevIdentityContext();
      const tab = query.tab ?? "explore";
      const page = await feedAdapter.getFeedCandidatesPage({
        viewerId: identity.viewerId,
        tab,
        cursorOffset: 0,
        limit: query.limit ?? 8
      });
      return {
        firestoreReached: true,
        dbReads: page.readCount,
        dbQueries: page.queryCount,
        payloadSummary: {
          count: page.items.length,
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
          tab,
          sampleSlots: page.items.slice(0, 5).map((x) => x.slot),
          samplePosts: page.items.slice(0, 5).map((x) => ({ postId: x.postId, authorId: x.authorId, slot: x.slot }))
        },
        effectiveViewerId: identity.viewerId,
        localDevIdentityModeUsed: isLocalDevIdentityModeEnabled()
      };
    });
  });

  app.get("/debug/public-firestore/feed/page", async (request) => {
    const query = z
      .object({
        cursorOffset: z.coerce.number().int().min(0).optional(),
        limit: z.coerce.number().int().min(4).max(20).optional(),
        tab: z.enum(["explore", "following"]).optional()
      })
      .parse(request.query);
    return runProbe("public_firestore_feed_page", "posts.orderBy(time desc)", async () => {
      const identity = resolveLocalDevIdentityContext();
      const tab = query.tab ?? "explore";
      const page = await feedAdapter.getFeedCandidatesPage({
        viewerId: identity.viewerId,
        tab,
        cursorOffset: query.cursorOffset ?? 8,
        limit: query.limit ?? 8
      });
      return {
        firestoreReached: true,
        dbReads: page.readCount,
        dbQueries: page.queryCount,
        payloadSummary: {
          count: page.items.length,
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
          tab,
          samplePosts: page.items.slice(0, 5).map((x) => ({ postId: x.postId, authorId: x.authorId, slot: x.slot }))
        },
        effectiveViewerId: identity.viewerId,
        localDevIdentityModeUsed: isLocalDevIdentityModeEnabled()
      };
    });
  });

  app.get("/debug/public-firestore/profile/bootstrap/:userId", async (request) => {
    const params = z.object({ userId: z.string().min(1) }).parse(request.params);
    const identity = resolveLocalDevIdentityContext();
    return runProbe("public_firestore_profile_bootstrap", "users.doc + users/:viewer/following", async () => {
      const header = await profileAdapter.getProfileHeader(params.userId);
      const rel = await profileAdapter.getRelationship(identity.viewerId, params.userId);
      return {
        firestoreReached: true,
        dbReads: header.readCount + rel.readCount,
        dbQueries: header.queryCount + rel.queryCount,
        payloadSummary: { userId: header.data.userId, handle: header.data.handle, counts: header.data.counts, relationship: rel.data },
        notes: [`effectiveViewerId=${identity.viewerId}`]
      };
    });
  });

  app.get("/debug/public-firestore/profile/grid/:userId", async (request) => {
    const params = z.object({ userId: z.string().min(1) }).parse(request.params);
    const query = z.object({ cursor: z.string().nullable().optional(), limit: z.coerce.number().int().min(1).max(24).optional() }).parse(request.query);
    return runProbe("public_firestore_profile_grid", "posts.where(userId).orderBy(time)", async () => {
      const cursor = parseProfileGridCursor(query.cursor ?? null);
      const page = await profileAdapter.getGridPage(params.userId, cursor, query.limit ?? 12);
      return {
        firestoreReached: true,
        dbReads: page.readCount,
        dbQueries: page.queryCount,
        payloadSummary: { count: page.items.length, nextCursor: page.nextCursor, samplePostIds: page.items.slice(0, 5).map((x) => x.postId) }
      };
    });
  });

  app.get("/debug/public-firestore/search/users", async (request) => {
    const query = z.object({ q: z.string().min(1).default("jo"), limit: z.coerce.number().int().min(1).max(20).optional() }).parse(request.query);
    return runProbe("public_firestore_search_users", "users.searchHandle + users.searchName", async () => {
      const page = await searchAdapter.searchUsersPage({ query: query.q, cursorOffset: 0, limit: query.limit ?? 12 });
      return {
        firestoreReached: true,
        dbReads: page.readCount,
        dbQueries: page.queryCount,
        payloadSummary: { count: page.users.length, nextCursor: page.nextCursor, handles: page.users.slice(0, 5).map((x) => x.handle) }
      };
    });
  });

  app.get("/debug/public-firestore/search/results", async (request) => {
    const query = z.object({ q: z.string().min(1).default("food"), limit: z.coerce.number().int().min(1).max(20).optional() }).parse(request.query);
    const db = getFirestoreSourceClient();
    return runProbe("public_firestore_search_results", "posts.where(searchText range)", async () => {
      if (!db) throw new Error("firestore_source_unavailable");
      const low = query.q.toLowerCase();
      const hi = `${low}\uf8ff`;
      const snap = await db.collection("posts").where("searchText", ">=", low).where("searchText", "<=", hi).orderBy("searchText").limit(query.limit ?? 8).get();
      return {
        firestoreReached: true,
        dbReads: snap.docs.length,
        dbQueries: 1,
        payloadSummary: { count: snap.docs.length, postIds: snap.docs.slice(0, 5).map((d) => d.id), query: query.q }
      };
    });
  });

  app.get("/debug/public-firestore/directory/users", async (request) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(20).optional(), cursor: z.string().nullable().optional() }).parse(request.query);
    return runProbe("public_firestore_directory_users", "users.orderBy(searchHandle)", async () => {
      const page = await searchAdapter.suggestedUsersPage({ cursor: query.cursor ?? null, limit: query.limit ?? 10 });
      return {
        firestoreReached: true,
        dbReads: page.readCount,
        dbQueries: page.queryCount,
        payloadSummary: { count: page.users.length, hasMore: page.hasMore, nextCursor: page.nextCursor, sampleUserIds: page.users.slice(0, 5).map((x) => x.userId) }
      };
    });
  });

  app.get("/debug/public-firestore/chats/inbox/:viewerId", async (request) => {
    const params = z.object({ viewerId: z.string().min(1) }).parse(request.params);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(30).optional() }).parse(request.query);
    const identity = resolveLocalDevIdentityContext(params.viewerId);
    return runProbe("public_firestore_chats_inbox", "chats.where(participants array-contains)", async () => {
      const inbox = await chatsRepository.listInbox({ viewerId: identity.viewerId, cursor: null, limit: query.limit ?? 10 });
      return {
        firestoreReached: true,
        dbReads: inbox.items.length,
        dbQueries: 1,
        payloadSummary: { count: inbox.items.length, hasMore: inbox.hasMore, nextCursor: inbox.nextCursor, conversationIds: inbox.items.slice(0, 5).map((x) => x.conversationId) },
        notes: [`effectiveViewerId=${identity.viewerId}`]
      };
    });
  });

  app.get("/debug/public-firestore/chats/inbox", async (request) => {
    const query = z.object({ viewerId: z.string().min(1).optional(), limit: z.coerce.number().int().min(1).max(30).optional() }).parse(request.query);
    const identity = resolveLocalDevIdentityContext(query.viewerId);
    return runProbe("public_firestore_chats_inbox_defaulted", "chats.where(participants array-contains)", async () => {
      const inbox = await chatsRepository.listInbox({ viewerId: identity.viewerId, cursor: null, limit: query.limit ?? 10 });
      return {
        firestoreReached: true,
        dbReads: inbox.items.length,
        dbQueries: 1,
        payloadSummary: { count: inbox.items.length, hasMore: inbox.hasMore, nextCursor: inbox.nextCursor, conversationIds: inbox.items.slice(0, 5).map((x) => x.conversationId) },
        notes: [`effectiveViewerId=${identity.viewerId}`]
      };
    });
  });

  app.get("/debug/public-firestore/chats/thread/:conversationId", async (request) => {
    const params = z.object({ conversationId: z.string().min(1) }).parse(request.params);
    const query = z.object({ viewerId: z.string().min(1).optional(), limit: z.coerce.number().int().min(1).max(50).optional() }).parse(request.query);
    const identity = resolveLocalDevIdentityContext(query.viewerId);
    return runProbe("public_firestore_chats_thread", "chats/:id/messages.orderBy(timestamp)", async () => {
      const thread = await chatsRepository.listThreadMessages({
        viewerId: identity.viewerId,
        conversationId: params.conversationId,
        cursor: null,
        limit: query.limit ?? 15
      });
      return {
        firestoreReached: true,
        dbReads: thread.items.length,
        dbQueries: 1,
        payloadSummary: { count: thread.items.length, hasMore: thread.hasMore, nextCursor: thread.nextCursor, messageIds: thread.items.slice(0, 5).map((x) => x.messageId) },
        notes: [`effectiveViewerId=${identity.viewerId}`]
      };
    });
  });

  app.get("/debug/public-firestore/collections/list/:viewerId", async (request) => {
    const params = z.object({ viewerId: z.string().min(1) }).parse(request.params);
    const db = getFirestoreSourceClient();
    return runProbe("public_firestore_collections_list", "collections.where(ownerId)", async () => {
      if (!db) throw new Error("firestore_source_unavailable");
      const snap = await db.collection("collections").where("ownerId", "==", params.viewerId).orderBy("updatedAt", "desc").limit(20).get();
      return {
        firestoreReached: true,
        dbReads: snap.docs.length,
        dbQueries: 1,
        payloadSummary: { count: snap.docs.length, collectionIds: snap.docs.slice(0, 8).map((d) => d.id) }
      };
    });
  });

  app.get("/debug/public-firestore/collections/detail/:collectionId", async (request) => {
    const params = z.object({ collectionId: z.string().min(1) }).parse(request.params);
    const db = getFirestoreSourceClient();
    return runProbe("public_firestore_collections_detail", "collections.doc", async () => {
      if (!db) throw new Error("firestore_source_unavailable");
      const doc = await db.collection("collections").doc(params.collectionId).get();
      return {
        firestoreReached: true,
        dbReads: 1,
        dbQueries: 1,
        payloadSummary: { exists: doc.exists, id: doc.id, keys: Object.keys((doc.data() ?? {}) as Record<string, unknown>).slice(0, 20) }
      };
    });
  });

  app.get("/debug/public-firestore/map/bootstrap", async (request) => {
    const query = z.object({ limit: z.coerce.number().int().min(10).max(200).optional() }).parse(request.query);
    const db = getFirestoreSourceClient();
    return runProbe("public_firestore_map_bootstrap", "posts.orderBy(time)", async () => {
      if (!db) throw new Error("firestore_source_unavailable");
      const snap = await db.collection("posts").orderBy("time", "desc").select("location", "lat", "lng", "time").limit(query.limit ?? 80).get();
      return {
        firestoreReached: true,
        dbReads: snap.docs.length,
        dbQueries: 1,
        payloadSummary: { count: snap.docs.length, samplePostIds: snap.docs.slice(0, 10).map((d) => d.id) }
      };
    });
  });

  app.get("/debug/public-firestore/notifications/list/:viewerId", async (request) => {
    const params = z.object({ viewerId: z.string().min(1) }).parse(request.params);
    const db = getFirestoreSourceClient();
    return runProbe("public_firestore_notifications_list", "users/:id/notifications.orderBy(createdAt)", async () => {
      if (!db) throw new Error("firestore_source_unavailable");
      const snap = await db.collection("users").doc(params.viewerId).collection("notifications").orderBy("createdAt", "desc").limit(20).get();
      return {
        firestoreReached: true,
        dbReads: snap.docs.length,
        dbQueries: 1,
        payloadSummary: { count: snap.docs.length, notificationIds: snap.docs.slice(0, 10).map((d) => d.id) }
      };
    });
  });

  app.get("/debug/public-firestore/achievements/snapshot/:viewerId", async (request) => {
    const params = z.object({ viewerId: z.string().min(1) }).parse(request.params);
    const db = getFirestoreSourceClient();
    return runProbe("public_firestore_achievements_snapshot", "users/:id/achievements.doc(snapshot)", async () => {
      if (!db) throw new Error("firestore_source_unavailable");
      const doc = await db.collection("users").doc(params.viewerId).collection("achievements").doc("snapshot").get();
      return {
        firestoreReached: true,
        dbReads: 1,
        dbQueries: 1,
        payloadSummary: { exists: doc.exists, keys: Object.keys((doc.data() ?? {}) as Record<string, unknown>).slice(0, 20) }
      };
    });
  });

  app.post("/debug/public-firestore/chats/create-direct", async (request) => {
    const body = z.object({ viewerId: z.string().min(1).optional(), otherUserId: z.string().min(1) }).parse(request.body ?? {});
    const identity = resolveLocalDevIdentityContext(body.viewerId);
    return runProbe("public_firestore_chats_create_direct", "chats.create-or-get direct", async () => {
      const result = await chatsRepository.createOrGetDirectConversation({ viewerId: identity.viewerId, otherUserId: body.otherUserId });
      return {
        firestoreReached: true,
        dbReads: 1,
        dbQueries: 1,
        payloadSummary: result,
        notes: ["safe_mutation_probe", `effectiveViewerId=${identity.viewerId}`]
      };
    });
  });

  app.post("/debug/public-firestore/chats/send", async (request) => {
    const body = z.object({
      viewerId: z.string().min(1).optional(),
      conversationId: z.string().min(1),
      text: z.string().min(1).max(300).default("debug public probe message")
    }).parse(request.body ?? {});
    const identity = resolveLocalDevIdentityContext(body.viewerId);
    return runProbe("public_firestore_chats_send", "chats/:id/messages.create", async () => {
      const sent = await chatsRepository.sendMessage({
        viewerId: identity.viewerId,
        conversationId: body.conversationId,
        messageType: "text",
        text: body.text,
        photoUrl: null,
        gifUrl: null,
        postId: null,
        replyingToMessageId: null,
        clientMessageId: `public-probe-${Date.now()}`
      });
      return {
        firestoreReached: true,
        dbReads: 1,
        dbQueries: 1,
        payloadSummary: { idempotent: sent.idempotent, messageId: sent.message.messageId },
        notes: [`effectiveViewerId=${identity.viewerId}`]
      };
    });
  });

  app.post("/debug/public-firestore/posts/like", async (request) => {
    const body = z.object({ viewerId: z.string().min(1).optional(), postId: z.string().min(1) }).parse(request.body ?? {});
    const identity = resolveLocalDevIdentityContext(body.viewerId);
    const db = getFirestoreSourceClient();
    return runProbe("public_firestore_posts_like_probe", "probe_mutations.posts_like", async () => {
      if (!db) throw new Error("firestore_source_unavailable");
      await db.collection("debug_public_probe_mutations").add({
        kind: "post_like_probe",
        viewerId: identity.viewerId,
        postId: body.postId,
        createdAt: Timestamp.now()
      });
      return {
        firestoreReached: true,
        dbReads: 0,
        dbQueries: 1,
        payloadSummary: { accepted: true, mode: "validation_probe_write_only" },
        notes: ["does_not_touch_real_like_counters", `effectiveViewerId=${identity.viewerId}`]
      };
    });
  });

  app.post("/debug/public-firestore/posts/save", async (request) => {
    const body = z.object({ viewerId: z.string().min(1).optional(), postId: z.string().min(1) }).parse(request.body ?? {});
    const identity = resolveLocalDevIdentityContext(body.viewerId);
    const db = getFirestoreSourceClient();
    return runProbe("public_firestore_posts_save_probe", "probe_mutations.posts_save", async () => {
      if (!db) throw new Error("firestore_source_unavailable");
      await db.collection("debug_public_probe_mutations").add({
        kind: "post_save_probe",
        viewerId: identity.viewerId,
        postId: body.postId,
        createdAt: Timestamp.now()
      });
      return {
        firestoreReached: true,
        dbReads: 0,
        dbQueries: 1,
        payloadSummary: { accepted: true, mode: "validation_probe_write_only" },
        notes: ["does_not_touch_real_save_counters", `effectiveViewerId=${identity.viewerId}`]
      };
    });
  });

  app.post("/debug/public-firestore/comments/create", async (request) => {
    const body = z.object({ viewerId: z.string().min(1).optional(), postId: z.string().min(1), text: z.string().min(1).max(200).default("public probe comment") }).parse(request.body ?? {});
    const identity = resolveLocalDevIdentityContext(body.viewerId);
    const db = getFirestoreSourceClient();
    return runProbe("public_firestore_comments_create_probe", "probe_mutations.comments_create", async () => {
      if (!db) throw new Error("firestore_source_unavailable");
      await db.collection("debug_public_probe_mutations").add({
        kind: "comment_create_probe",
        viewerId: identity.viewerId,
        postId: body.postId,
        text: body.text,
        createdAt: Timestamp.now()
      });
      return {
        firestoreReached: true,
        dbReads: 0,
        dbQueries: 1,
        payloadSummary: { accepted: true, mode: "validation_probe_write_only" },
        notes: ["does_not_create_real_post_comment", `effectiveViewerId=${identity.viewerId}`]
      };
    });
  });

  app.post("/debug/public-firestore/collections/create", async (request) => {
    const body = z.object({ viewerId: z.string().min(1).optional(), name: z.string().min(1).default(`Public Probe ${Date.now()}`) }).parse(request.body ?? {});
    const identity = resolveLocalDevIdentityContext(body.viewerId);
    const db = getFirestoreSourceClient();
    return runProbe("public_firestore_collections_create", "collections.add", async () => {
      if (!db) throw new Error("firestore_source_unavailable");
      const ref = await db.collection("collections").add({
        ownerId: identity.viewerId,
        name: body.name,
        description: "Temporary local public firestore probe collection",
        privacy: "private",
        items: [],
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        isPublicProbe: true
      });
      return {
        firestoreReached: true,
        dbReads: 0,
        dbQueries: 1,
        payloadSummary: { collectionId: ref.id, created: true },
        notes: ["safe_real_collection_write", "tagged_isPublicProbe=true", `effectiveViewerId=${identity.viewerId}`]
      };
    });
  });

  app.post("/debug/public-firestore/collections/update", async (request) => {
    const body = z.object({ collectionId: z.string().min(1), description: z.string().min(1).max(200).default(`updated via probe ${Date.now()}`) }).parse(request.body ?? {});
    const db = getFirestoreSourceClient();
    return runProbe("public_firestore_collections_update", "collections.doc.update", async () => {
      if (!db) throw new Error("firestore_source_unavailable");
      await db.collection("collections").doc(body.collectionId).update({
        description: body.description,
        updatedAt: Timestamp.now(),
        publicProbeUpdatedAt: Timestamp.now()
      });
      return {
        firestoreReached: true,
        dbReads: 0,
        dbQueries: 1,
        payloadSummary: { collectionId: body.collectionId, updated: true }
      };
    });
  });

  app.post("/debug/public-firestore/posting/finalize-check", async () => {
    const db = getFirestoreSourceClient();
    return runProbe("public_firestore_posting_finalize_check", "posting_sessions.recent_read_only", async () => {
      if (!db) throw new Error("firestore_source_unavailable");
      const snap = await db.collection("posting_sessions").orderBy("updatedAt", "desc").limit(5).get();
      return {
        firestoreReached: true,
        dbReads: snap.docs.length,
        dbQueries: 1,
        payloadSummary: {
          count: snap.docs.length,
          sampleSessionIds: snap.docs.map((d) => d.id),
          note: "read-only finalize path validation"
        }
      };
    });
  });

  app.log.warn("TEMPORARY /debug/public-firestore routes enabled for local probing with local-dev identity mode");
}
