import fs from "node:fs";
import path from "node:path";
import { FieldPath, type Firestore, type Timestamp } from "firebase-admin/firestore";
import { classifyDescription, type ClassifyDescriptionResult } from "./descriptionClassifier.js";
import { collectDescriptionFieldStrings, nonEmptyDescriptionPaths } from "./descriptionFieldPaths.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isoFromFirestoreTimestamp(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const ts = value as Timestamp;
  if (typeof ts.toDate === "function") {
    const d = ts.toDate();
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  return null;
}

function extractLocationLabel(doc: Record<string, unknown>): string {
  const loc = asRecord(doc.location);
  const display = loc ? asRecord(loc.display) : null;
  const name = display && typeof display.name === "string" ? display.name.trim() : "";
  const label = display && typeof display.label === "string" ? display.label.trim() : "";
  const address = display && typeof display.address === "string" ? display.address.trim() : "";
  const place = loc ? asRecord(loc.place) : null;
  const placeName = place && typeof place.placeName === "string" ? place.placeName.trim() : "";
  const topAddress = typeof doc.address === "string" ? doc.address.trim() : "";
  const legacy = typeof doc.locationLabel === "string" ? doc.locationLabel.trim() : "";
  return [name, label, placeName, address, topAddress, legacy].find((s) => s.length > 0) ?? "";
}

function extractActivities(doc: Record<string, unknown>): string[] {
  const cls = asRecord(doc.classification);
  const fromCls = cls?.activities;
  if (Array.isArray(fromCls)) {
    return fromCls.filter((a): a is string => typeof a === "string" && a.trim().length > 0).map((a) => a.trim());
  }
  const raw = doc.activities;
  if (Array.isArray(raw)) {
    return raw.filter((a): a is string => typeof a === "string" && a.trim().length > 0).map((a) => a.trim());
  }
  return [];
}

function extractTitle(doc: Record<string, unknown>): string {
  const text = asRecord(doc.text);
  const fromText = text && typeof text.title === "string" ? text.title.trim() : "";
  if (fromText) return fromText;
  return typeof doc.title === "string" ? doc.title.trim() : "";
}

function extractClassificationSource(doc: Record<string, unknown>): string {
  const cls = asRecord(doc.classification);
  if (cls && typeof cls.source === "string" && cls.source.trim()) return cls.source.trim();
  return typeof doc.source === "string" ? doc.source.trim() : "unknown";
}

function extractImportedFrom(doc: Record<string, unknown>): string | null {
  const v = doc.importedFrom ?? doc.importSource ?? doc.imported_from;
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function basenameHints(urlOrPath: string): string {
  const s = urlOrPath.trim();
  if (!s) return "";
  const noQuery = s.split("?")[0] ?? s;
  const parts = noQuery.split("/");
  return parts[parts.length - 1] ?? noQuery;
}

function extractMediaFilenameHints(doc: Record<string, unknown>): string[] {
  const out: string[] = [];
  const media = asRecord(doc.media);
  const assets = media && Array.isArray(media.assets) ? media.assets : null;
  if (assets) {
    for (const a of assets) {
      const ar = asRecord(a);
      if (!ar) continue;
      const src = asRecord(ar.source);
      if (src && Array.isArray(src.primarySources)) {
        for (const u of src.primarySources) {
          if (typeof u === "string" && u.trim()) out.push(basenameHints(u));
        }
      }
      const img = asRecord(ar.image);
      const vid = asRecord(ar.video);
      for (const block of [img, vid]) {
        if (!block) continue;
        for (const k of ["originalUrl", "displayUrl", "thumbnailUrl", "posterUrl"]) {
          const u = block[k];
          if (typeof u === "string" && u.trim()) out.push(basenameHints(u));
        }
      }
    }
  }
  const legacy = asRecord(doc.legacy);
  const omf = legacy ? asRecord(legacy.originalMediaFields) : null;
  if (omf) {
    for (const v of Object.values(omf)) {
      if (typeof v === "string" && v.includes("/")) out.push(basenameHints(v));
    }
  }
  return [...new Set(out.filter(Boolean))].slice(0, 40);
}

function extractLifecycleTimestamps(doc: Record<string, unknown>): { createdAt: string | null; updatedAt: string | null } {
  const life = asRecord(doc.lifecycle);
  const c =
    (life?.createdAt as string | undefined) ??
    (typeof doc.createdAt === "string" ? doc.createdAt : null) ??
    isoFromFirestoreTimestamp(doc.createdAt) ??
    isoFromFirestoreTimestamp(life?.createdAt);
  const u =
    (life?.updatedAt as string | undefined) ??
    (typeof doc.updatedAt === "string" ? doc.updatedAt : null) ??
    isoFromFirestoreTimestamp(doc.updatedAt) ??
    isoFromFirestoreTimestamp(life?.updatedAt);
  return { createdAt: c ?? null, updatedAt: u ?? null };
}

function pickChosenDescription(descriptionFieldsFound: Record<string, string>): string {
  const order = ["text.description", "description", "text.caption", "caption", "appPostV2.text.description", "appPostV2.text.caption"];
  for (const key of order) {
    const v = descriptionFieldsFound[key];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return "";
}

export type DescriptionCleanupAuditRow = {
  auditRunId: string;
  postId: string;
  sourceDetected: string;
  title: string;
  activities: string[];
  locationLabel: string;
  descriptionFieldsFound: Record<string, string>;
  chosenDescription: string;
  action: "keep" | "remove" | "review";
  confidence: number;
  reasons: string[];
  matchedSignals: string[];
  /** Firestore update field paths → proposed string values (only description/caption paths). */
  fieldsToUpdate: string[];
  proposedUpdates: Record<string, string>;
  perField: Record<
    string,
    {
      value: string;
      classification: ClassifyDescriptionResult;
    }
  >;
  mediaFilenamesOrUrlsConsidered: string[];
  createdAt: string | null;
  updatedAt: string | null;
};

export type DescriptionCleanupSummary = {
  auditRunId: string;
  totalScanned: number;
  keepCount: number;
  reviewCount: number;
  removeCount: number;
  appliedCount: number;
  skippedCount: number;
  topReasons: Array<{ reason: string; count: number }>;
  examplesRemoved: Array<{ postId: string; snippet: string }>;
  examplesReview: Array<{ postId: string; snippet: string }>;
  onlyDescriptionFieldsTouched: true;
};

function mergeAction(a: DescriptionCleanupAuditRow["action"], b: ClassifyDescriptionResult["action"]): DescriptionCleanupAuditRow["action"] {
  const rank = { remove: 3, review: 2, keep: 1 };
  return rank[a] >= rank[b] ? a : b;
}

export function buildDescriptionCleanupAuditRow(
  postId: string,
  doc: Record<string, unknown>,
  auditRunId: string,
  confidenceThreshold: number,
): DescriptionCleanupAuditRow {
  const descriptionFieldsFound = collectDescriptionFieldStrings(doc);
  const chosenDescription = pickChosenDescription(descriptionFieldsFound);
  const title = extractTitle(doc);
  const activities = extractActivities(doc);
  const locationLabel = extractLocationLabel(doc);
  const mediaFilenamesOrUrlsConsidered = extractMediaFilenameHints(doc);
  const sourceDetected = extractClassificationSource(doc);
  const importedFrom = extractImportedFrom(doc);
  const { createdAt, updatedAt } = extractLifecycleTimestamps(doc);

  const nonEmpty = nonEmptyDescriptionPaths(doc);
  const perField: DescriptionCleanupAuditRow["perField"] = {};
  let postAction: DescriptionCleanupAuditRow["action"] = "keep";
  let maxConfidence = 0;
  const allReasons: string[] = [];
  const allSignals: string[] = [];

  for (const [fieldPath, value] of Object.entries(nonEmpty)) {
    const classification = classifyDescription({
      description: value,
      title,
      activities,
      location: locationLabel,
      mediaAssets: mediaFilenamesOrUrlsConsidered,
      source: sourceDetected,
      importedFrom,
      postDoc: doc,
    });
    perField[fieldPath] = { value, classification };
    postAction = mergeAction(postAction, classification.action);
    if (classification.confidence > maxConfidence) maxConfidence = classification.confidence;
    allReasons.push(...classification.reasons.map((r) => `${fieldPath}: ${r}`));
    allSignals.push(...classification.matchedSignals.map((s) => `${fieldPath}:${s}`));
  }

  const fieldsToUpdate: string[] = [];
  const proposedUpdates: Record<string, string> = {};
  for (const [fieldPath, { value, classification }] of Object.entries(perField)) {
    if (classification.action === "remove" && classification.confidence >= confidenceThreshold) {
      fieldsToUpdate.push(fieldPath);
      proposedUpdates[fieldPath] = "";
    }
  }

  if (Object.keys(nonEmpty).length === 0) {
    postAction = "keep";
    maxConfidence = 0;
  }

  return {
    auditRunId,
    postId,
    sourceDetected,
    title,
    activities,
    locationLabel,
    descriptionFieldsFound,
    chosenDescription,
    action: postAction,
    confidence: Number(maxConfidence.toFixed(4)),
    reasons: [...new Set(allReasons)],
    matchedSignals: [...new Set(allSignals)],
    fieldsToUpdate,
    proposedUpdates,
    perField,
    mediaFilenamesOrUrlsConsidered,
    createdAt,
    updatedAt,
  };
}

export type ScanBatchInput = {
  limit: number;
  startAfterPostId: string | null;
  confidenceThreshold: number;
  auditRunId: string;
};

export type ScanBatchResult = {
  rows: DescriptionCleanupAuditRow[];
  nextStartAfter: string | null;
  reachedEnd: boolean;
};

export async function scanPostsDescriptionCleanupBatch(
  db: Firestore,
  input: ScanBatchInput,
): Promise<ScanBatchResult> {
  let q = db.collection("posts").orderBy(FieldPath.documentId()).limit(input.limit);
  if (input.startAfterPostId) {
    q = q.startAfter(input.startAfterPostId) as typeof q;
  }
  const snap = await q.get();
  const rows: DescriptionCleanupAuditRow[] = [];
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const life = asRecord(data.lifecycle);
    if (life?.isDeleted === true) continue;
    if (life?.status === "deleted") continue;
    rows.push(buildDescriptionCleanupAuditRow(doc.id, data, input.auditRunId, input.confidenceThreshold));
  }
  const last = snap.docs[snap.docs.length - 1];
  const nextStartAfter = last ? last.id : null;
  const reachedEnd = snap.docs.length < input.limit;
  return { rows, nextStartAfter, reachedEnd };
}

function escapeCsvCell(value: string): string {
  if (value.includes('"') || value.includes(",") || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function writeDescriptionCleanupCsv(filePath: string, rows: DescriptionCleanupAuditRow[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const header = [
    "auditRunId",
    "postId",
    "action",
    "confidence",
    "title",
    "chosenDescription",
    "fieldsToUpdate",
    "reasons",
    "matchedSignals",
    "sourceDetected",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        escapeCsvCell(r.auditRunId),
        escapeCsvCell(r.postId),
        escapeCsvCell(r.action),
        escapeCsvCell(String(r.confidence)),
        escapeCsvCell(r.title),
        escapeCsvCell(r.chosenDescription),
        escapeCsvCell(r.fieldsToUpdate.join("|")),
        escapeCsvCell(r.reasons.join(" | ")),
        escapeCsvCell(r.matchedSignals.join(" | ")),
        escapeCsvCell(r.sourceDetected),
      ].join(","),
    );
  }
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

export function writeDescriptionCleanupJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function summarizeDescriptionCleanupRun(input: {
  auditRunId: string;
  rows: DescriptionCleanupAuditRow[];
  appliedCount: number;
  skippedCount: number;
}): DescriptionCleanupSummary {
  let keepCount = 0;
  let reviewCount = 0;
  let removeCount = 0;
  const reasonCounts = new Map<string, number>();
  const examplesRemoved: Array<{ postId: string; snippet: string }> = [];
  const examplesReview: Array<{ postId: string; snippet: string }> = [];

  for (const r of input.rows) {
    if (r.action === "keep") keepCount += 1;
    else if (r.action === "review") reviewCount += 1;
    else removeCount += 1;
    for (const reason of r.reasons) {
      const key = reason.split(":")[0] ?? reason;
      reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
    }
    if (r.action === "remove" && examplesRemoved.length < 10) {
      examplesRemoved.push({ postId: r.postId, snippet: r.chosenDescription.slice(0, 160) });
    }
    if (r.action === "review" && examplesReview.length < 10) {
      examplesReview.push({ postId: r.postId, snippet: r.chosenDescription.slice(0, 160) });
    }
  }

  const topReasons = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    auditRunId: input.auditRunId,
    totalScanned: input.rows.length,
    keepCount,
    reviewCount,
    removeCount,
    appliedCount: input.appliedCount,
    skippedCount: input.skippedCount,
    topReasons,
    examplesRemoved,
    examplesReview,
    onlyDescriptionFieldsTouched: true,
  };
}

export type ApplyDescriptionCleanupInput = {
  db: Firestore;
  rows: DescriptionCleanupAuditRow[];
  confidenceThreshold: number;
  auditRunId: string;
  /** Max Firestore documents per commit (each doc = one update). */
  batchDocSize: number;
  dryRun: boolean;
};

export type ApplyDescriptionCleanupResult = {
  appliedCount: number;
  skippedCount: number;
  errors: string[];
};

function buildAuditCleanupMap(row: DescriptionCleanupAuditRow, confidenceThreshold: number): Record<string, unknown> | null {
  const paths = row.fieldsToUpdate.filter((p) => {
    const pf = row.perField[p];
    return (
      pf &&
      pf.classification.action === "remove" &&
      pf.classification.confidence >= confidenceThreshold
    );
  });
  if (paths.length === 0) return null;

  const previousValues: Record<string, string> = {};
  for (const p of paths) {
    const cur = row.perField[p]?.value;
    if (cur !== undefined) previousValues[p] = cur;
  }

  const primary = paths[0];
  const primaryClass = primary ? row.perField[primary]?.classification : null;

  return {
    cleanedAt: new Date().toISOString(),
    cleanedBy: "description-cleanup-script",
    previousValues,
    reason: primaryClass ? primaryClass.reasons.join("; ") : "generated_junk_description",
    confidence: primaryClass?.confidence ?? row.confidence,
    auditRunId: row.auditRunId,
  };
}

export async function applyDescriptionCleanupRows(input: ApplyDescriptionCleanupInput): Promise<ApplyDescriptionCleanupResult> {
  const { db } = input;
  let appliedCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];

  if (input.dryRun) {
    let eligible = 0;
    for (const row of input.rows) {
      if (buildAuditCleanupMap(row, input.confidenceThreshold)) eligible += 1;
    }
    return {
      appliedCount: 0,
      skippedCount: input.rows.length - eligible,
      errors,
    };
  }

  const pending: DescriptionCleanupAuditRow[] = [];
  for (const row of input.rows) {
    if (buildAuditCleanupMap(row, input.confidenceThreshold)) pending.push(row);
    else skippedCount += 1;
  }

  for (let i = 0; i < pending.length; i += input.batchDocSize) {
    const slice = pending.slice(i, i + input.batchDocSize);
    const batch = db.batch();
    const refsInBatch: string[] = [];
    for (const row of slice) {
      const map = buildAuditCleanupMap(row, input.confidenceThreshold);
      if (!map) continue;
      const ref = db.collection("posts").doc(row.postId);
      const updatePayload: Record<string, unknown> = {};
      for (const p of row.fieldsToUpdate) {
        const pf = row.perField[p];
        if (!pf || pf.classification.action !== "remove" || pf.classification.confidence < input.confidenceThreshold) {
          continue;
        }
        updatePayload[p] = "";
      }
      if (Object.keys(updatePayload).length === 0) continue;
      updatePayload["audit.descriptionCleanup"] = map;
      batch.update(ref, updatePayload);
      refsInBatch.push(row.postId);
    }
    if (refsInBatch.length === 0) continue;
    try {
      await batch.commit();
      appliedCount += refsInBatch.length;
      console.info({
        event: "description_cleanup_batch_committed",
        docs: refsInBatch.length,
        appliedSoFar: appliedCount,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`batch_commit: ${msg}`);
      for (const row of slice) {
        const map = buildAuditCleanupMap(row, input.confidenceThreshold);
        if (!map) continue;
        const ref = db.collection("posts").doc(row.postId);
        const updatePayload: Record<string, unknown> = {};
        for (const p of row.fieldsToUpdate) {
          const pf = row.perField[p];
          if (!pf || pf.classification.action !== "remove" || pf.classification.confidence < input.confidenceThreshold) {
            continue;
          }
          updatePayload[p] = "";
        }
        if (Object.keys(updatePayload).length === 0) continue;
        updatePayload["audit.descriptionCleanup"] = map;
        try {
          await ref.update(updatePayload);
          appliedCount += 1;
        } catch (e2) {
          errors.push(`${row.postId}: ${e2 instanceof Error ? e2.message : String(e2)}`);
          skippedCount += 1;
        }
      }
    }
  }

  return { appliedCount, skippedCount, errors };
}
