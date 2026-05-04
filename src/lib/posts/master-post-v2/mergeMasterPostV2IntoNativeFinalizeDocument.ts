import type { MasterPostV2 } from "../../../contracts/master-post-v2.types.js";
import { normalizeMasterPostV2 } from "./normalizeMasterPostV2.js";
import { validateMasterPostV2, type MasterPostValidationResult } from "./validateMasterPostV2.js";

const MASTER_TOP_LEVEL_KEYS: (keyof MasterPostV2)[] = [
  "id",
  "schema",
  "lifecycle",
  "author",
  "text",
  "location",
  "classification",
  "media",
  "engagement",
  "engagementPreview",
  "ranking",
  "compatibility",
  "legacy",
  "audit"
];

export type MergeMasterPostV2FinalizeMeta = {
  usedPlaceholderGradient?: boolean;
  placeholderReason?: string | null;
};

export type MergeMasterPostV2IntoNativeFinalizeDocumentOptions = {
  now?: Date;
  finalizeMeta?: MergeMasterPostV2FinalizeMeta;
};

/**
 * Takes the legacy-shaped native finalize document from `buildNativePostDocument`, runs
 * `normalizeMasterPostV2` in `postingFinalizeV2` mode, validates, and merges canonical Master Post V2
 * top-level fields onto the same object so Firestore carries both legacy compatibility fields and
 * canonical sections in one write.
 */
export function mergeMasterPostV2IntoNativeFinalizeDocument(
  nativePostDoc: Record<string, unknown>,
  options: MergeMasterPostV2IntoNativeFinalizeDocumentOptions = {}
): {
  firestoreWrite: Record<string, unknown>;
  canonical: MasterPostV2;
  validation: MasterPostValidationResult;
} {
  const now = options.now ?? new Date();
  const normalized = normalizeMasterPostV2(nativePostDoc, {
    now,
    postingFinalizeV2: true
  });
  const canonical = normalized.canonical;

  if (options.finalizeMeta?.usedPlaceholderGradient) {
    canonical.audit.warnings.push({
      code: "placeholder_letterbox_gradient_used",
      message:
        typeof options.finalizeMeta.placeholderReason === "string" && options.finalizeMeta.placeholderReason.trim()
          ? options.finalizeMeta.placeholderReason.trim()
          : "Letterbox gradients fell back to placeholder styling for one or more slides",
      path: "letterboxGradients"
    });
    if (canonical.audit.canonicalValidationStatus === "valid") {
      canonical.audit.canonicalValidationStatus = "warning";
    }
  }

  const validation = validateMasterPostV2(canonical);
  if (validation.blockingErrors.length > 0) {
    const first = validation.blockingErrors[0];
    const err = new Error(first?.message ?? "master_post_v2_validation_failed");
    (err as { code?: string }).code = first?.code ?? "master_post_v2_validation_failed";
    throw err;
  }
  for (const w of validation.warnings) {
    canonical.audit.warnings.push(w);
  }
  if (validation.warnings.length > 0 && canonical.audit.canonicalValidationStatus === "valid") {
    canonical.audit.canonicalValidationStatus = "warning";
  }

  const firestoreWrite: Record<string, unknown> = { ...nativePostDoc };
  for (const key of MASTER_TOP_LEVEL_KEYS) {
    firestoreWrite[key] = canonical[key] as unknown;
  }
  return { firestoreWrite, canonical, validation };
}
