import { normalizeCanonicalPostLocation } from "../../lib/location/post-location-normalizer.js";
import { resolveReverseGeocodeDetails } from "../../lib/location/reverse-geocode.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";

const ADDRESS_UPDATE_ALLOWLIST = new Set([
  "location.display.address"
]);

const PREVIEW_MAX = 100;
const RUN_BATCH_MAX = 50;
const DEFAULT_BATCH_LIMIT = 10;

type FirestoreDoc = {
  id: string;
  data: () => Record<string, unknown>;
};

export type AddressBackfillCandidate = {
  postId: string;
  lat: number;
  lng: number;
  title?: string;
  userId?: string;
  time?: unknown;
  currentAddress?: string | null;
};

export type AddressBackfillResult = {
  postId: string;
  lat: number;
  lng: number;
  foundAddress: string | null;
  writePayload: Record<string, unknown>;
  dryRun: boolean;
  status: "skipped" | "resolved" | "updated" | "failed";
  reason?: string;
};

export type AddressBackfillPreviewRow = AddressBackfillCandidate & {
  status: "candidate" | "skipped";
  reason?: string;
  resolvedAddress?: string | null;
};

export type AddressBackfillPreviewResponse = {
  scannedCount: number;
  candidateCount: number;
  skippedAlreadyAddressCount: number;
  skippedInvalidCoordsCount: number;
  skippedDeletedCount: number;
  rows: AddressBackfillPreviewRow[];
  nextCursor: string | null;
  limit: number;
  reachedEnd: boolean;
};

export type AddressBackfillRunBatchResponse = {
  scanned: number;
  attempted: number;
  updated: number;
  dryRunResolved: number;
  skippedAlreadyAddress: number;
  skippedInvalidCoordinates: number;
  failed: number;
  errors: string[];
  results: AddressBackfillResult[];
  nextCursor: string | null;
  reachedEnd: boolean;
};

type ResolveAddressFn = typeof resolveReverseGeocodeDetails;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readPath(record: Record<string, unknown>, ...path: string[]): unknown {
  let current: unknown = record;
  for (const segment of path) {
    const next = asRecord(current);
    if (!next) return undefined;
    current = next[segment];
  }
  return current;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isValidCoord(lat: number | null, lng: number | null): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isCoordinateLikeAddress(value: string | null): boolean {
  if (!value) return false;
  const match = value
    .trim()
    .match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!match) return false;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function extractCoordinates(post: Record<string, unknown>): { lat: number; lng: number } | null {
  const nestedLat = toFiniteNumber(readPath(post, "location", "coordinates", "lat"));
  const nestedLng = toFiniteNumber(readPath(post, "location", "coordinates", "lng"));
  if (nestedLat != null && nestedLng != null && isValidCoord(nestedLat, nestedLng)) {
    return { lat: nestedLat, lng: nestedLng };
  }
  const rootLat = toFiniteNumber(post.lat);
  const rootLong = toFiniteNumber(post.long);
  if (rootLat != null && rootLong != null && isValidCoord(rootLat, rootLong)) {
    return { lat: rootLat, lng: rootLong };
  }
  return null;
}

export function isDeletedPostForAddressBackfill(post: Record<string, unknown>): boolean {
  if (post.deletedAt != null) return true;
  if (readPath(post, "lifecycle", "isDeleted") === true) return true;
  const status = toNonEmptyString(readPath(post, "lifecycle", "status"));
  return status?.toLowerCase() === "deleted";
}

export function hasMissingAddress(post: Record<string, unknown>, force: boolean): boolean {
  if (force) return true;
  const current = toNonEmptyString(readPath(post, "location", "display", "address"));
  return current == null || isCoordinateLikeAddress(current);
}

export function buildAddressOnlyWritePayload(input: {
  address: string | null;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    "location.display.address": input.address
  };
  return payload;
}

export function assertAddressOnlyWritePayload(writePayload: Record<string, unknown>): void {
  for (const key of Object.keys(writePayload)) {
    if (!ADDRESS_UPDATE_ALLOWLIST.has(key)) {
      throw new Error(`address_backfill_disallowed_field:${key}`);
    }
  }
}

export function sanitizeResolvedAddress(address: string | null): string | null {
  const full = toNonEmptyString(address);
  if (!full) return null;
  const parts = full.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return full;
  const countryTokens = new Set([
    "US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA", "HU", "HUNGARY", "GR", "GREECE", "ΕΛΛΑΔΑ",
    "GB", "UNITED KINGDOM", "CA", "CANADA", "AU", "AUSTRALIA", "DE", "GERMANY", "FR", "FRANCE", "IT", "ITALY",
    "ES", "SPAIN", "PT", "PORTUGAL", "NL", "NETHERLANDS", "BE", "BELGIUM", "AT", "AUSTRIA", "CH", "SWITZERLAND",
    "IE", "IRELAND", "SE", "SWEDEN", "NO", "NORWAY", "DK", "DENMARK", "FI", "FINLAND", "PL", "POLAND", "CZ", "CZECHIA",
    "SK", "SLOVAKIA", "SI", "SLOVENIA", "HR", "CROATIA", "RO", "ROMANIA", "BG", "BULGARIA", "RS", "SERBIA", "AL", "ALBANIA",
    "ME", "MONTENEGRO", "MK", "NORTH MACEDONIA", "TR", "TURKEY", "JP", "JAPAN", "KR", "SOUTH KOREA", "CN", "CHINA", "IN", "INDIA",
    "BR", "BRAZIL", "MX", "MEXICO", "AR", "ARGENTINA", "CL", "CHILE", "PE", "PERU", "ZA", "SOUTH AFRICA", "NZ", "NEW ZEALAND"
  ]);
  const normalizeToken = (value: string): string =>
    value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const countyHints = [
    "county",
    "parish",
    "prefecture",
    "regional municipality",
    "regional county municipality",
    "periferiaki enotita",
    "περιφερειακή ενότητα",
    "Δημοτική Ενότητα",
    "municipio",
    "canton",
    "arrondissement"
  ];
  const filtered = parts.filter((part, index) => {
    const normalized = normalizeToken(part);
    const isTrailingCountry = index === parts.length - 1 && (/^[A-Z]{2,3}$/.test(normalized) || countryTokens.has(normalized));
    if (isTrailingCountry) return false;
    const lower = part.toLowerCase();
    if (countyHints.some((hint) => lower.includes(hint.toLowerCase()))) return false;
    return true;
  });
  return toNonEmptyString(filtered.join(", ")) ?? full;
}

export class AddressBackfillService {
  constructor(
    private readonly resolveAddress: ResolveAddressFn = resolveReverseGeocodeDetails
  ) {}

  async preview(input: {
    limit?: number;
    cursor?: string;
    resolve?: boolean;
    force?: boolean;
  }): Promise<AddressBackfillPreviewResponse> {
    const db = getFirestoreSourceClient();
    if (!db) throw new Error("firestore_unavailable");
    const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_BATCH_LIMIT, PREVIEW_MAX));
    const cursor = Number(input.cursor ?? "0");
    const offset = Number.isFinite(cursor) && cursor >= 0 ? Math.floor(cursor) : 0;
    const scanLimit = Math.max(limit, Math.min(PREVIEW_MAX, limit * 5));
    const snap = await db.collection("posts").orderBy("time", "desc").offset(offset).limit(scanLimit).get();
    const rows: AddressBackfillPreviewRow[] = [];
    let skippedAlreadyAddressCount = 0;
    let skippedInvalidCoordsCount = 0;
    let skippedDeletedCount = 0;
    for (const doc of snap.docs as FirestoreDoc[]) {
      const post = doc.data();
      if (isDeletedPostForAddressBackfill(post)) {
        skippedDeletedCount += 1;
        rows.push({ postId: doc.id, lat: 0, lng: 0, status: "skipped", reason: "deleted" });
        continue;
      }
      if (!hasMissingAddress(post, Boolean(input.force))) {
        skippedAlreadyAddressCount += 1;
        rows.push({ postId: doc.id, lat: 0, lng: 0, status: "skipped", reason: "already_has_address" });
        continue;
      }
      const coords = extractCoordinates(post);
      if (!coords) {
        skippedInvalidCoordsCount += 1;
        rows.push({ postId: doc.id, lat: 0, lng: 0, status: "skipped", reason: "invalid_coordinates" });
        continue;
      }
      const candidate: AddressBackfillPreviewRow = {
        postId: doc.id,
        lat: coords.lat,
        lng: coords.lng,
        title: toNonEmptyString(post.title) ?? toNonEmptyString(readPath(post, "text", "title")) ?? undefined,
        userId: toNonEmptyString(post.userId) ?? toNonEmptyString(readPath(post, "author", "userId")) ?? undefined,
        time: post.time ?? readPath(post, "lifecycle", "createdAt") ?? post.updatedAt,
        currentAddress: toNonEmptyString(readPath(post, "location", "display", "address")),
        status: "candidate"
      };
      if (input.resolve === true) {
        const match = await this.resolveAddress({
          lat: candidate.lat,
          lng: candidate.lng,
          allowNetwork: true,
          timeoutMs: 180
        });
        const normalized = normalizeCanonicalPostLocation({
          latitude: candidate.lat,
          longitude: candidate.lng,
          addressDisplayName: match?.addressDisplayName ?? null,
          city: match?.city ?? null,
          region: match?.region ?? null,
          country: match?.country ?? null,
          source: "user_selected",
          reverseGeocodeMatched: match?.matched === true
        });
        candidate.resolvedAddress = sanitizeResolvedAddress(normalized.addressDisplayName ?? null);
      }
      rows.push(candidate);
      if (rows.filter((row) => row.status === "candidate").length >= limit) break;
    }
    const candidateRows = rows.filter((row) => row.status === "candidate");
    return {
      scannedCount: snap.size,
      candidateCount: candidateRows.length,
      skippedAlreadyAddressCount,
      skippedInvalidCoordsCount,
      skippedDeletedCount,
      rows,
      nextCursor: String(offset + snap.size),
      limit,
      reachedEnd: snap.size < scanLimit
    };
  }

  async runOne(input: {
    postId: string;
    dryRun?: boolean;
    force?: boolean;
    confirmAddressOnlyWrite?: boolean;
  }): Promise<AddressBackfillResult> {
    const db = getFirestoreSourceClient();
    if (!db) throw new Error("firestore_unavailable");
    const dryRun = input.dryRun !== false;
    const postRef = db.collection("posts").doc(input.postId);
    const snap = await postRef.get();
    if (!snap.exists) {
      return {
        postId: input.postId,
        lat: 0,
        lng: 0,
        foundAddress: null,
        writePayload: {},
        dryRun,
        status: "failed",
        reason: "post_not_found"
      };
    }
    const post = (snap.data() ?? {}) as Record<string, unknown>;
    if (isDeletedPostForAddressBackfill(post)) {
      return { postId: input.postId, lat: 0, lng: 0, foundAddress: null, writePayload: {}, dryRun, status: "skipped", reason: "deleted" };
    }
    if (!hasMissingAddress(post, Boolean(input.force))) {
      return {
        postId: input.postId,
        lat: 0,
        lng: 0,
        foundAddress: toNonEmptyString(readPath(post, "location", "display", "address")),
        writePayload: {},
        dryRun,
        status: "skipped",
        reason: "already_has_address"
      };
    }
    const coords = extractCoordinates(post);
    if (!coords) {
      return { postId: input.postId, lat: 0, lng: 0, foundAddress: null, writePayload: {}, dryRun, status: "skipped", reason: "invalid_coordinates" };
    }
    let match: Awaited<ReturnType<ResolveAddressFn>>;
    try {
      match = await this.resolveAddress({
        lat: coords.lat,
        lng: coords.lng,
        allowNetwork: true,
        timeoutMs: 180
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        postId: input.postId,
        lat: coords.lat,
        lng: coords.lng,
        foundAddress: null,
        writePayload: {},
        dryRun,
        status: "failed",
        reason: message
      };
    }
    const normalized = normalizeCanonicalPostLocation({
      latitude: coords.lat,
      longitude: coords.lng,
      addressDisplayName: match?.addressDisplayName ?? null,
      city: match?.city ?? null,
      region: match?.region ?? null,
      country: match?.country ?? null,
      source: "user_selected",
      reverseGeocodeMatched: match?.matched === true
    });
    const resolvedAddress = sanitizeResolvedAddress(normalized.addressDisplayName ?? null);
    const writePayload = buildAddressOnlyWritePayload({
      address: resolvedAddress
    });
    assertAddressOnlyWritePayload(writePayload);
    if (dryRun) {
      return {
        postId: input.postId,
        lat: coords.lat,
        lng: coords.lng,
        foundAddress: resolvedAddress,
        writePayload,
        dryRun: true,
        status: "resolved"
      };
    }
    if (input.confirmAddressOnlyWrite !== true) {
      return {
        postId: input.postId,
        lat: coords.lat,
        lng: coords.lng,
        foundAddress: normalized.addressDisplayName ?? null,
        writePayload,
        dryRun: false,
        status: "failed",
        reason: "confirm_address_only_write_required"
      };
    }
    console.info("[address_backfill] write_start", {
      postId: input.postId,
      lat: coords.lat,
      lng: coords.lng,
      resolvedAddress,
      updateFieldPaths: Object.keys(writePayload)
    });
    try {
      await postRef.update(writePayload);
      console.info("[address_backfill] write_success", {
        postId: input.postId,
        lat: coords.lat,
        lng: coords.lng,
        resolvedAddress,
        updateFieldPaths: Object.keys(writePayload)
      });
      return {
        postId: input.postId,
        lat: coords.lat,
        lng: coords.lng,
        foundAddress: resolvedAddress,
        writePayload,
        dryRun: false,
        status: "updated"
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[address_backfill] write_failed", {
        postId: input.postId,
        lat: coords.lat,
        lng: coords.lng,
        resolvedAddress,
        updateFieldPaths: Object.keys(writePayload),
        error: message
      });
      return {
        postId: input.postId,
        lat: coords.lat,
        lng: coords.lng,
        foundAddress: resolvedAddress,
        writePayload,
        dryRun: false,
        status: "failed",
        reason: message
      };
    }
  }

  async runBatch(input: {
    limit?: number;
    cursor?: string;
    dryRun?: boolean;
    force?: boolean;
    confirmAddressOnlyWrite?: boolean;
  }): Promise<AddressBackfillRunBatchResponse> {
    const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_BATCH_LIMIT, RUN_BATCH_MAX));
    const preview = await this.preview({
      limit,
      cursor: input.cursor,
      resolve: false,
      force: input.force
    });
    const candidateRows = preview.rows.filter((row) => row.status === "candidate").slice(0, limit);
    const results: AddressBackfillResult[] = [];
    const errors: string[] = [];
    let updated = 0;
    let dryRunResolved = 0;
    let failed = 0;
    for (const row of candidateRows) {
      const res = await this.runOne({
        postId: row.postId,
        dryRun: input.dryRun,
        force: input.force,
        confirmAddressOnlyWrite: input.confirmAddressOnlyWrite
      });
      results.push(res);
      if (res.status === "updated") updated += 1;
      if (res.status === "resolved") dryRunResolved += 1;
      if (res.status === "failed") {
        failed += 1;
        errors.push(`${row.postId}:${res.reason ?? "failed"}`);
      }
    }
    return {
      scanned: preview.scannedCount,
      attempted: candidateRows.length,
      updated,
      dryRunResolved,
      skippedAlreadyAddress: preview.skippedAlreadyAddressCount,
      skippedInvalidCoordinates: preview.skippedInvalidCoordsCount,
      failed,
      errors,
      results,
      nextCursor: preview.nextCursor,
      reachedEnd: preview.reachedEnd
    };
  }

  async runAll(input: {
    batchLimit?: number;
    dryRun?: boolean;
    force?: boolean;
    confirmAddressOnlyWrite?: boolean;
    maxBatches?: number;
  }): Promise<AddressBackfillRunBatchResponse & { batches: number }> {
    const batchLimit = Math.max(1, Math.min(input.batchLimit ?? DEFAULT_BATCH_LIMIT, RUN_BATCH_MAX));
    const maxBatches = Math.max(1, Math.min(input.maxBatches ?? 200, 1000));
    let cursor: string | undefined = "0";
    let batches = 0;
    let scanned = 0;
    let attempted = 0;
    let updated = 0;
    let dryRunResolved = 0;
    let skippedAlreadyAddress = 0;
    let skippedInvalidCoordinates = 0;
    let failed = 0;
    let reachedEnd = false;
    const errors: string[] = [];
    const results: AddressBackfillResult[] = [];
    while (batches < maxBatches) {
      const batch = await this.runBatch({
        limit: batchLimit,
        cursor,
        dryRun: input.dryRun,
        force: input.force,
        confirmAddressOnlyWrite: input.confirmAddressOnlyWrite
      });
      batches += 1;
      scanned += batch.scanned;
      attempted += batch.attempted;
      updated += batch.updated;
      dryRunResolved += batch.dryRunResolved;
      skippedAlreadyAddress += batch.skippedAlreadyAddress;
      skippedInvalidCoordinates += batch.skippedInvalidCoordinates;
      failed += batch.failed;
      reachedEnd = batch.reachedEnd;
      errors.push(...batch.errors);
      results.push(...batch.results);
      if (batch.reachedEnd || !batch.nextCursor || batch.nextCursor === cursor) {
        cursor = batch.nextCursor ?? undefined;
        break;
      }
      cursor = batch.nextCursor;
    }
    return {
      scanned,
      attempted,
      updated,
      dryRunResolved,
      skippedAlreadyAddress,
      skippedInvalidCoordinates,
      failed,
      errors,
      results,
      nextCursor: cursor ?? null,
      reachedEnd,
      batches
    };
  }
}

export const addressBackfillService = new AddressBackfillService();
