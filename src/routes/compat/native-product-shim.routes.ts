import type { FastifyInstance } from "fastify";
import { FieldPath } from "firebase-admin/firestore";
import { buildProductCompatViewer } from "./compat-viewer-payload.js";
import { resolveCompatViewerId } from "./resolve-compat-viewer-id.js";
import { applyViewerPatchGuarded } from "./viewer-patch-guard.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";

/**
 * Minimal native-compat routes that must exist even when `ENABLE_LEGACY_COMPAT_ROUTES` is off.
 * Without these, production clients 404 on common app-open paths.
 */
export async function registerNativeProductShimRoutes(app: FastifyInstance): Promise<void> {
  async function callV2Get(path: string, viewerId: string): Promise<Record<string, unknown> | null> {
    const res = await app.inject({
      method: "GET",
      url: path,
      headers: {
        "x-viewer-id": viewerId,
        "x-viewer-roles": "internal"
      }
    });
    if (res.statusCode < 200 || res.statusCode >= 300) return null;
    try {
      return res.json() as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async function callV2GetOrThrow(path: string, viewerId: string, routeName: string): Promise<Record<string, unknown>> {
    const payload = await callV2Get(path, viewerId);
    if (!payload) {
      throw new Error(`${routeName}: canonical v2 request failed for ${path}`);
    }
    return payload;
  }

  app.patch("/api/v1/product/viewer", async (request, reply) => {
    const viewerId = resolveCompatViewerId(request);
    const patch = (request.body ?? {}) as Record<string, unknown>;
    request.log.info(
      {
        routeName: "compat.api.product.viewer.patch",
        authViewerId: viewerId,
        patchFields: Object.keys(patch),
      },
      "compat viewer patch request"
    );
    let base = buildProductCompatViewer(viewerId);
    if (viewerId !== "anonymous") {
      const profile = await callV2GetOrThrow(
        `/v2/profiles/${encodeURIComponent(viewerId)}/bootstrap?gridLimit=6`,
        viewerId,
        "/api/v1/product/viewer"
      );
      const profileData = (profile.data as Record<string, unknown> | undefined)?.firstRender as Record<string, unknown> | undefined;
      const profileObj = (profileData?.profile as Record<string, unknown> | undefined) ?? {};
      if (typeof profileObj.name === "string") base.name = profileObj.name;
      if (typeof profileObj.handle === "string") base.handle = String(profileObj.handle).replace(/^@+/, "");
      if (typeof profileObj.profilePic === "string") base.profilePic = profileObj.profilePic;
      if (!base.handle || !base.name) {
        throw new Error("/api/v1/product/viewer: canonical profile identity required");
      }
    }
    const viewer = applyViewerPatchGuarded(base, patch);
    const etag = `viewer:${viewer.userId}:compat:${Date.now()}`;
    return reply.status(200).send({ viewer, etag });
  });

  app.post<{ Body: { userIds?: unknown } }>("/api/v1/product/users/multiple", async (request, reply) => {
    const userIds = Array.isArray(request.body?.userIds)
      ? request.body!.userIds.filter((id): id is string => typeof id === "string")
      : [];
    const db = getFirestoreSourceClient();
    const uniqueIds = [...new Set(userIds.filter((id) => typeof id === "string" && id.length > 0))];
    if (uniqueIds.length === 0 || !db) {
      return reply.send({ success: true, users: [] });
    }
    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < uniqueIds.length; i += 10) {
      const chunk = uniqueIds.slice(i, i + 10);
      const snap = await db.collection("users").where(FieldPath.documentId(), "in", chunk).get();
      const byId = new Map<string, Record<string, unknown>>();
      for (const doc of snap.docs) {
        const data = doc.data() as Record<string, unknown>;
        const handleRaw = String(data.handle ?? "").replace(/^@+/, "").trim();
        const nameRaw = String(data.name ?? data.displayName ?? "").trim();
        const profilePicRaw = String(data.profilePic ?? data.profilePicture ?? data.photo ?? "").trim();
        byId.set(doc.id, {
          id: doc.id,
          userId: doc.id,
          name: nameRaw || `User ${doc.id.slice(0, 8)}`,
          handle: handleRaw || `user_${doc.id.slice(0, 8)}`,
          profilePic: profilePicRaw
        });
      }
      for (const id of chunk) {
        const row = byId.get(id);
        if (row) rows.push(row);
      }
    }
    return reply.send({ success: true, users: rows });
  });
}
