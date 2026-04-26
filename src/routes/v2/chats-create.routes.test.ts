import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 chats create routes", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const viewerHeaders = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal",
    "content-type": "application/json",
  };

  it("creates or reuses a direct conversation idempotently", async () => {
    const payload = { otherUserId: "chat_user_777" };
    const first = await app.inject({
      method: "POST",
      url: "/v2/chats/create-or-get",
      headers: viewerHeaders,
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/v2/chats/create-or-get",
      headers: viewerHeaders,
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().data.routeName).toBe("chats.create_or_get.post");
    expect(second.json().data.routeName).toBe("chats.create_or_get.post");
    expect(first.json().data.conversationId).toBeTypeOf("string");
    expect(second.json().data.conversationId).toBe(first.json().data.conversationId);
    expect(first.json().data.created).toBe(true);
    expect(second.json().data.created).toBe(false);
  });

  it("creates a group conversation and returns the canonical route name", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v2/chats/create-group",
      headers: viewerHeaders,
      payload: {
        participants: ["chat_user_888", "chat_user_889"],
        groupName: "Backend v2 group",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.routeName).toBe("chats.create_group.post");
    expect(response.json().data.conversationId).toBeTypeOf("string");
  });
});
