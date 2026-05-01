import { createApp } from "../src/app/createApp.js";
import { diagnosticsStore } from "../src/observability/diagnostics-store.js";

type RouteProbe = {
  label: string;
  url: string;
  statusCode: number;
  latencyMs: number | null;
  reads: number;
  queries: number;
  writes: number;
  payloadBytes: number;
  body: any;
};

function arg(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx < 0) return null;
  const raw = String(process.argv[idx + 1] ?? "").trim();
  return raw || null;
}

function diagFor(requestId: string | null) {
  if (!requestId) return null;
  return diagnosticsStore.getRecentRequests(300).find((row) => row.requestId === requestId) ?? null;
}

async function callRoute(app: ReturnType<typeof createApp>, input: {
  label: string;
  url: string;
  viewerId: string;
}): Promise<RouteProbe> {
  const res = await app.inject({
    method: "GET",
    url: input.url,
    headers: {
      "x-viewer-id": input.viewerId,
      "x-viewer-roles": "internal",
    },
  });
  const body = JSON.parse(res.body);
  const requestId = typeof body?.meta?.requestId === "string" ? body.meta.requestId : null;
  const diag = diagFor(requestId);
  return {
    label: input.label,
    url: input.url,
    statusCode: res.statusCode,
    latencyMs: typeof diag?.latencyMs === "number" ? Math.round(diag.latencyMs * 100) / 100 : null,
    reads: Number(diag?.dbOps.reads ?? body?.meta?.db?.reads ?? 0) || 0,
    queries: Number(diag?.dbOps.queries ?? body?.meta?.db?.queries ?? 0) || 0,
    writes: Number(diag?.dbOps.writes ?? body?.meta?.db?.writes ?? 0) || 0,
    payloadBytes: Buffer.byteLength(res.body, "utf8"),
    body,
  };
}

function warningKeys(payload: unknown): string[] {
  const serialized = JSON.stringify(payload);
  return [
    "likedPosts",
    "followers",
    "following",
    "addressBookPhoneNumbers",
    "addressBookUsers",
    "activityProfile",
  ].filter((key) => serialized.includes(`"${key}":[`));
}

function logRoute(route: RouteProbe, extra: string): void {
  console.log(
    [
      `${route.label}:`,
      `status=${route.statusCode}`,
      `latencyMs=${route.latencyMs ?? "n/a"}`,
      `reads=${route.reads}`,
      `queries=${route.queries}`,
      `writes=${route.writes}`,
      `payloadBytes=${route.payloadBytes}`,
      extra,
    ].join(" "),
  );
}

async function main() {
  const viewerId = arg("viewerId") ?? process.env.DEBUG_VIEWER_ID?.trim() ?? "";
  const userId = arg("userId") ?? "qQkjhy6OBvOJaNpn0ZSuj1s9oUl1";
  if (!viewerId) {
    throw new Error("debug_profile_requires_viewer_id: pass --viewerId=<viewerId> or DEBUG_VIEWER_ID");
  }

  const app = createApp();
  const encodedUserId = encodeURIComponent(userId);

  const bootstrapCold = await callRoute(app, {
    label: "bootstrap:cold",
    url: `/v2/profiles/${encodedUserId}/bootstrap?gridLimit=12`,
    viewerId,
  });
  const bootstrapWarm = await callRoute(app, {
    label: "bootstrap:warm",
    url: `/v2/profiles/${encodedUserId}/bootstrap?gridLimit=12`,
    viewerId,
  });
  const grid = await callRoute(app, {
    label: "grid",
    url: `/v2/profiles/${encodedUserId}/grid?limit=12`,
    viewerId,
  });
  const collections = await callRoute(app, {
    label: "collections",
    url: `/v2/profiles/${encodedUserId}/collections?limit=4`,
    viewerId,
  });
  const achievements = await callRoute(app, {
    label: "achievements",
    url: `/v2/profiles/${encodedUserId}/achievements?limit=8`,
    viewerId,
  });

  const bootstrapData = bootstrapCold.body?.data ?? {};
  const warnings = warningKeys(bootstrapData);
  const profilePicSource = bootstrapData?.debug?.profilePicSource ?? "unknown";

  logRoute(
    bootstrapCold,
    `gridCount=${bootstrapData?.firstRender?.gridPreview?.items?.length ?? 0} collectionsCount=${bootstrapData?.firstRender?.collectionsPreview?.items?.length ?? 0} achievementsCount=${bootstrapData?.firstRender?.achievementsPreview?.items?.length ?? 0}`,
  );
  logRoute(
    bootstrapWarm,
    `gridCount=${bootstrapWarm.body?.data?.firstRender?.gridPreview?.items?.length ?? 0} collectionsCount=${bootstrapWarm.body?.data?.firstRender?.collectionsPreview?.items?.length ?? 0} achievementsCount=${bootstrapWarm.body?.data?.firstRender?.achievementsPreview?.items?.length ?? 0}`,
  );
  logRoute(
    grid,
    `count=${grid.body?.data?.items?.length ?? 0} nextCursor=${grid.body?.data?.page?.nextCursor ? "yes" : "no"}`,
  );
  logRoute(
    collections,
    `count=${collections.body?.data?.items?.length ?? 0} nextCursor=${collections.body?.data?.page?.nextCursor ? "yes" : "no"} emptyReason=${collections.body?.data?.debug?.emptyReasons?.collections ?? "none"}`,
  );
  logRoute(
    achievements,
    `count=${achievements.body?.data?.items?.length ?? 0} nextCursor=${achievements.body?.data?.page?.nextCursor ? "yes" : "no"} emptyReason=${achievements.body?.data?.debug?.emptyReasons?.achievements ?? "none"}`,
  );

  console.log(`profilePicSource=${profilePicSource}`);
  if (warnings.length > 0) {
    console.log(`warnings=giant_arrays_present:${warnings.join(",")}`);
  } else {
    console.log("warnings=none");
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
