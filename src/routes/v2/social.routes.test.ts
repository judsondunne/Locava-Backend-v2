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
    expect(body.data.matchedCount).toBeGreaterThan(0);
    expect(body.data.matchedUsers.some((u: { userId: string }) => u.userId === "seed-contact-1")).toBe(true);
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
    expect(body.data.matchedUsers.some((u: { userId: string }) => u.userId === "seed-email-1")).toBe(true);
  });

  it("returns suggested users when contacts unavailable", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/social/suggested-friends?surface=onboarding&limit=8",
      headers
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.users.length).toBeGreaterThan(0);
    expect(body.data.users.some((u: { userId: string }) => u.userId === "viewer-a")).toBe(false);
  });

  it("follow invalidates suggestions cache and excludes followed user", async () => {
    const first = await app.inject({
      method: "GET",
      url: "/v2/social/suggested-friends?surface=onboarding&limit=5",
      headers
    });
    const firstUserId = first.json().data.users[0].userId as string;
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
});
