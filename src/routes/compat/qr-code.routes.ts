import type { FastifyInstance } from "fastify";
import { z } from "zod";

const GenerateQrQuerySchema = z.object({
  url: z.string().min(1),
  size: z.coerce.number().int().min(256).max(6000).optional(),
  logoUrl: z.string().url().optional()
});

const GenerateQrBodySchema = z.object({
  url: z.string().min(1),
  size: z.number().int().min(256).max(6000).optional(),
  logoUrl: z.string().url().optional()
});

async function loadQrModule() {
  return import("../../lib/qr/instagramQr.js");
}

export async function registerCompatQrCodeRoutes(app: FastifyInstance): Promise<void> {
  // Legacy endpoint used by native: /api/qr-code/generate?url=https://locava.app/profile/...
  app.get("/api/qr-code/generate", async (request, reply) => {
    const query = GenerateQrQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply
        .status(400)
        .send({ error: "URL query parameter is required. Usage: /api/qr-code/generate?url=https://example.com" });
    }

    const { generateInstagramStyleQrPngBuffer } = await loadQrModule();
    const pngBuffer = await generateInstagramStyleQrPngBuffer({
      data: query.data.url,
      size: query.data.size ?? 4000,
      logoUrl: query.data.logoUrl
    });

    reply.header("Content-Type", "image/png");
    reply.header("Cache-Control", "public, max-age=3600");
    return reply.send(pngBuffer);
  });

  app.post("/api/qr-code/generate", async (request, reply) => {
    const body = GenerateQrBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "URL is required" });
    }

    const { generateInstagramStyleQrPngBuffer } = await loadQrModule();
    const pngBuffer = await generateInstagramStyleQrPngBuffer({
      data: body.data.url,
      size: body.data.size ?? 4000,
      logoUrl: body.data.logoUrl
    });

    reply.header("Content-Type", "image/png");
    reply.header("Cache-Control", "public, max-age=3600");
    return reply.send(pngBuffer);
  });

  app.get("/api/qr-code/generate-poster", async (request, reply) => {
    const query = GenerateQrQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply
        .status(400)
        .send({ error: "URL query parameter is required. Usage: /api/qr-code/generate-poster?url=https://example.com" });
    }

    const { generatePosterStyleQrPngBuffer } = await loadQrModule();
    const pngBuffer = await generatePosterStyleQrPngBuffer({
      data: query.data.url,
      size: query.data.size ?? 4000,
      logoUrl: query.data.logoUrl
    });

    reply.header("Content-Type", "image/png");
    reply.header("Cache-Control", "public, max-age=3600");
    return reply.send(pngBuffer);
  });

  app.post("/api/qr-code/generate-poster", async (request, reply) => {
    const body = GenerateQrBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "URL is required" });
    }

    const { generatePosterStyleQrPngBuffer } = await loadQrModule();
    const pngBuffer = await generatePosterStyleQrPngBuffer({
      data: body.data.url,
      size: body.data.size ?? 4000,
      logoUrl: body.data.logoUrl
    });

    reply.header("Content-Type", "image/png");
    reply.header("Cache-Control", "public, max-age=3600");
    return reply.send(pngBuffer);
  });
}
