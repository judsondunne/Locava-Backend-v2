import type { FastifyInstance } from "fastify";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";

export async function registerNativeEssentialCompatRoutes(app: FastifyInstance): Promise<void> {
  app.put<{ Params: { userId: string }; Body: Record<string, unknown> }>(
    "/api/users/:userId/activity-profile",
    async (request, reply) => {
      const userId = String(request.params.userId ?? "").trim();
      if (!userId) return reply.status(400).send({ success: false, error: "userId required" });

      const body = (request.body ?? {}) as Record<string, unknown>;
      const db = getFirestoreSourceClient();
      if (db) {
        try {
          await db.collection("users").doc(userId).set(
            {
              activityProfile: body,
              updatedAt: Date.now()
            },
            { merge: true }
          );
        } catch {
          // Keep compat route non-fatal so older native clients still complete flow.
        }
      }

      return reply.send({ success: true, userId });
    }
  );
}
