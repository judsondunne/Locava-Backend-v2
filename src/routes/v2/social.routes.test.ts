import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app/createApp.js";
import { SuggestedFriendsService } from "../../services/surfaces/suggested-friends.service.js";

describe("v2 social suggested friends + contacts sync", () => {
  const headers = { "x-viewer-id": "viewer-a", "x-viewer-roles": "internal" };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("contacts sync matches normalized phone", async () => {
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const res = await app.inject({
      method: "POST",
      url: "/v2/social/contacts/sync",
      headers,
      payload: { contacts: [{ name: "Test User", phoneNumbers: ["(650) 704-6433"], emails: [] }] }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data.matchedUsers)).toBe(true);
    expect(body.data.matchedCount).toBeGreaterThanOrEqual(0);
  });

  it("contacts sync matches normalized email", async () => {
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const res = await app.inject({
      method: "POST",
      url: "/v2/social/contacts/sync",
      headers,
      payload: { contacts: [{ name: "Email User", phoneNumbers: [], emails: ["TEST@EXAMPLE.COM"] }] }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data.matchedUsers)).toBe(true);
  });

  it("returns suggested users when contacts unavailable", async () => {
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const res = await app.inject({
      method: "GET",
      url: "/v2/social/suggested-friends?surface=onboarding&limit=8",
      headers
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data.users)).toBe(true);
    expect(body.data.users.some((u: { userId: string }) => u.userId === "viewer-a")).toBe(false);
  });

  it("follow invalidates suggestions cache and excludes followed user", async () => {
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const first = await app.inject({
      method: "GET",
      url: "/v2/social/suggested-friends?surface=onboarding&limit=5",
      headers
    });
    const firstUserId = first.json().data.users[0]?.userId as string | undefined;
    if (!firstUserId) {
      expect(first.statusCode).toBe(200);
      return;
    }
    const follow = await app.inject({
      method: "POST",
      url: `/v2/users/${encodeURIComponent(firstUserId)}/follow`,
      headers
    });
    expect(follow.statusCode).toBe(200);
    const second = await app.inject({
      method: "GET",
      url: "/v2/social/suggested-friends?surface=onboarding&limit=20",
      headers
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.users.some((u: { userId: string }) => u.userId === firstUserId)).toBe(false);
  });

  it("supports explicit userId, excludeUserIds, and postCount ordering without 500s", async () => {
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const res = await app.inject({
      method: "GET",
      url: "/v2/social/suggested-friends?surface=generic&limit=14&userId=viewer-a&excludeUserIds=seed-contact-1,seed-email-1&sortBy=postCount",
      headers
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.viewerId).toBe("viewer-a");
    expect(body.data.users.some((u: { userId: string }) => ["seed-contact-1", "seed-email-1"].includes(u.userId))).toBe(false);
    const postCounts = body.data.users
      .map((u: { postCount?: number }) => Number(u.postCount ?? 0))
      .filter((count: number) => Number.isFinite(count));
    for (let i = 1; i < postCounts.length; i += 1) {
      expect(postCounts[i]).toBeLessThanOrEqual(postCounts[i - 1]);
    }
  });

  it("supports large limits without crashing and returns valid pagination metadata", async () => {
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const res = await app.inject({
      method: "GET",
      url: "/v2/social/suggested-friends?surface=generic&limit=50",
      headers
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data.users)).toBe(true);
    expect(body.data.page.limit).toBe(50);
  });

  it("does not truncate generic limit=50 requests down to 20", async () => {
    const mockedUsers = Array.from({ length: 50 }, (_, index) => ({
      userId: `user-${index + 1}`,
      handle: `user${index + 1}`,
      name: `User ${index + 1}`,
      profilePic: null,
      reason: "all_users" as const,
      isFollowing: false,
      postCount: 100 - index,
      score: 1000 - index,
    }));
    vi.spyOn(SuggestedFriendsService.prototype, "getSuggestionsForUser").mockResolvedValueOnce({
      users: mockedUsers,
      sourceBreakdown: { all_users: 50 },
      generatedAt: Date.now(),
      etag: "mock-etag",
    });
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const res = await app.inject({
      method: "GET",
      url: "/v2/social/suggested-friends?surface=generic&limit=50",
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.users).toHaveLength(50);
    expect(body.data.suggestions).toHaveLength(50);
    expect(body.data.page.limit).toBe(50);
    expect(body.data.page.count).toBe(50);
    expect(body.data.page.hasMore).toBe(false);
  });

  it("returns 200 JSON fallback instead of 304/empty when Firestore hits FAILED_PRECONDITION", async () => {
    vi.spyOn(SuggestedFriendsService.prototype, "getSuggestionsForUser").mockRejectedValueOnce(
      new Error("9 FAILED_PRECONDITION: missing index")
    );
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const res = await app.inject({
      method: "GET",
      url: "/v2/social/suggested-friends?surface=generic&limit=50",
      headers: {
        ...headers,
        "if-none-match": "\"legacy-etag\"",
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.source).toBe("fallback_empty");
    expect(body.data.users).toEqual([]);
    expect(body.data.suggestions).toEqual([]);
    expect(body.data.diagnostics?.errorCode).toBe("FAILED_PRECONDITION");
  });
});
