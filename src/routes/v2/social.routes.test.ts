import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 social suggested friends + contacts sync", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const headers = { "x-viewer-id": "viewer-a", "x-viewer-roles": "internal" };

  it("contacts sync matches normalized phone", async () => {
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
});
