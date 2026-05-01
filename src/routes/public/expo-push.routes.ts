import type { FastifyInstance, FastifyReply } from "fastify";
import { success, failure } from "../../lib/response.js";

const EXPO_PUSH_SEND_URL = "https://exp.host/--/api/v2/push/send";

function setCorsHeaders(reply: FastifyReply): void {
  reply.header("access-control-allow-origin", "*");
  reply.header("access-control-allow-methods", "POST, OPTIONS");
  reply.header("access-control-allow-headers", "content-type, authorization");
  reply.header("access-control-max-age", "86400");
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseExpoRelayJson(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function registerPublicExpoPushRoutes(app: FastifyInstance): Promise<void> {
  app.options("/api/public/expo-push", async (_request, reply) => {
    setCorsHeaders(reply);
    return reply.status(204).send();
  });

  app.post("/api/public/expo-push", async (request, reply) => {
    setCorsHeaders(reply);

    const rawBody =
      request.body && typeof request.body === "object" && !Array.isArray(request.body)
        ? (request.body as Record<string, unknown>)
        : {};

    const to = asTrimmedString(rawBody.to) || asTrimmedString(rawBody.token);
    const bodyText = asTrimmedString(rawBody.body) || asTrimmedString(rawBody.message);
    const title = asTrimmedString(rawBody.title) || "Locava";
    const sound = asTrimmedString(rawBody.sound) || "default";
    const priority = asTrimmedString(rawBody.priority);
    const imageUrl = asTrimmedString(rawBody.imageUrl);
    const data =
      rawBody.data && typeof rawBody.data === "object" && !Array.isArray(rawBody.data)
        ? (rawBody.data as Record<string, unknown>)
        : {};

    if (!to) {
      return reply
        .status(400)
        .send(failure("validation_error", "Missing `to` (Expo push token), e.g. ExponentPushToken[xxxx]"));
    }

    if (!bodyText) {
      return reply.status(400).send(failure("validation_error", "Missing `body` (notification message text)"));
    }

    const expoMessage: Record<string, unknown> = {
      to,
      sound,
      title,
      body: bodyText,
      data,
    };

    if (priority) {
      expoMessage.priority = priority;
    }

    if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
      expoMessage.mutableContent = true;
      expoMessage.richContent = { image: imageUrl };
      data.imageUrl = imageUrl;
      data._richContent = JSON.stringify({ image: imageUrl });
    }

    try {
      const response = await fetch(EXPO_PUSH_SEND_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "accept-encoding": "gzip, deflate",
          "content-type": "application/json",
        },
        body: JSON.stringify(expoMessage),
      });

      const responseText = await response.text();
      const expoPayload = parseExpoRelayJson(responseText);

      if (!response.ok) {
        return reply.status(502).send(
          failure("expo_push_request_failed", "Expo Push API request failed", {
            statusCode: response.status,
            expo: expoPayload,
          })
        );
      }

      return reply.send(
        success({
          relay: {
            to,
            title,
            body: bodyText,
          },
          expo: expoPayload,
        })
      );
    } catch (error) {
      return reply.status(502).send(
        failure("expo_push_request_failed", "Expo Push API request failed", {
          message: error instanceof Error ? error.message : String(error),
        })
      );
    }
  });
}
