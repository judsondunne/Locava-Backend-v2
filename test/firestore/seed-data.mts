export const PROJECT_ID = "demo-locava-backendv2";

type SeedDoc = {
  path: string;
  data: Record<string, unknown>;
};

const BASE_MS = Date.UTC(2026, 3, 25, 16, 0, 0);
const HEAVY_USER_ID = "aXngoh9jeqW35FNM3fq1w9aXdEh1";

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function pic(userId: string): string {
  return `https://cdn.locava.test/users/${encodeURIComponent(userId)}.jpg`;
}

function postAsset(postId: string, kind: "image" | "video" = "image") {
  return [
    {
      id: `${postId}-asset-1`,
      type: kind,
      original: `https://cdn.locava.test/posts/${encodeURIComponent(postId)}/original.${kind === "video" ? "mp4" : "jpg"}`,
      poster: `https://cdn.locava.test/posts/${encodeURIComponent(postId)}/poster.jpg`,
      thumbnail: `https://cdn.locava.test/posts/${encodeURIComponent(postId)}/thumb.jpg`,
      variants:
        kind === "video"
          ? {
              startup720FaststartAvc: `https://cdn.locava.test/posts/${encodeURIComponent(postId)}/startup.mp4`,
              main720Avc: `https://cdn.locava.test/posts/${encodeURIComponent(postId)}/main.mp4`,
              hls: `https://cdn.locava.test/posts/${encodeURIComponent(postId)}/stream.m3u8`
            }
          : {}
    }
  ];
}

function buildUserDoc(input: {
  userId: string;
  handle: string;
  name: string;
  postCount: number;
  updatedAtMs: number;
  following?: string[];
  followers?: string[];
  phoneNumber?: string;
  email?: string;
  collectionsV2Index?: Array<Record<string, unknown>>;
  collectionsV2IndexedAtMs?: number;
  unreadCount?: number;
  bio?: string;
}): SeedDoc {
  return {
    path: `users/${input.userId}`,
    data: {
      handle: input.handle,
      searchHandle: input.handle.toLowerCase(),
      name: input.name,
      displayName: input.name,
      searchName: input.name.toLowerCase(),
      profilePic: pic(input.userId),
      photoURL: pic(input.userId),
      bio: input.bio ?? `${input.name} on Locava`,
      postCount: input.postCount,
      followersCount: (input.followers ?? []).length,
      followingCount: (input.following ?? []).length,
      followers: input.followers ?? [],
      following: input.following ?? [],
      updatedAt: input.updatedAtMs,
      ...(input.phoneNumber ? { phoneNumber: input.phoneNumber } : {}),
      ...(input.email ? { email: input.email } : {}),
      ...(typeof input.unreadCount === "number" ? { unreadCount: input.unreadCount } : {}),
      ...(input.collectionsV2Index ? { collectionsV2Index: input.collectionsV2Index } : {}),
      ...(input.collectionsV2IndexedAtMs ? { collectionsV2IndexedAtMs: input.collectionsV2IndexedAtMs } : {})
    }
  };
}

function buildPostDoc(input: {
  postId: string;
  userId: string;
  handle: string;
  name: string;
  createdAtMs: number;
  title: string;
  caption: string;
  activities: string[];
  feedSlot?: number;
  lat?: number;
  lng?: number;
  cityRegionId?: string;
  stateRegionId?: string;
  deleted?: boolean;
  privacy?: "public" | "private";
}): SeedDoc {
  const mediaType = input.feedSlot && input.feedSlot % 5 === 0 ? "video" : "image";
  return {
    path: `posts/${input.postId}`,
    data: {
      userId: input.userId,
      ownerId: input.userId,
      userHandle: input.handle,
      userName: input.name,
      userPic: pic(input.userId),
      title: input.title,
      caption: input.caption,
      description: input.caption,
      content: input.caption,
      activities: input.activities,
      tags: input.activities.map((activity) => activity.replace(/\s+/g, "_")),
      mediaType,
      thumbUrl: `https://cdn.locava.test/posts/${encodeURIComponent(input.postId)}/thumb.jpg`,
      displayPhotoLink: `https://cdn.locava.test/posts/${encodeURIComponent(input.postId)}/display.jpg`,
      photoLink: `https://cdn.locava.test/posts/${encodeURIComponent(input.postId)}/display.jpg`,
      assets: postAsset(input.postId, mediaType),
      time: input.createdAtMs,
      createdAtMs: input.createdAtMs,
      updatedAtMs: input.createdAtMs + 30_000,
      lastUpdated: input.createdAtMs + 30_000,
      createdAt: input.createdAtMs,
      "time-created": input.createdAtMs,
      likeCount: 2,
      likesCount: 2,
      commentCount: 1,
      commentsCount: 1,
      likes: [],
      address: "Easton, PA",
      lat: input.lat ?? 40.68843,
      lng: input.lng ?? -75.22073,
      long: input.lng ?? -75.22073,
      geohash: "dr4e3x",
      geoData: {
        city: "Easton",
        state: "Pennsylvania",
        country: "United States"
      },
      cityRegionId: input.cityRegionId ?? "us:pennsylvania:easton",
      stateRegionId: input.stateRegionId ?? "us:pennsylvania",
      countryRegionId: "us",
      assetsReady: true,
      privacy: input.privacy ?? "public",
      deleted: input.deleted ?? false,
      isDeleted: false,
      archived: false,
      hidden: false,
      ...(typeof input.feedSlot === "number" ? { feedSlot: input.feedSlot } : {})
    }
  };
}

function buildNotificationDocs(viewerId: string, count: number): SeedDoc[] {
  return Array.from({ length: count }, (_, index) => {
    const slot = index + 1;
    const createdAtMs = BASE_MS - slot * 60_000;
    const type = slot % 4 === 0 ? "follow" : slot % 4 === 1 ? "like" : slot % 4 === 2 ? "comment" : "post";
    return {
      path: `users/${viewerId}/notifications/${viewerId}-notif-${String(slot).padStart(3, "0")}`,
      data: {
        type,
        senderUserId: `creator-${String(((slot - 1) % 8) + 1).padStart(2, "0")}`,
        senderName: `Creator ${String(((slot - 1) % 8) + 1).padStart(2, "0")}`,
        senderProfilePic: pic(`creator-${String(((slot - 1) % 8) + 1).padStart(2, "0")}`),
        message: type === "follow" ? "started following you" : type === "comment" ? "commented on your post" : "liked your post",
        timestamp: createdAtMs,
        read: slot > 10,
        ...(type === "follow"
          ? { targetUserId: viewerId }
          : { postId: `internal-viewer-feed-post-${((slot - 1) % 8) + 1}` })
      }
    };
  });
}

function buildSavedCollectionIndexRecord(viewerId: string, items: string[]) {
  return {
    id: `saved-${viewerId}`,
    ownerId: viewerId,
    name: "Saved",
    description: "",
    privacy: "private",
    collaborators: [viewerId],
    items,
    itemsCount: items.length,
    createdAt: iso(BASE_MS - 5_000),
    updatedAt: iso(BASE_MS - 5_000),
    lastContentActivityAtMs: BASE_MS - 5_000,
    kind: "backend"
  };
}

export function buildSeedDocs(): SeedDoc[] {
  const docs: SeedDoc[] = [];

  const savedItems = [
    "internal-viewer-feed-post-1",
    "internal-viewer-feed-post-2",
    "internal-viewer-feed-post-3",
    "internal-viewer-feed-post-4",
    "internal-viewer-feed-post-5",
    "internal-viewer-feed-post-6",
    "internal-viewer-feed-post-8",
    "internal-viewer-feed-post-9",
    "internal-viewer-feed-post-10",
    "internal-viewer-feed-post-12",
    "internal-viewer-feed-post-13",
    "internal-viewer-feed-post-14",
    "internal-viewer-feed-post-15",
    "internal-viewer-feed-post-16",
    "internal-viewer-feed-post-17",
    "internal-viewer-feed-post-18",
    "internal-viewer-feed-post-20",
    "internal-viewer-feed-post-21",
    "internal-viewer-feed-post-22",
    "internal-viewer-feed-post-23"
  ];

  docs.push(
    buildUserDoc({
      userId: "internal-viewer",
      handle: "internal.viewer",
      name: "Internal Viewer",
      postCount: 26,
      updatedAtMs: BASE_MS,
      unreadCount: 10,
      collectionsV2Index: [
        buildSavedCollectionIndexRecord("internal-viewer", savedItems),
        {
          id: "internal-viewer-collection-1",
          ownerId: "internal-viewer",
          name: "Weekend List",
          description: "Public list for deterministic tests",
          privacy: "public",
          collaborators: ["internal-viewer"],
          items: ["internal-viewer-feed-post-3", "author-24-post-1"],
          itemsCount: 2,
          createdAt: iso(BASE_MS - 20_000),
          updatedAt: iso(BASE_MS - 20_000),
          lastContentActivityAtMs: BASE_MS - 20_000,
          kind: "backend"
        }
      ],
      collectionsV2IndexedAtMs: BASE_MS,
      followers: ["creator-01", "creator-02"],
      following: [],
      bio: "Deterministic internal test viewer"
    }),
    buildUserDoc({
      userId: "viewer-a",
      handle: "viewer.a",
      name: "Viewer A",
      postCount: 1,
      updatedAtMs: BASE_MS - 1_000,
      following: [],
      followers: []
    }),
    buildUserDoc({
      userId: HEAVY_USER_ID,
      handle: "heavy.explorer",
      name: "Heavy Explorer",
      postCount: 20,
      updatedAtMs: BASE_MS - 2_000,
      followers: ["creator-01", "creator-02", "creator-03"],
      following: ["author-24"],
      bio: "Heavy user profile used by profile surfaces"
    }),
    buildUserDoc({
      userId: "author-24",
      handle: "author-24",
      name: "Author Twenty Four",
      postCount: 3,
      updatedAtMs: BASE_MS - 3_000
    }),
    buildUserDoc({
      userId: "author-25",
      handle: "author-25",
      name: "Author Twenty Five",
      postCount: 1,
      updatedAtMs: BASE_MS - 4_000
    }),
    buildUserDoc({
      userId: "seed-contact-1",
      handle: "testuser",
      name: "Test User",
      postCount: 2,
      updatedAtMs: BASE_MS - 5_000,
      phoneNumber: "6507046433"
    }),
    buildUserDoc({
      userId: "seed-email-1",
      handle: "emailmatch",
      name: "Email Match",
      postCount: 2,
      updatedAtMs: BASE_MS - 6_000,
      email: "test@example.com"
    }),
    buildUserDoc({
      userId: "user-1",
      handle: "user-1",
      name: "User One",
      postCount: 1,
      updatedAtMs: BASE_MS - 7_000
    }),
    buildUserDoc({
      userId: "user-2",
      handle: "user-2",
      name: "User Two",
      postCount: 1,
      updatedAtMs: BASE_MS - 8_000
    }),
    buildUserDoc({
      userId: "user-3",
      handle: "user-3",
      name: "User Three",
      postCount: 1,
      updatedAtMs: BASE_MS - 9_000
    }),
    buildUserDoc({
      userId: "user-4",
      handle: "user-4",
      name: "User Four",
      postCount: 1,
      updatedAtMs: BASE_MS - 10_000,
      unreadCount: 10
    }),
    buildUserDoc({
      userId: "firebase-user-abc",
      handle: "firebase-user-abc",
      name: "Firebase User ABC",
      postCount: 1,
      updatedAtMs: BASE_MS - 11_000
    }),
    buildUserDoc({
      userId: "jwt-resolved-uid",
      handle: "jwt-resolved-uid",
      name: "JWT Resolved User",
      postCount: 1,
      updatedAtMs: BASE_MS - 12_000
    }),
    buildUserDoc({
      userId: "session-user-xyz",
      handle: "session-user-xyz",
      name: "Session User XYZ",
      postCount: 1,
      updatedAtMs: BASE_MS - 13_000
    })
  );

  for (let i = 1; i <= 14; i += 1) {
    const id = `creator-${String(i).padStart(2, "0")}`;
    docs.push(
      buildUserDoc({
        userId: id,
        handle: id,
        name: `Creator ${String(i).padStart(2, "0")}`,
        postCount: 8 + i,
        updatedAtMs: BASE_MS - 20_000 - i * 1_000,
        followers: i % 2 === 0 ? ["internal-viewer"] : []
      })
    );
  }

  for (let i = 1; i <= 24; i += 1) {
    docs.push(
      buildPostDoc({
        postId: `internal-viewer-feed-post-${i}`,
        userId: "internal-viewer",
        handle: "internal.viewer",
        name: "Internal Viewer",
        createdAtMs: BASE_MS - i * 90_000,
        title: i % 2 === 0 ? `Coffee stop ${i}` : `Hiking route ${i}`,
        caption: i % 2 === 0 ? `Coffee and brunch stop ${i}` : `Scenic hiking post ${i}`,
        activities: i % 2 === 0 ? ["coffee", "brunch"] : ["hiking", "scenic views"],
        feedSlot: i
      })
    );
  }

  for (let i = 1; i <= 20; i += 1) {
    docs.push(
      buildPostDoc({
        postId: `${HEAVY_USER_ID}-post-${i}`,
        userId: HEAVY_USER_ID,
        handle: "heavy.explorer",
        name: "Heavy Explorer",
        createdAtMs: BASE_MS - i * 120_000,
        title: `Heavy profile post ${i}`,
        caption: `Heavy profile deterministic post ${i}`,
        activities: i % 2 === 0 ? ["hiking"] : ["coffee"]
      })
    );
  }

  for (let i = 1; i <= 3; i += 1) {
    docs.push(
      buildPostDoc({
        postId: `author-24-post-${i}`,
        userId: "author-24",
        handle: "author-24",
        name: "Author Twenty Four",
        createdAtMs: BASE_MS - 3_000_000 - i * 100_000,
        title: `Author 24 post ${i}`,
        caption: `Author 24 deterministic post ${i}`,
        activities: ["hiking"]
      })
    );
  }

  docs.push(
    buildPostDoc({
      postId: "author-25-post-1",
      userId: "author-25",
      handle: "author-25",
      name: "Author Twenty Five",
      createdAtMs: BASE_MS - 4_000_000,
      title: "Author 25 post 1",
      caption: "Author 25 deterministic post 1",
      activities: ["coffee"]
    }),
    buildPostDoc({
      postId: "private-post-1",
      userId: "author-24",
      handle: "author-24",
      name: "Author Twenty Four",
      createdAtMs: BASE_MS - 5_000_000,
      title: "Private post",
      caption: "Should be filtered",
      activities: ["hiking"],
      privacy: "private"
    }),
    buildPostDoc({
      postId: "deleted-post-1",
      userId: "author-24",
      handle: "author-24",
      name: "Author Twenty Four",
      createdAtMs: BASE_MS - 5_100_000,
      title: "Deleted post",
      caption: "Should be filtered",
      activities: ["coffee"],
      deleted: true
    })
  );

  for (let i = 1; i <= 8; i += 1) {
    const creatorId = `creator-${String(i).padStart(2, "0")}`;
    docs.push(
      buildPostDoc({
        postId: `${creatorId}-coffee-post`,
        userId: creatorId,
        handle: creatorId,
        name: `Creator ${String(i).padStart(2, "0")}`,
        createdAtMs: BASE_MS - 6_000_000 - i * 100_000,
        title: `Coffee brunch spot ${i}`,
        caption: `Coffee brunch guide ${i}`,
        activities: ["coffee", "brunch"]
      }),
      buildPostDoc({
        postId: `${creatorId}-hiking-post`,
        userId: creatorId,
        handle: creatorId,
        name: `Creator ${String(i).padStart(2, "0")}`,
        createdAtMs: BASE_MS - 7_000_000 - i * 100_000,
        title: `Hiking scenic trail ${i}`,
        caption: `Scenic views near me hike ${i}`,
        activities: ["hiking", "scenic views"],
        lat: 40.68843 + i * 0.001,
        lng: -75.22073 + i * 0.001
      })
    );
  }

  docs.push(
    {
      path: "collections/saved-internal-viewer",
      data: {
        ownerId: "internal-viewer",
        userId: "internal-viewer",
        name: "Saved",
        description: "",
        privacy: "private",
        collaborators: ["internal-viewer"],
        items: savedItems,
        itemsCount: savedItems.length,
        lastContentActivityAtMs: BASE_MS - 5_000,
        createdAt: iso(BASE_MS - 5_000),
        updatedAt: iso(BASE_MS - 5_000)
      }
    },
    {
      path: "collections/internal-viewer-collection-1",
      data: {
        ownerId: "internal-viewer",
        userId: "internal-viewer",
        name: "Weekend List",
        description: "Public list for deterministic tests",
        privacy: "public",
        isPublic: true,
        collaborators: ["internal-viewer"],
        items: ["internal-viewer-feed-post-3", "author-24-post-1"],
        itemsCount: 2,
        lastContentActivityAtMs: BASE_MS - 20_000,
        createdAt: iso(BASE_MS - 20_000),
        updatedAt: iso(BASE_MS - 20_000)
      }
    },
    {
      path: "collections/internal-viewer-collection-1/posts/internal-viewer-feed-post-3",
      data: { postId: "internal-viewer-feed-post-3", addedAt: iso(BASE_MS - 20_000) }
    },
    {
      path: "collections/internal-viewer-collection-1/posts/author-24-post-1",
      data: { postId: "author-24-post-1", addedAt: iso(BASE_MS - 21_000) }
    },
    {
      path: "posts/internal-viewer-feed-post-1/comments/seed-comment-1",
      data: {
        commentId: "seed-comment-1",
        postId: "internal-viewer-feed-post-1",
        userId: "author-24",
        text: "Seeded comment",
        createdAtMs: BASE_MS - 60_000,
        likedBy: []
      }
    },
    {
      path: "posts/internal-viewer-feed-post-1",
      data: {
        comments: [
          {
            commentId: "seed-comment-1",
            postId: "internal-viewer-feed-post-1",
            userId: "author-24",
            text: "Seeded comment",
            createdAtMs: BASE_MS - 60_000,
            likedBy: []
          }
        ]
      }
    },
    {
      path: "users/internal-viewer/achievements/state",
      data: {
        xp: { current: 2570, level: 17, levelProgress: 28, tier: "Explorer" },
        streak: { current: 18, longest: 18, lastQualifiedAt: iso(BASE_MS - 90_000) },
        totalPosts: 26,
        globalRank: 8,
        weeklyCapturesWeekOf: "2026-04-20",
        weeklyCaptures: [],
        badges: [],
        challenges: [],
        pendingLeaderboardEvent: null
      }
    },
    {
      path: "cache/achievements_leagues_v2",
      data: {
        leagues: [
          { id: "rookie", title: "Rookie", minXP: 0, maxXP: 999, order: 1, active: true, color: "#60a5fa", bgColor: "#eff6ff" },
          { id: "explorer", title: "Explorer", minXP: 1000, maxXP: 2999, order: 2, active: true, color: "#0f766e", bgColor: "#ecfeff" }
        ]
      }
    },
    {
      path: "leagues/explorer",
      data: { id: "explorer", title: "Explorer", minXP: 1000, maxXP: 2999, order: 2, active: true }
    },
    {
      path: "leagues/rookie",
      data: { id: "rookie", title: "Rookie", minXP: 0, maxXP: 999, order: 1, active: true }
    },
    {
      path: "chats/chat-demo-1",
      data: {
        participants: ["internal-viewer", HEAVY_USER_ID],
        participantIds: ["internal-viewer", HEAVY_USER_ID],
        participantPreview: [
          { userId: "internal-viewer", handle: "internal.viewer", name: "Internal Viewer", profilePic: pic("internal-viewer") },
          { userId: HEAVY_USER_ID, handle: "heavy.explorer", name: "Heavy Explorer", profilePic: pic(HEAVY_USER_ID) }
        ],
        isGroup: false,
        lastMessagePreview: "Seed hello",
        lastMessageTime: BASE_MS - 30_000,
        manualUnreadBy: ["internal-viewer"]
      }
    },
    {
      path: "chats/chat-demo-1/messages/chat-demo-1-message-1",
      data: {
        conversationId: "chat-demo-1",
        messageId: "chat-demo-1-message-1",
        senderId: HEAVY_USER_ID,
        text: "Seed hello",
        messageType: "text",
        timestamp: BASE_MS - 30_000,
        createdAtMs: BASE_MS - 30_000
      }
    }
  );

  docs.push(...buildNotificationDocs("internal-viewer", 25));
  docs.push(...buildNotificationDocs("user-4", 25));

  return docs;
}
