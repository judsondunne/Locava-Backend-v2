import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppEnv } from "../../config/env.js";

const PROXY_TIMEOUT_MS = 25_000;

const AUTH_JSON_ROUTES: Array<{ method: "GET" | "POST"; url: string }> = [
  { method: "GET", url: "/api/auth/check-handle" },
  { method: "POST", url: "/api/auth/login" },
  { method: "POST", url: "/api/auth/register" },
  { method: "POST", url: "/api/auth/signin/google" },
  { method: "POST", url: "/api/auth/signin/apple" },
  { method: "POST", url: "/api/auth/profile" },
  { method: "POST", url: "/api/auth/profile/branch" },
  { method: "GET", url: "/api/users/check-exists" }
];

function trimBase(base: string): string {
  return base.replace(/\/+$/, "");
}

function authProxyDisabledMessage(): { success: false; error: string } {
  return {
    success: false,
    error:
      "Backendv2 does not implement Firebase OAuth. Set LEGACY_MONOLITH_PROXY_BASE_URL to your classic Locava API base (same paths as /api/auth/*), or point EXPO_PUBLIC_BACKEND_URL at the monolith for auth-only dev."
  };
}

async function forwardToMonolith(
  request: FastifyRequest,
  reply: FastifyReply,
  baseUrl: string
): Promise<void> {
  const rawPath = request.raw.url ?? "/";
  const target = `${trimBase(baseUrl)}${rawPath}`;

  const headers = new Headers();
  const pass = ["content-type", "authorization", "accept", "accept-language", "user-agent"] as const;
  for (const name of pass) {
    const v = request.headers[name];
    if (typeof v === "string" && v.length > 0) headers.set(name, v);
  }

  const method = request.method.toUpperCase();
  let body: string | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const ct = String(request.headers["content-type"] ?? "").toLowerCase();
    if (request.body != null && ct.includes("application/json")) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(request.body);
    }
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
  try {
    const res = await fetch(target, {
      method,
      headers,
      body,
      signal: controller.signal
    });
    reply.status(res.status);
    const resCt = res.headers.get("content-type");
    if (resCt) reply.header("content-type", resCt);
    const text = await res.text();
    if (resCt?.toLowerCase().includes("application/json")) {
      try {
        reply.send(JSON.parse(text) as unknown);
        return;
      } catch {
        reply.send(text);
        return;
      }
    }
    reply.send(text);
  } finally {
    clearTimeout(t);
  }
}

/**
 * Proxies Locava-Native auth + pre-auth user checks to the classic Express monolith when
 * `LEGACY_MONOLITH_PROXY_BASE_URL` is set. Otherwise returns explicit JSON errors (not 404).
 */
export function registerLegacyMonolithAuthProxyRoutes(app: FastifyInstance, env: AppEnv): void {
  const base = env.LEGACY_MONOLITH_PROXY_BASE_URL?.trim();

  for (const { method, url } of AUTH_JSON_ROUTES) {
    if (method === "GET") {
      app.get(url, async (request, reply) => {
        if (!base) {
          return reply.status(503).send(authProxyDisabledMessage());
        }
        return forwardToMonolith(request, reply, base);
      });
    } else {
      app.post(url, async (request, reply) => {
        if (!base) {
          return reply.status(503).send(authProxyDisabledMessage());
        }
        return forwardToMonolith(request, reply, base);
      });
    }
  }
}
