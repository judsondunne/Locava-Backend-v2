import { createApp } from "../src/app/createApp.js";

type FlowSummary = {
  label: string;
  tokenPresent: boolean;
  canonicalUserId: string | null;
  viewerReady: boolean;
  profileComplete: boolean | null;
  onboardingComplete: boolean | null;
  requiresProfile: boolean | null;
  nativeDestinationRoute: string | null;
  profilePic: string | null;
  handle: string | null;
  activityProfileType: string;
  settingsPresent: boolean;
  searchSerializable: boolean;
  settingsSerializable: boolean;
  editProfileSerializable: boolean;
  suggestedFriendsShouldOpen: boolean;
  postAuthBootstrapKey: string;
};

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return null;
  const value = String(process.argv[i + 1] ?? "").trim();
  return value || null;
}

function parse(body: string): any {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function summarize(label: string, payload: any): FlowSummary {
  const data = payload?.data ?? {};
  const viewer = data.viewer ?? {};
  const activityProfile = viewer.activityProfile ?? {};
  const settings = viewer.settings ?? {};
  const canonicalUserId =
    (typeof data.canonicalUserId === "string" && data.canonicalUserId) ||
    (typeof viewer.canonicalUserId === "string" && viewer.canonicalUserId) ||
    null;
  const viewerReady = data.viewerReady === true || viewer.viewerReady === true;
  return {
    label,
    tokenPresent: Boolean(data.token),
    canonicalUserId,
    viewerReady,
    profileComplete: typeof data.profileComplete === "boolean" ? data.profileComplete : viewer.profileComplete ?? null,
    onboardingComplete:
      typeof data.onboardingComplete === "boolean" ? data.onboardingComplete : viewer.onboardingComplete ?? null,
    requiresProfile: typeof data.requiresProfile === "boolean" ? data.requiresProfile : null,
    nativeDestinationRoute: typeof data.nativeDestinationRoute === "string" ? data.nativeDestinationRoute : null,
    profilePic: typeof viewer.profilePic === "string" ? viewer.profilePic : null,
    handle: typeof viewer.handle === "string" ? viewer.handle : null,
    activityProfileType: Array.isArray(activityProfile) ? "array" : typeof activityProfile,
    settingsPresent: settings && typeof settings === "object" && !Array.isArray(settings),
    searchSerializable: (() => {
      try { JSON.stringify({ handle: viewer.handle, searchPreferences: viewer.searchPreferences ?? {} }); return true; } catch { return false; }
    })(),
    settingsSerializable: (() => {
      try { JSON.stringify(settings); return true; } catch { return false; }
    })(),
    editProfileSerializable: (() => {
      try { JSON.stringify({ name: viewer.name, handle: viewer.handle, profilePic: viewer.profilePic }); return true; } catch { return false; }
    })(),
    suggestedFriendsShouldOpen: viewerReady && Boolean(canonicalUserId),
    postAuthBootstrapKey: `${canonicalUserId ?? "none"}:${viewerReady ? "ready" : "not_ready"}:${data.nativeDestinationRoute ?? "none"}`
  };
}

function printSummary(row: FlowSummary): void {
  console.log(`\n[${row.label}]`);
  console.log(`tokenPresent=${row.tokenPresent}`);
  console.log(`canonicalUserId=${row.canonicalUserId}`);
  console.log(`viewerReady=${row.viewerReady}`);
  console.log(`profileComplete=${row.profileComplete}`);
  console.log(`onboardingComplete=${row.onboardingComplete}`);
  console.log(`requiresProfile=${row.requiresProfile}`);
  console.log(`nativeDestinationRoute=${row.nativeDestinationRoute}`);
  console.log(`viewer.profilePic=${row.profilePic}`);
  console.log(`viewer.handle=${row.handle}`);
  console.log(`viewer.activityProfileType=${row.activityProfileType}`);
  console.log(`settingsPresent=${row.settingsPresent}`);
  console.log(`searchSerializable=${row.searchSerializable}`);
  console.log(`settingsSerializable=${row.settingsSerializable}`);
  console.log(`editProfileSerializable=${row.editProfileSerializable}`);
  console.log(`suggestedFriendsShouldOpen=${row.suggestedFriendsShouldOpen}`);
  console.log(`postAuthBootstrapKey=${row.postAuthBootstrapKey}`);
}

function assertParity(reference: FlowSummary, target: FlowSummary): string[] {
  const fields: Array<keyof FlowSummary> = [
    "viewerReady",
    "profileComplete",
    "onboardingComplete",
    "requiresProfile",
    "nativeDestinationRoute",
    "settingsPresent",
    "searchSerializable",
    "settingsSerializable",
    "editProfileSerializable"
  ];
  const diffs: string[] = [];
  for (const field of fields) {
    if (reference[field] !== target[field]) {
      diffs.push(`${String(field)} expected=${String(reference[field])} actual=${String(target[field])}`);
    }
  }
  return diffs;
}

async function main() {
  const email = arg("email");
  const password = arg("password") ?? process.env.DEBUG_AUTH_PASSWORD ?? "";
  const googleAccessToken = arg("googleAccessToken") ?? process.env.DEBUG_GOOGLE_ACCESS_TOKEN ?? "";
  const appleIdentityToken = arg("appleIdentityToken") ?? process.env.DEBUG_APPLE_IDENTITY_TOKEN ?? "";
  if (!email || !password) throw new Error("pass --email and --password");
  const app = createApp();
  try {
    const login = parse((await app.inject({
      method: "POST", url: "/v2/auth/login",
      headers: { "content-type": "application/json", "x-viewer-roles": "internal" },
      payload: { email, password }
    })).body);
    const register = parse((await app.inject({
      method: "POST", url: "/v2/auth/register",
      headers: { "content-type": "application/json", "x-viewer-roles": "internal" },
      payload: { email: `parity+${Date.now()}@example.com`, password: "password123", displayName: "Parity User" }
    })).body);
    const google = googleAccessToken
      ? parse((await app.inject({
          method: "POST", url: "/v2/auth/signin/google",
          headers: { "content-type": "application/json", "x-viewer-roles": "internal" },
          payload: { accessToken: googleAccessToken }
        })).body)
      : null;
    const apple = appleIdentityToken
      ? parse((await app.inject({
          method: "POST", url: "/v2/auth/signin/apple",
          headers: { "content-type": "application/json", "x-viewer-roles": "internal" },
          payload: { identityToken: appleIdentityToken, email }
        })).body)
      : null;

    const baseline = summarize("register", register);
    const rows = [summarize("login", login), baseline];
    if (google) rows.push(summarize("google", google));
    if (apple) rows.push(summarize("apple", apple));
    rows.forEach(printSummary);

    const parityFailures: string[] = [];
    for (const row of rows) {
      if (row.label === "register") continue;
      const diffs = assertParity(baseline, row);
      if (diffs.length > 0) parityFailures.push(`${row.label}: ${diffs.join("; ")}`);
    }
    if (parityFailures.length > 0) {
      throw new Error(`auth_flow_contract_parity_failed ${parityFailures.join(" | ")}`);
    }
    console.log("\nContract parity check passed.");
  } finally {
    await app.close();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
