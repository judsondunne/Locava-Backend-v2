import type { FastifyInstance } from "fastify";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { POST_LIKE_BOOST_POST_ID } from "./postLikeBoost.constants.js";
import { addPostLikeBoost, readPostLikeBoostTracking, removePostLikeBoost } from "./postLikeBoost.service.js";

function assertOpsToken(app: FastifyInstance, request: { headers: { authorization?: string } }) {
  const token = app.config.INTERNAL_OPS_TOKEN;
  if (!token || token.length === 0) {
    return { ok: false as const, status: 503, code: "internal_ops_disabled", message: "INTERNAL_OPS_TOKEN is not configured" };
  }
  if (request.headers.authorization !== `Bearer ${token}`) {
    return { ok: false as const, status: 401, code: "unauthorized", message: "Authorization must be Bearer <INTERNAL_OPS_TOKEN>" };
  }
  return { ok: true as const };
}

export async function registerPostLikeBoostRoutes(app: FastifyInstance): Promise<void> {
  app.get("/internal/post-like-boost/status", async (request, reply) => {
    setRouteName("internal.post_like_boost.status");
    const auth = assertOpsToken(app, request);
    if (!auth.ok) {
      return reply.status(auth.status).send(failure(auth.code, auth.message));
    }

    const db = getFirestoreSourceClient();
    if (!db) {
      return reply.status(503).send(failure("firestore_unavailable", "Firestore client is not available"));
    }

    const tracking = await readPostLikeBoostTracking(db);
    return reply.send(
      success({
        postId: POST_LIKE_BOOST_POST_ID,
        tracking
      })
    );
  });

  app.post("/internal/post-like-boost/add", async (request, reply) => {
    setRouteName("internal.post_like_boost.add");
    const auth = assertOpsToken(app, request);
    if (!auth.ok) {
      return reply.status(auth.status).send(failure(auth.code, auth.message));
    }

    const db = getFirestoreSourceClient();
    if (!db) {
      return reply.status(503).send(failure("firestore_unavailable", "Firestore client is not available"));
    }

    try {
      const result = await addPostLikeBoost(db);
      return reply.send(success(result));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("post_not_found:")) {
        return reply.status(404).send(failure("post_not_found", message));
      }
      throw error;
    }
  });

  app.post("/internal/post-like-boost/remove", async (request, reply) => {
    setRouteName("internal.post_like_boost.remove");
    const auth = assertOpsToken(app, request);
    if (!auth.ok) {
      return reply.status(auth.status).send(failure(auth.code, auth.message));
    }

    const db = getFirestoreSourceClient();
    if (!db) {
      return reply.status(503).send(failure("firestore_unavailable", "Firestore client is not available"));
    }

    const result = await removePostLikeBoost(db);
    return reply.send(success(result));
  });
}
