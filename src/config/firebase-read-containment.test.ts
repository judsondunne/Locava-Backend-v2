import { afterEach, describe, expect, it } from "vitest";
import {
  assertWebApiAccessAllowed,
  parseFirebaseAccessEnv
} from "@locava/contracts/firebase-access-policy";
import { createApp } from "../app/createApp.js";
import { assertMonolithProxyOutboundAllowed } from "./monolith-proxy-allowlist.js";
import { evaluateLegacyRouteShutdown } from "./legacyRouteShutdownPolicy.js";

describe("firebase read containment policy", () => {
  const prevEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...prevEnv };
  });

  it("evaluateLegacyRouteShutdown blocks legacy product feed when granular feed disabled", () => {
    process.env.LOCAVA_FIREBASE_ACCESS_MODE = "locked_down";
    process.env.DISABLE_LEGACY_FIREBASE = "true";
    process.env.DISABLE_LEGACY_FEED_FIRESTORE = "true";
    const r = evaluateLegacyRouteShutdown("/api/v1/product/feed/bootstrap?x=1");
    expect(r).not.toBeNull();
    expect(r?.statusCode).toBe(503);
    expect((r?.body as { code?: string }).code).toBe("LEGACY_FIREBASE_DISABLED");
  });

  it("evaluateLegacyRouteShutdown does not block /v2 routes", () => {
    process.env.LOCAVA_FIREBASE_ACCESS_MODE = "locked_down";
    process.env.DISABLE_LEGACY_FIREBASE = "true";
    process.env.DISABLE_LEGACY_FEED_FIRESTORE = "true";
    expect(evaluateLegacyRouteShutdown("/v2/feed/for-you")).toBeNull();
  });

  it("monolith allowlist allows create-from-staged when proxy enabled", () => {
    process.env.LOCAVA_FIREBASE_ACCESS_MODE = "locked_down";
    process.env.ALLOW_BACKEND_V2_MONOLITH_PROXY = "true";
    expect(() =>
      assertMonolithProxyOutboundAllowed("https://legacy.test/api/v1/product/upload/create-from-staged")
    ).not.toThrow();
  });

  it("monolith allowlist blocks unknown product paths", () => {
    process.env.LOCAVA_FIREBASE_ACCESS_MODE = "locked_down";
    process.env.ALLOW_BACKEND_V2_MONOLITH_PROXY = "true";
    expect(() =>
      assertMonolithProxyOutboundAllowed("https://legacy.test/api/v1/product/feed/bootstrap")
    ).toThrow();
  });

  it("web policy blocks legacy v1 product when NEXT_PUBLIC_DISABLE_LEGACY_WEB_V1_API", () => {
    process.env.NEXT_PUBLIC_LOCAVA_FIREBASE_ACCESS_MODE = "locked_down";
    process.env.NEXT_PUBLIC_DISABLE_LEGACY_WEB_V1_API = "true";
    const env = parseFirebaseAccessEnv(process.env);
    expect(() =>
      assertWebApiAccessAllowed(
        "/api/v1/product/feed/bootstrap",
        {
          surface: "vitest-web",
          operationType: "api",
          legacy: true,
          runtime: "web-client"
        },
        env
      )
    ).toThrow();
  });

  it("web policy allows /v2 when allow flag not false", () => {
    process.env.NEXT_PUBLIC_LOCAVA_FIREBASE_ACCESS_MODE = "locked_down";
    process.env.NEXT_PUBLIC_DISABLE_LEGACY_WEB_V1_API = "true";
    const env = parseFirebaseAccessEnv(process.env);
    expect(() =>
      assertWebApiAccessAllowed(
        "/v2/health",
        {
          surface: "vitest-web",
          operationType: "api",
          legacy: false,
          runtime: "web-client"
        },
        env
      )
    ).not.toThrow();
  });

  it("web policy allows wikimedia paths when NEXT_PUBLIC_ALLOW_WEB_WIKIMEDIA not false", () => {
    process.env.NEXT_PUBLIC_LOCAVA_FIREBASE_ACCESS_MODE = "locked_down";
    process.env.NEXT_PUBLIC_DISABLE_LEGACY_WEB_V1_API = "true";
    const env = parseFirebaseAccessEnv(process.env);
    expect(() =>
      assertWebApiAccessAllowed(
        "/api/v1/wikimedia-mvp/staging/runs",
        {
          surface: "vitest-web",
          operationType: "api",
          legacy: false,
          runtime: "web-client"
        },
        env
      )
    ).not.toThrow();
  });

  it("createApp returns 503 for legacy product feed bootstrap before route handlers in locked_down", async () => {
    const app = createApp({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      FIRESTORE_TEST_MODE: "disabled",
      FIRESTORE_SOURCE_ENABLED: false,
      LOCAVA_FIREBASE_ACCESS_MODE: "locked_down",
      DISABLE_LEGACY_FIREBASE: true,
      DISABLE_LEGACY_FEED_FIRESTORE: true,
      ENABLE_LEGACY_COMPAT_ROUTES: true
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/product/feed/bootstrap"
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { code?: string };
    expect(body.code).toBe("LEGACY_FIREBASE_DISABLED");
    await app.close();
  });

});
