import { createApp } from "../src/app/createApp.js";

function arg(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx < 0) return null;
  const value = String(process.argv[idx + 1] ?? "").trim();
  return value.length > 0 ? value : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJson(body: string): any {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function sessionSummary(payload: any) {
  const data = payload?.data;
  return {
    viewerReady: data?.firstRender?.account?.viewerReady === true,
    hydrationStatus: String(data?.firstRender?.account?.profileHydrationStatus ?? ""),
    profilePicPresent: Boolean(data?.firstRender?.viewer?.photoUrl),
    cachePrimeHit: Boolean(data?.deferred?.viewerSummary?.viewerReady),
    minimalFallbackSeen: data?.firstRender?.account?.profileHydrationStatus === "minimal_fallback"
  };
}

async function main() {
  const provider = (arg("provider") ?? "google").toLowerCase();
  const email = arg("email");
  const userId = arg("userId");
  if (!["google", "apple", "email"].includes(provider)) {
    throw new Error("provider_must_be_google_apple_or_email");
  }
  if (provider === "email" && !email) {
    throw new Error("email_provider_requires_--email");
  }
  if (!userId && provider !== "email") {
    throw new Error("oauth_provider_requires_--userId");
  }

  const app = createApp();
  try {
    let signInPayload: any = null;
    let signInViewerReady = false;
    let signInProfilePicPresent = false;
    let viewerId = userId ?? "";

    if (provider === "email") {
      const login = await app.inject({
        method: "POST",
        url: "/v2/auth/login",
        headers: { "content-type": "application/json", "x-viewer-roles": "internal" },
        payload: {
          email,
          password: process.env.DEBUG_AUTH_PASSWORD ?? "password"
        }
      });
      signInPayload = parseJson(login.body);
      viewerId = String(signInPayload?.data?.user?.uid ?? "");
      signInViewerReady = signInPayload?.data?.viewer?.viewerReady === true;
      signInProfilePicPresent = Boolean(signInPayload?.data?.viewer?.profilePic);
    } else if (provider === "google") {
      const signIn = await app.inject({
        method: "POST",
        url: "/v2/auth/signin/google",
        headers: { "content-type": "application/json", "x-viewer-roles": "internal" },
        payload: {
          accessToken: process.env.DEBUG_GOOGLE_ACCESS_TOKEN ?? "debug-google-access-token"
        }
      });
      signInPayload = parseJson(signIn.body);
      viewerId = String(signInPayload?.data?.user?.uid ?? viewerId);
      signInViewerReady = signInPayload?.data?.viewer?.viewerReady === true;
      signInProfilePicPresent = Boolean(signInPayload?.data?.viewer?.profilePic);
    } else {
      const signIn = await app.inject({
        method: "POST",
        url: "/v2/auth/signin/apple",
        headers: { "content-type": "application/json", "x-viewer-roles": "internal" },
        payload: {
          identityToken: process.env.DEBUG_APPLE_IDENTITY_TOKEN ?? "debug-apple-identity-token",
          ...(email ? { email } : {})
        }
      });
      signInPayload = parseJson(signIn.body);
      viewerId = String(signInPayload?.data?.user?.uid ?? viewerId);
      signInViewerReady = signInPayload?.data?.viewer?.viewerReady === true;
      signInProfilePicPresent = Boolean(signInPayload?.data?.viewer?.profilePic);
    }

    if (!viewerId) {
      throw new Error("unable_to_resolve_viewer_id_from_signin");
    }

    const headers = { "x-viewer-id": viewerId, "x-viewer-roles": "internal" };
    const session0 = parseJson((await app.inject({ method: "GET", url: "/v2/auth/session", headers })).body);
    await sleep(250);
    const session250 = parseJson((await app.inject({ method: "GET", url: "/v2/auth/session", headers })).body);
    await sleep(750);
    const session1000 = parseJson((await app.inject({ method: "GET", url: "/v2/auth/session", headers })).body);

    const s0 = sessionSummary(session0);
    const s250 = sessionSummary(session250);
    const s1000 = sessionSummary(session1000);

    console.log(`signInViewerReady=${signInViewerReady}`);
    console.log(`signInProfilePicPresent=${signInProfilePicPresent}`);
    console.log(`session0ViewerReady=${s0.viewerReady}`);
    console.log(`session0HydrationStatus=${s0.hydrationStatus}`);
    console.log(`session0ProfilePicPresent=${s0.profilePicPresent}`);
    console.log(`session250ViewerReady=${s250.viewerReady}`);
    console.log(`session1000ViewerReady=${s1000.viewerReady}`);
    console.log(`cachePrimeHit=${s0.cachePrimeHit || s250.cachePrimeHit || s1000.cachePrimeHit}`);
    console.log(`minimalFallbackSeen=${s0.minimalFallbackSeen || s250.minimalFallbackSeen || s1000.minimalFallbackSeen}`);
  } finally {
    await app.close();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
