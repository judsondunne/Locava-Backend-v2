import { describe, expect, it, vi, beforeEach } from "vitest";

const { getForYouV5Page } = vi.hoisted(() => {
  const fn = vi.fn();
  return { getForYouV5Page: fn };
});

vi.mock("./for-you-v5-get-page.js", () => ({
  getForYouV5Page,
}));

import { FeedForYouSimpleService } from "./feed-for-you-simple.service.js";

beforeEach(() => {
  delete process.env.ENABLE_FOR_YOU_V5_READY_DECK;
});

const v5Payload = {
  routeName: "feed.for_you_simple.get" as const,
  items: [],
  nextCursor: null,
  exhausted: true,
  emptyReason: "no_playable_posts" as const,
  degradedFallbackUsed: false,
  relaxedSeenUsed: false,
  wrapAroundUsed: false,
  fallbackAllPostsUsed: false,
  emergencyFallbackUsed: false,
  lane: "reels" as const,
  exhaustedReels: true,
  exhaustedNormal: true,
  hasMore: false,
};

describe("FeedForYouSimpleService V5 gate", () => {
  it("delegates plain no-cursor to getForYouV5Page with default env (no ENABLE_FOR_YOU_V5_READY_DECK set)", async () => {
    getForYouV5Page.mockResolvedValueOnce({
      ...v5Payload,
      debug: { forYouRouteVariant: "v5" },
    });
    const repo = { isEnabled: () => true } as never;
    const svc = new FeedForYouSimpleService(repo);
    await svc.getPage({
      viewerId: "u1",
      limit: 5,
      cursor: null,
    });
    expect(getForYouV5Page).toHaveBeenCalledTimes(1);
    const arg = getForYouV5Page.mock.calls[0]![0];
    expect(arg.cursor).toBeNull();
    expect(arg.limit).toBe(5);
  });

  it("does not call getForYouV5Page for fys:v3 cursor (legacy rollback)", async () => {
    getForYouV5Page.mockClear();
    const repo = { isEnabled: () => true } as never;
    const svc = new FeedForYouSimpleService(repo);
    await expect(
      svc.getPage({
        viewerId: "u1",
        limit: 5,
        cursor: "fys:v3:invalid",
      })
    ).rejects.toThrow();
    expect(getForYouV5Page).not.toHaveBeenCalled();
  });
});
