import type { FastifyInstance } from "fastify";
import { FieldValue } from "firebase-admin/firestore";
import type { AppEnv } from "../../config/env.js";
import { resolveCompatViewerId } from "./resolve-compat-viewer-id.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { incrementDbOps, setRouteName } from "../../observability/request-context.js";

/**
 * Native reporting endpoints must stay registered even when `ENABLE_LEGACY_COMPAT_ROUTES` is off.
 * Otherwise production clients get 404 on `POST /api/reports/post` while using Backendv2 as the sole API host.
 */
export async function registerNativeReportsCompatRoutes(app: FastifyInstance, env: AppEnv): Promise<void> {
  const db = env.FIRESTORE_SOURCE_ENABLED ? getFirestoreSourceClient() : null;

  app.post<{
    Body: {
      postId?: unknown;
      reason?: unknown;
      category?: unknown;
      severity?: unknown;
      additionalDetails?: unknown;
    };
  }>("/api/reports/post", async (request, reply) => {
    setRouteName("compat.reports.post.post");
    const viewerId = resolveCompatViewerId(request);
    if (!viewerId || viewerId === "anonymous") {
      return reply.status(401).send({ success: false, error: "User not authenticated" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const postId = typeof body.postId === "string" ? body.postId.trim() : String(body.postId ?? "").trim();
    const reason = typeof body.reason === "string" ? body.reason.trim() : String(body.reason ?? "").trim();
    if (!postId || !reason) {
      return reply.status(400).send({ success: false, error: "Post ID and reason are required" });
    }

    const allowedCategories = ["spam", "inappropriate", "harassment", "violence", "copyright", "other"] as const;
    const allowedSeverities = ["low", "medium", "high", "critical"] as const;
    const categoryRaw = typeof body.category === "string" ? body.category.trim().toLowerCase() : "";
    const severityRaw = typeof body.severity === "string" ? body.severity.trim().toLowerCase() : "";
    const category = (allowedCategories as readonly string[]).includes(categoryRaw) ? categoryRaw : "other";
    const severity = (allowedSeverities as readonly string[]).includes(severityRaw) ? severityRaw : "medium";
    const additionalDetails = typeof body.additionalDetails === "string" ? body.additionalDetails : "";

    if (!db) {
      return reply.status(201).send({ success: true, reportId: `mock-report-${Date.now()}` });
    }

    try {
      const docRef = await db.collection("reportedPosts").add({
        postId,
        reason,
        reporterId: viewerId,
        reportedAt: FieldValue.serverTimestamp(),
        status: "pending",
        severity,
        category,
        additionalDetails
      });
      incrementDbOps("writes", 1);
      return reply.status(201).send({ success: true, reportId: docRef.id });
    } catch (error) {
      request.log.error(
        { routeName: "compat.reports.post.post", viewerId, postId, error: error instanceof Error ? error.message : String(error) },
        "compat report post failed"
      );
      return reply.status(500).send({ success: false, error: "Failed to report post" });
    }
  });

  app.post<{
    Body: {
      placeId?: unknown;
      reason?: unknown;
      category?: unknown;
      severity?: unknown;
      additionalDetails?: unknown;
    };
  }>("/api/reports/place", async (request, reply) => {
    setRouteName("compat.reports.place.post");
    const viewerId = resolveCompatViewerId(request);
    if (!viewerId || viewerId === "anonymous") {
      return reply.status(401).send({ success: false, error: "User not authenticated" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const placeId = typeof body.placeId === "string" ? body.placeId.trim() : String(body.placeId ?? "").trim();
    const reason = typeof body.reason === "string" ? body.reason.trim() : String(body.reason ?? "").trim();
    if (!placeId || !reason) {
      return reply.status(400).send({ success: false, error: "Place ID and reason are required" });
    }

    const allowedCategories = ["spam", "inappropriate", "harassment", "violence", "copyright", "other"] as const;
    const allowedSeverities = ["low", "medium", "high", "critical"] as const;
    const categoryRaw = typeof body.category === "string" ? body.category.trim().toLowerCase() : "";
    const severityRaw = typeof body.severity === "string" ? body.severity.trim().toLowerCase() : "";
    const category = (allowedCategories as readonly string[]).includes(categoryRaw) ? categoryRaw : "other";
    const severity = (allowedSeverities as readonly string[]).includes(severityRaw) ? severityRaw : "medium";
    const additionalDetails = typeof body.additionalDetails === "string" ? body.additionalDetails : "";

    if (!db) {
      return reply.status(201).send({ success: true, reportId: `mock-place-report-${Date.now()}` });
    }

    try {
      const docRef = await db.collection("reportedPlaces").add({
        placeId,
        reason,
        reporterId: viewerId,
        reportedAt: FieldValue.serverTimestamp(),
        status: "pending",
        severity,
        category,
        additionalDetails
      });
      incrementDbOps("writes", 1);
      return reply.status(201).send({ success: true, reportId: docRef.id });
    } catch (error) {
      request.log.error(
        {
          routeName: "compat.reports.place.post",
          viewerId,
          placeId,
          error: error instanceof Error ? error.message : String(error)
        },
        "compat report place failed"
      );
      return reply.status(500).send({ success: false, error: "Failed to report place" });
    }
  });
}
