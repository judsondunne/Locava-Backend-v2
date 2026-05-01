import { getApps, initializeApp, applicationDefault, cert, getApp, deleteApp, type App } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../../config/env.js";

let firestoreInstance: Firestore | null | undefined;
let loggedTestMode: string | null = null;
let firestoreSettingsApplied = false;
let firestoreWarmupPromise: Promise<void> | null = null;
let firestoreWriteWarmupPromise: Promise<void> | null = null;
let initIdentity: {
  projectId: string | null;
  credentialType: "service_account_env" | "service_account_file" | "application_default" | "none";
  serviceAccountEmail: string | null;
  credentialsLoaded: boolean;
  credentialPath: string | null;
} = {
  projectId: null,
  credentialType: "none",
  serviceAccountEmail: null,
  credentialsLoaded: false,
  credentialPath: null
};

const TEST_FIRESTORE_PROJECT_ID = "demo-locava-backendv2";

function hasServiceAccountEnv(): boolean {
  return Boolean(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY);
}

function shouldEnableFirestore(): boolean {
  const env = loadEnv();
  if (!env.FIRESTORE_SOURCE_ENABLED) {
    return false;
  }
  return true;
}

function resolveFirestoreTestMode(): "emulator" | "mock" | "disabled" | null {
  const env = loadEnv();
  if (env.NODE_ENV !== "test") return null;
  const mode = env.FIRESTORE_TEST_MODE;
  if (!mode) {
    throw new Error(
      "firestore_test_mode_required:Set FIRESTORE_TEST_MODE=emulator|mock|disabled for deterministic Backendv2 tests"
    );
  }
  if ((mode === "disabled" || mode === "mock")) {
    if (loggedTestMode !== mode) {
      loggedTestMode = mode;
      console.info(`[firestore-test-mode] ${mode}`);
    }
    return mode;
  }
  if (mode !== "emulator" && process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
    throw new Error(
      `firestore_test_mode_${mode}_refuses_live_credentials:unset GOOGLE_APPLICATION_CREDENTIALS or use FIRESTORE_TEST_MODE=emulator`
    );
  }
  if (mode === "emulator" && !process.env.FIRESTORE_EMULATOR_HOST?.trim()) {
    throw new Error(
      "firestore_test_mode_emulator_requires_host:Set FIRESTORE_EMULATOR_HOST and run under the Firestore emulator"
    );
  }
  if (loggedTestMode !== mode) {
    loggedTestMode = mode;
    console.info(`[firestore-test-mode] ${mode}`);
  }
  return mode;
}

function stripWrappingQuotes(value: string | undefined): string | undefined {
  if (!value) return value;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function resolveCredentialPath(): string | null {
  const fromEnv = stripWrappingQuotes(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const legacyPath = path.resolve(process.cwd(), "..", "Locava Backend", ".secrets", "learn-32d72-13d7a236a08e.json");
  if (fs.existsSync(legacyPath)) return legacyPath;
  return null;
}

function initializeFirebaseAdminApp(): App {
  if (getApps().length > 0) {
    return getApp();
  }

  if (resolveFirestoreTestMode() === "emulator") {
    process.env.GCP_PROJECT_ID = TEST_FIRESTORE_PROJECT_ID;
    process.env.FIREBASE_PROJECT_ID = TEST_FIRESTORE_PROJECT_ID;
    const projectId = TEST_FIRESTORE_PROJECT_ID;
    initIdentity = {
      projectId,
      credentialType: "application_default",
      serviceAccountEmail: null,
      credentialsLoaded: false,
      credentialPath: null
    };
    return initializeApp({ projectId });
  }

  if (hasServiceAccountEnv()) {
    initIdentity = {
      projectId: process.env.FIREBASE_PROJECT_ID ?? process.env.GCP_PROJECT_ID ?? null,
      credentialType: "service_account_env",
      serviceAccountEmail: process.env.FIREBASE_CLIENT_EMAIL ?? null,
      credentialsLoaded: true,
      credentialPath: null
    };
    return initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")
      }),
      projectId: process.env.FIREBASE_PROJECT_ID ?? process.env.GCP_PROJECT_ID
    });
  }

  const credentialPath = resolveCredentialPath();
  if (credentialPath) {
    const raw = fs.readFileSync(credentialPath, "utf8");
    const parsed = JSON.parse(raw) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      throw new Error("service_account_file_invalid");
    }
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath;
    if (!process.env.GCP_PROJECT_ID) process.env.GCP_PROJECT_ID = parsed.project_id;
    if (!process.env.FIREBASE_PROJECT_ID) process.env.FIREBASE_PROJECT_ID = parsed.project_id;
    initIdentity = {
      projectId: parsed.project_id ?? null,
      credentialType: "service_account_file",
      serviceAccountEmail: parsed.client_email ?? null,
      credentialsLoaded: true,
      credentialPath
    };
    return initializeApp({
      credential: cert({
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key
      }),
      projectId: parsed.project_id
    });
  }

  initIdentity = {
    projectId: process.env.GCP_PROJECT_ID ?? process.env.FIREBASE_PROJECT_ID ?? null,
    credentialType: "application_default",
    serviceAccountEmail: null,
    credentialsLoaded: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS),
    credentialPath: stripWrappingQuotes(process.env.GOOGLE_APPLICATION_CREDENTIALS) ?? null
  };
  return initializeApp({
    credential: applicationDefault(),
    projectId: process.env.GCP_PROJECT_ID ?? process.env.FIREBASE_PROJECT_ID
  });
}

export function getFirestoreAdminIdentity(): typeof initIdentity {
  return { ...initIdentity };
}

export async function resetFirestoreSourceClientForTests(): Promise<void> {
  firestoreInstance = undefined;
  loggedTestMode = null;
  firestoreSettingsApplied = false;
  firestoreWarmupPromise = null;
  firestoreWriteWarmupPromise = null;
  initIdentity = {
    projectId: null,
    credentialType: "none",
    serviceAccountEmail: null,
    credentialsLoaded: false,
    credentialPath: null
  };
  await Promise.all(getApps().map((app) => deleteApp(app).catch(() => undefined)));
}

export function getFirestoreSourceClient(): Firestore | null {
  if (firestoreInstance !== undefined) {
    return firestoreInstance;
  }
  const testMode = resolveFirestoreTestMode();
  if (testMode === "mock") {
    throw new Error("firestore_test_mode_mock_requires_injected_double");
  }
  if (testMode === "disabled") {
    initIdentity = {
      projectId: TEST_FIRESTORE_PROJECT_ID,
      credentialType: "none",
      serviceAccountEmail: null,
      credentialsLoaded: false,
      credentialPath: null
    };
    firestoreInstance = null;
    return firestoreInstance;
  }
  if (!shouldEnableFirestore()) {
    firestoreInstance = null;
    return firestoreInstance;
  }

  try {
    if (testMode === "emulator") {
      process.env.GCP_PROJECT_ID = TEST_FIRESTORE_PROJECT_ID;
      process.env.FIREBASE_PROJECT_ID = TEST_FIRESTORE_PROJECT_ID;
      initIdentity = {
        projectId: TEST_FIRESTORE_PROJECT_ID,
        credentialType: "application_default",
        serviceAccountEmail: null,
        credentialsLoaded: false,
        credentialPath: null
      };
    }
    initializeFirebaseAdminApp();
    const db = getFirestore();
    if (!firestoreSettingsApplied) {
      try {
        db.settings({ ignoreUndefinedProperties: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("Firestore has already been initialized")) {
          throw error;
        }
      }
      firestoreSettingsApplied = true;
    }
    firestoreInstance = db;
    return firestoreInstance;
  } catch {
    if (initIdentity.credentialType === "none") {
      initIdentity = {
        projectId: process.env.GCP_PROJECT_ID ?? process.env.FIREBASE_PROJECT_ID ?? null,
        credentialType: "none",
        serviceAccountEmail: null,
        credentialsLoaded: false,
        credentialPath: stripWrappingQuotes(process.env.GOOGLE_APPLICATION_CREDENTIALS) ?? null
      };
    }
    firestoreInstance = null;
    return firestoreInstance;
  }
}

export function primeFirestoreSourceClient(): Promise<void> {
  if (firestoreWarmupPromise) {
    return firestoreWarmupPromise;
  }
  const db = getFirestoreSourceClient();
  if (!db) {
    firestoreWarmupPromise = Promise.resolve();
    return firestoreWarmupPromise;
  }
  firestoreWarmupPromise = (async () => {
    const usersSnap = await db.collection("users").limit(1).get();
    const firstUserId = usersSnap.docs[0]?.id;
    if (firstUserId) {
      await db.collection("users").doc(firstUserId).collection("following").limit(1).get();
      return;
    }
    await db.collection("__backendv2_warmup__").limit(1).get();
  })().catch(() => undefined);
  return firestoreWarmupPromise;
}

export function primeFirestoreMutationChannel(): Promise<void> {
  if (firestoreWriteWarmupPromise) {
    return firestoreWriteWarmupPromise;
  }
  const db = getFirestoreSourceClient();
  if (!db) {
    firestoreWriteWarmupPromise = Promise.resolve();
    return firestoreWriteWarmupPromise;
  }
  firestoreWriteWarmupPromise = (async () => {
    const warmupRef = db.collection("__backendv2_warmup__").doc("mutation-channel");
    const createProbeRef = warmupRef.collection("create-probes").doc("follow-create");
    const followViewerId = "__backendv2_warmup_viewer__";
    const followTargetId = "__backendv2_warmup_target__";
    const savedProbePostId = "__backendv2_warmup_saved_post__";
    const commentProbePostId = "__backendv2_warmup_comment_post__";
    const commentProbeId = "__backendv2_warmup_comment__";
    const followingProbeRef = db.collection("users").doc(followViewerId).collection("following").doc(followTargetId);
    const followerProbeRef = db.collection("users").doc(followTargetId).collection("followers").doc(followViewerId);
    const collectionProbeRef = db.collection("collections").doc("__backendv2_warmup_collection__");
    const collectionPostEdgeProbeRef = collectionProbeRef.collection("posts").doc(savedProbePostId);
    const savedCollectionProbeRef = db.collection("collections").doc(`saved-${followViewerId}`);
    const commentPostRef = db.collection("posts").doc(commentProbePostId);
    const commentSubcollectionRef = commentPostRef.collection("comments").doc(commentProbeId);
    const achievementsStateRef = db.collection("users").doc(followViewerId).collection("achievements").doc("state");
    const notificationUserRef = db.collection("users").doc(followViewerId);
    const notificationProbeRef = notificationUserRef.collection("notifications").doc("__backendv2_warmup_notification__");
    const chatProbeRef = db.collection("chats").doc("__backendv2_warmup_chat__");
    const embeddedCommentWire = {
      id: commentProbeId,
      content: "Warmup comment",
      text: "Warmup comment",
      userName: "Warmup User",
      userPic: "",
      userId: followViewerId,
      userHandle: "warmup-user",
      likedBy: [] as string[],
      createdAtMs: Date.now(),
      postId: commentProbePostId
    };
    const likedEmbeddedCommentWire = {
      ...embeddedCommentWire,
      likedBy: [followViewerId]
    };
    await warmupRef.set(
      {
        lastPrimedAt: FieldValue.serverTimestamp(),
        warmupWriteCount: FieldValue.increment(1),
        warmupArray: []
      },
      { merge: true }
    );
    await warmupRef.update({
      warmupArray: FieldValue.arrayUnion("prime")
    });
    await warmupRef.update({
      warmupArray: FieldValue.arrayRemove("prime")
    });
    try {
      await createProbeRef.create({
        createdAt: FieldValue.serverTimestamp()
      });
    } catch {
      await createProbeRef.set(
        {
          createdAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    }
    await createProbeRef.delete().catch(() => undefined);
    const followingPayload = {
      userId: followTargetId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };
    const followerPayload = {
      userId: followViewerId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };
    try {
      await followingProbeRef.create(followingPayload);
    } catch {
      await followingProbeRef.set(followingPayload, { merge: true });
    }
    try {
      await followerProbeRef.create(followerPayload);
    } catch {
      await followerProbeRef.set(followerPayload, { merge: true });
    }
    try {
      await collectionProbeRef.create({
        ownerId: followViewerId,
        userId: followViewerId,
        name: "Warmup Collection",
        description: "",
        privacy: "private",
        isPublic: false,
        collaborators: [followViewerId],
        items: [],
        itemsCount: 0,
        displayPhotoUrl: "",
        color: "",
        lastContentActivityAtMs: Date.now(),
        lastContentActivityByUserId: followViewerId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
    } catch {
      await collectionProbeRef.set(
        {
          ownerId: followViewerId,
          userId: followViewerId,
          name: "Warmup Collection",
          description: "",
          privacy: "private",
          isPublic: false,
          collaborators: [followViewerId],
          items: [],
          itemsCount: 0,
          displayPhotoUrl: "",
          color: "",
          lastContentActivityAtMs: Date.now(),
          lastContentActivityByUserId: followViewerId,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    }
    await savedCollectionProbeRef.set(
      {
        ownerId: followViewerId,
        userId: followViewerId,
        name: "Saved",
        description: "",
        privacy: "private",
        isPublic: false,
        collaborators: [followViewerId],
        items: [],
        itemsCount: 0,
        lastContentActivityAtMs: Date.now(),
        lastContentActivityByUserId: followViewerId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    await savedCollectionProbeRef.set(
      {
        items: FieldValue.arrayUnion(savedProbePostId),
        lastContentActivityAtMs: Date.now(),
        lastContentActivityByUserId: followViewerId,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    await savedCollectionProbeRef.set(
      {
        items: FieldValue.arrayRemove(savedProbePostId),
        lastContentActivityAtMs: Date.now(),
        lastContentActivityByUserId: followViewerId,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    await collectionProbeRef.update({
      items: FieldValue.arrayUnion(savedProbePostId),
      itemsCount: 1,
      lastContentActivityAtMs: Date.now(),
      lastContentActivityByUserId: followViewerId,
      updatedAt: FieldValue.serverTimestamp()
    });
    await collectionProbeRef.update({
      items: FieldValue.arrayRemove(savedProbePostId),
      itemsCount: 0,
      lastContentActivityAtMs: Date.now(),
      lastContentActivityByUserId: followViewerId,
      updatedAt: FieldValue.serverTimestamp()
    });
    const collectionEdgeBatch = db.batch();
    collectionEdgeBatch.create(collectionPostEdgeProbeRef, {
      postId: savedProbePostId,
      addedAt: FieldValue.serverTimestamp()
    });
    collectionEdgeBatch.update(collectionProbeRef, {
      itemsCount: FieldValue.increment(1),
      lastContentActivityAtMs: Date.now(),
      lastContentActivityByUserId: followViewerId,
      updatedAt: FieldValue.serverTimestamp()
    });
    await collectionEdgeBatch.commit().catch(() => undefined);
    await collectionPostEdgeProbeRef.delete().catch(() => undefined);
    await collectionProbeRef.set(
      {
        itemsCount: 0,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    await chatProbeRef.set(
      {
        members: [followViewerId, followTargetId],
        manualUnreadBy: [],
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    await chatProbeRef.update({
      manualUnreadBy: FieldValue.arrayUnion(followViewerId)
    });
    await chatProbeRef.update({
      manualUnreadBy: FieldValue.arrayRemove(followViewerId)
    });
    const groupChatWarmRef = await db.collection("chats").add({
      participants: [followViewerId, followTargetId],
      groupName: "Warmup Group",
      displayPhotoURL: null,
      createdAt: Timestamp.now(),
      manualUnreadBy: [],
      lastMessageTime: Timestamp.now()
    });
    await groupChatWarmRef.delete().catch(() => undefined);
    await notificationProbeRef.set(
      {
        id: "__backendv2_warmup_notification__",
        userId: followViewerId,
        type: "system",
        title: "Warmup notification",
        body: "Warmup notification",
        read: false,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now()
      },
      { merge: true }
    );
    await db.getAll(notificationProbeRef).catch(() => undefined);
    const notificationMarkReadBatch = db.batch();
    notificationMarkReadBatch.update(notificationProbeRef, {
      read: true,
      readAt: Timestamp.now(),
      updatedAtMs: Date.now()
    });
    await notificationMarkReadBatch.commit().catch(() => undefined);
    await notificationProbeRef.set(
      {
        read: false,
        readAt: null,
        updatedAtMs: Date.now()
      },
      { merge: true }
    );
    await notificationUserRef.collection("notifications").where("read", "==", false).count().get().catch(() => undefined);
    await notificationUserRef.set(
      {
        unreadCount: 0,
        unreadNotificationCount: 0,
        notificationUnreadCount: 0,
        notifUnread: 0,
        notificationsReadAllAtMs: Date.now(),
        notificationsMarkedReadThroughMs: Date.now()
      },
      { merge: true }
    );
    await commentPostRef.set(
      {
        comments: [embeddedCommentWire],
        commentCount: 1,
        commentsCount: 1,
        likeCount: 0,
        likesCount: 0,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    const postLikeProbeRef = commentPostRef.collection("likes").doc(followViewerId);
    const postLikeWarmBatch = db.batch();
    const postLikeWarmNow = new Date();
    postLikeWarmBatch.create(postLikeProbeRef, {
      userId: followViewerId,
      createdAt: postLikeWarmNow,
      updatedAt: postLikeWarmNow
    });
    postLikeWarmBatch.update(commentPostRef, {
      likeCount: FieldValue.increment(1),
      likesCount: FieldValue.increment(1),
      updatedAt: postLikeWarmNow,
      lastUpdated: postLikeWarmNow
    });
    await postLikeWarmBatch.commit().catch(() => undefined);
    const postUnlikeWarmBatch = db.batch();
    const postUnlikeWarmNow = new Date();
    postUnlikeWarmBatch.delete(postLikeProbeRef);
    postUnlikeWarmBatch.set(
      commentPostRef,
      {
        likeCount: FieldValue.increment(-1),
        likesCount: FieldValue.increment(-1),
        updatedAt: postUnlikeWarmNow,
        lastUpdated: postUnlikeWarmNow
      },
      { merge: true }
    );
    await postUnlikeWarmBatch.commit().catch(() => undefined);
    await commentSubcollectionRef.set(
      {
        ...embeddedCommentWire,
        likedBy: []
      },
      { merge: true }
    );
    await commentSubcollectionRef.update({
      likedBy: FieldValue.arrayUnion(followViewerId)
    });
    await commentSubcollectionRef.update({
      likedBy: FieldValue.arrayRemove(followViewerId)
    });
    await commentPostRef.set(
      {
        comments: FieldValue.arrayRemove(embeddedCommentWire),
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    await commentPostRef.set(
      {
        comments: FieldValue.arrayUnion(likedEmbeddedCommentWire),
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    const deleteBatch = db.batch();
    deleteBatch.delete(commentSubcollectionRef);
    deleteBatch.set(
      commentPostRef,
      {
        comments: FieldValue.arrayRemove(likedEmbeddedCommentWire),
        commentCount: FieldValue.increment(-1),
        commentsCount: FieldValue.increment(-1),
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    await deleteBatch.commit();
    await achievementsStateRef.set(
      {
        pendingLeaderboardPassedEvents: [
          {
            eventId: "__backendv2_warmup_leaderboard_event__",
            leagueId: null,
            scope: "global"
          }
        ],
        updatedAt: new Date()
      },
      { merge: true }
    );
    await achievementsStateRef.set(
      {
        pendingLeaderboardPassedEvents: [],
        updatedAt: new Date()
      },
      { merge: true }
    );
    await followingProbeRef.delete().catch(() => undefined);
    await followerProbeRef.delete().catch(() => undefined);
    await chatProbeRef.delete().catch(() => undefined);
    await collectionProbeRef.delete().catch(() => undefined);
    await notificationProbeRef.delete().catch(() => undefined);
    await commentPostRef.delete().catch(() => undefined);
  })()
    .then(() => undefined)
    .catch(() => undefined);
  return firestoreWriteWarmupPromise ?? Promise.resolve();
}
