import { z } from "zod";

const stringField = z.string().trim().min(1).max(160);
const maybeStringField = z.string().trim().max(160).optional();

const networkSchema = z
  .object({
    type: z.enum(["wifi", "cellular", "unknown", "none"]).optional(),
    cellularGeneration: z.enum(["2g", "3g", "4g", "5g"]).nullable().optional(),
    isInternetReachable: z.boolean().nullable().optional(),
    isConnectionExpensive: z.boolean().nullable().optional()
  })
  .strict()
  .optional();

const videoSchema = z
  .object({
    selectedUrlKind: maybeStringField,
    startupTier: maybeStringField,
    selectedReason: maybeStringField,
    posterPresent: z.boolean().optional(),
    gradientPresent: z.boolean().optional(),
    sourcePresent: z.boolean().optional(),
    firstFrameMs: z.number().finite().nonnegative().max(120_000).optional(),
    mountToFirstFrameMs: z.number().finite().nonnegative().max(120_000).optional(),
    visibleToFirstFrameMs: z.number().finite().nonnegative().max(120_000).optional(),
    stalled: z.boolean().optional(),
    error: z.boolean().optional()
  })
  .strict()
  .optional();

const imageSchema = z
  .object({
    qualityKind: maybeStringField,
    sourceField: maybeStringField,
    isThumbnail: z.boolean().optional(),
    renderWidth: z.number().int().nonnegative().max(100_000).optional(),
    renderHeight: z.number().int().nonnegative().max(100_000).optional(),
    sourceWidth: z.number().int().nonnegative().max(100_000).optional(),
    sourceHeight: z.number().int().nonnegative().max(100_000).optional()
  })
  .strict()
  .optional();

const metaSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional();

export const clientTelemetryEventSchema = z
  .object({
    eventId: stringField,
    sessionId: stringField,
    clientTimestampMs: z.number().int().nonnegative(),
    monotonicMs: z.number().finite().nonnegative().optional(),
    category: z.enum(["app", "screen", "route", "network", "feed", "video", "liftable", "image", "social", "error"]),
    name: stringField,
    surface: maybeStringField,
    screen: maybeStringField,
    routeName: maybeStringField,
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).optional(),
    path: z.string().trim().max(512).optional(),
    postId: maybeStringField,
    assetId: maybeStringField,
    sourceSurface: maybeStringField,
    durationMs: z.number().finite().nonnegative().max(600_000).optional(),
    statusCode: z.number().int().min(100).max(999).optional(),
    ok: z.boolean().optional(),
    errorCode: maybeStringField,
    payloadBytes: z.number().int().nonnegative().max(10_000_000).optional(),
    responseBytes: z.number().int().nonnegative().max(10_000_000).optional(),
    requestBytes: z.number().int().nonnegative().max(10_000_000).optional(),
    network: networkSchema,
    video: videoSchema,
    image: imageSchema,
    meta: metaSchema
  })
  .strict();

export const clientTelemetryBatchSchema = z
  .object({
    sessionId: stringField,
    appInstanceId: stringField,
    buildProfile: maybeStringField,
    appVersion: maybeStringField,
    platform: z.enum(["ios", "android"]).optional(),
    fieldTestSessionId: z.string().trim().min(1).max(220).optional(),
    events: z.array(clientTelemetryEventSchema).min(1).max(50)
  })
  .strict();

export type ClientTelemetryEvent = z.infer<typeof clientTelemetryEventSchema>;
export type ClientTelemetryBatch = z.infer<typeof clientTelemetryBatchSchema>;
