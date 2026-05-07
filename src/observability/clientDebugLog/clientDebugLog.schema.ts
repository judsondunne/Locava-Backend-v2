import { z } from "zod";

/**
 * Schema for the production-safe Native -> Backendv2 client debug log pipeline.
 *
 * Distinct from `clientTelemetry.schema.ts` which is a structured event store.
 * This schema is intentionally permissive (free-form `name`, `kind`, `meta`)
 * so the Native logger can ship CLIENT_NET_*, CLIENT_BOOT_*, CLIENT_SCREEN_*,
 * and CLIENT_MEDIA_* events without coordinating new event types in two places.
 *
 * Hard limits below cap memory + log spam (oversized values are truncated in the
 * sanitizer before printing). Mutates nothing; never touches Firestore.
 */

const shortString = z.string().trim().max(160);
const mediumString = z.string().trim().max(512);

export const clientDebugLogKindEnum = z.enum([
  "CLIENT_LOG",
  "CLIENT_NET_START",
  "CLIENT_NET_END",
  "CLIENT_NET_SLOW",
  "CLIENT_NET_ERROR",
  "CLIENT_NET_OVERLAP",
  "CLIENT_BOOT_TRACE",
  "CLIENT_SCREEN_TRACE",
  "CLIENT_MEDIA_TRACE"
]);

export type ClientDebugLogKind = z.infer<typeof clientDebugLogKindEnum>;

export const clientDebugLogEntrySchema = z
  .object({
    kind: clientDebugLogKindEnum,
    name: shortString.optional(),
    deviceTime: z.number().int().nonnegative().optional(),
    monotonicMs: z.number().finite().nonnegative().optional(),
    surface: shortString.optional(),
    screen: shortString.optional(),
    routeName: shortString.optional(),
    requestId: shortString.optional(),
    requestKey: mediumString.optional(),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).optional(),
    urlPathOnly: mediumString.optional(),
    queryKeys: z.array(shortString).max(40).optional(),
    durationMs: z.number().finite().nonnegative().max(600_000).optional(),
    status: z.number().int().min(100).max(999).optional(),
    ok: z.boolean().optional(),
    inFlightCountForKey: z.number().int().nonnegative().max(10_000).optional(),
    totalInFlightCount: z.number().int().nonnegative().max(10_000).optional(),
    overlapCount: z.number().int().nonnegative().max(10_000).optional(),
    duplicateWindowMs: z.number().int().nonnegative().max(600_000).optional(),
    errorName: shortString.optional(),
    errorMessage: mediumString.optional(),
    caller: shortString.optional(),
    bodyKeys: z.array(shortString).max(40).optional(),
    meta: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .optional()
  })
  .strict();

export type ClientDebugLogEntry = z.infer<typeof clientDebugLogEntrySchema>;

export const clientDebugLogBatchSchema = z
  .object({
    clientSessionId: shortString,
    appBuildType: shortString.optional(),
    appVersion: shortString.optional(),
    platform: z.enum(["ios", "android", "unknown"]).optional(),
    deviceTime: z.number().int().nonnegative().optional(),
    surface: shortString.optional(),
    entries: z.array(clientDebugLogEntrySchema).min(1).max(200)
  })
  .strict();

export type ClientDebugLogBatch = z.infer<typeof clientDebugLogBatchSchema>;
