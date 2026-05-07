import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type AuditAction = "deleted" | "disabled" | "guarded" | "gated" | "kept_read_only" | "violation";

export type CatalogEntry = {
  filePath: string;
  scriptNames: string[];
  exactDangerousOperation: string;
  touchesPosts: boolean;
  canRunAgainstProduction: boolean;
  expectedAction: Exclude<AuditAction, "violation">;
};

export type AuditResult = CatalogEntry & {
  actualAction: AuditAction;
  reasons: string[];
};

export type PackageScriptFinding = {
  scriptName: string;
  command: string;
  status: "ok" | "violation";
  reasons: string[];
};

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const packageJsonPath = path.join(repoRoot, "package.json");
const createAppPath = "src/app/createApp.ts";

const dangerousCatalog: CatalogEntry[] = [
  {
    filePath: "scripts/debug-feed-for-you-simple.mts",
    scriptNames: ["debug:feed-for-you:simple", "debug:feed:for-you-simple", "debug:feed:for-you-ready-deck"],
    exactDangerousOperation: "wipePostsCollection() deletes /posts and seedPosts(...) rewrites harness posts",
    touchesPosts: true,
    canRunAgainstProduction: true,
    expectedAction: "disabled"
  },
  {
    filePath: "scripts/debug-reset-feed-state.mts",
    scriptNames: ["debug:reset-feed-state"],
    exactDangerousOperation: "Deletes feedState/feedServed debug state from Firestore",
    touchesPosts: false,
    canRunAgainstProduction: true,
    expectedAction: "guarded"
  },
  {
    filePath: "scripts/backfill-post-random-key.mts",
    scriptNames: ["backfill:post-random-key"],
    exactDangerousOperation: "Batch set across /posts randomKey field",
    touchesPosts: true,
    canRunAgainstProduction: true,
    expectedAction: "guarded"
  },
  {
    filePath: "scripts/backfill-user-search-fields.mts",
    scriptNames: ["backfill:user-search-fields"],
    exactDangerousOperation: "Writes search fields into user documents when not dry-run",
    touchesPosts: false,
    canRunAgainstProduction: true,
    expectedAction: "guarded"
  },
  {
    filePath: "scripts/backfill-user-phone-search-keys.mts",
    scriptNames: ["backfill:user-phone-search-keys"],
    exactDangerousOperation: "Writes phone-derived search keys into user documents when --write is used",
    touchesPosts: false,
    canRunAgainstProduction: true,
    expectedAction: "guarded"
  },
  {
    filePath: "scripts/repair-user-document-shape.mts",
    scriptNames: [],
    exactDangerousOperation: "Repairs user documents with Firestore set(..., merge:true) when --apply is used",
    touchesPosts: false,
    canRunAgainstProduction: true,
    expectedAction: "guarded"
  },
  {
    filePath: "scripts/seed-inbox-notifications.mts",
    scriptNames: ["debug:notifications:seed-inbox"],
    exactDangerousOperation: "Creates notification rows in Firestore when not dry-run",
    touchesPosts: false,
    canRunAgainstProduction: true,
    expectedAction: "guarded"
  },
  {
    filePath: "scripts/audit-home-feeds.mts",
    scriptNames: ["budget:home-feeds"],
    exactDangerousOperation: "Deletes viewer feed state before route audit",
    touchesPosts: false,
    canRunAgainstProduction: true,
    expectedAction: "guarded"
  },
  {
    filePath: "scripts/debug-full-app-v2-audit.mts",
    scriptNames: ["debug:full-app:v2-audit"],
    exactDangerousOperation: "Creates and deletes Firestore fixture posts/comments/users during audit runs",
    touchesPosts: true,
    canRunAgainstProduction: true,
    expectedAction: "guarded"
  },
  {
    filePath: "scripts/debug-real-user-v2-semantics.mts",
    scriptNames: ["debug:real-user:v2-semantics"],
    exactDangerousOperation: "Writes temporary semantic probe fixtures against Firestore",
    touchesPosts: true,
    canRunAgainstProduction: true,
    expectedAction: "guarded"
  },
  {
    filePath: "scripts/emergency-restore-posts-from-canonical-backups.ts",
    scriptNames: ["emergency:restore-posts:dry-run", "emergency:restore-posts:apply"],
    exactDangerousOperation: "Emergency restore can overwrite /posts from canonical backups",
    touchesPosts: true,
    canRunAgainstProduction: true,
    expectedAction: "disabled"
  },
  {
    filePath: "test/firestore/common.mts",
    scriptNames: ["test:firestore:reset", "test:firestore:seed", "test:deterministic"],
    exactDangerousOperation: "Resets emulator database and reseeds documents, including /posts",
    touchesPosts: true,
    canRunAgainstProduction: false,
    expectedAction: "guarded"
  },
  {
    filePath: "src/routes/v2/feed-for-you-simple.routes.test.ts",
    scriptNames: ["test:feed.for-you.simple", "test:feed-for-you:simple:emulator"],
    exactDangerousOperation: "Emulator test deletes /posts, rewrites /posts, and seeds feedSeen rows",
    touchesPosts: true,
    canRunAgainstProduction: true,
    expectedAction: "guarded"
  },
  {
    filePath: "src/routes/v2/feed-for-you.routes.test.ts",
    scriptNames: ["test:feed-for-you:emulator"],
    exactDangerousOperation: "Emulator test writes /posts and feedState fixtures",
    touchesPosts: true,
    canRunAgainstProduction: true,
    expectedAction: "guarded"
  },
  {
    filePath: "src/routes/debug/post-rebuilder.routes.ts",
    scriptNames: [],
    exactDangerousOperation: "Debug route can overwrite /posts documents and related user-post mirrors",
    touchesPosts: true,
    canRunAgainstProduction: true,
    expectedAction: "gated"
  },
  {
    filePath: "src/routes/debug/emergency-post-restore.routes.ts",
    scriptNames: [],
    exactDangerousOperation: "Debug route can restore and overwrite /posts",
    touchesPosts: true,
    canRunAgainstProduction: true,
    expectedAction: "gated"
  },
  {
    filePath: "src/routes/debug/post-canonical-backups-restore-preview.routes.ts",
    scriptNames: [],
    exactDangerousOperation: "Debug restore preview route participates in restore workflows touching /posts",
    touchesPosts: true,
    canRunAgainstProduction: true,
    expectedAction: "gated"
  }
];

function readRelative(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function listFilesRecursive(rootRelative: string): string[] {
  const start = path.join(repoRoot, rootRelative);
  if (!fs.existsSync(start)) return [];
  const out: string[] = [];
  const walk = (absoluteDir: string) => {
    for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
      const absolute = path.join(absoluteDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      const relative = path.relative(repoRoot, absolute).split(path.sep).join("/");
      out.push(relative);
    }
  };
  walk(start);
  return out;
}

function hasGuard(text: string): boolean {
  return text.includes("assertEmulatorOnlyDestructiveFirestoreOperation");
}

function hasDisabledThrow(text: string): boolean {
  return text.includes("PERMANENTLY_DISABLED_PRODUCTION_SAFETY");
}

function createAppGatesDangerousRoutes(createAppText: string): boolean {
  return (
    createAppText.includes("shouldRegisterDangerousFirestoreDebugRoutes") &&
    createAppText.includes("dangerous_firestore_debug_routes_disabled") &&
    createAppText.includes("app.register(registerPostRebuilderRoutes)") &&
    createAppText.includes("app.register(registerEmergencyPostRestoreRoutes)") &&
    createAppText.includes("app.register(registerPostCanonicalBackupsRestorePreviewRoutes)")
  );
}

function detectActualAction(entry: CatalogEntry, fileText: string, createAppText: string): AuditResult {
  const reasons: string[] = [];
  let actualAction: AuditAction = "violation";

  if (entry.expectedAction === "disabled") {
    if (hasDisabledThrow(fileText)) {
      actualAction = "disabled";
      reasons.push("permanent_disable_marker_present");
    } else {
      reasons.push("missing_permanent_disable_marker");
    }
  } else if (entry.expectedAction === "guarded") {
    if (hasGuard(fileText)) {
      actualAction = "guarded";
      reasons.push("destructive_guard_present");
    } else {
      reasons.push("missing_destructive_guard");
    }
  } else if (entry.expectedAction === "gated") {
    if (createAppGatesDangerousRoutes(createAppText)) {
      actualAction = "gated";
      reasons.push("dangerous_debug_route_registration_is_gated");
    } else {
      reasons.push("missing_create_app_dangerous_route_gate");
    }
  } else {
    actualAction = entry.expectedAction;
    reasons.push("kept_read_only");
  }

  return {
    ...entry,
    actualAction,
    reasons
  };
}

function parsePackageScripts(): Record<string, string> {
  const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { scripts?: Record<string, string> };
  return parsed.scripts ?? {};
}

function referencedScriptPath(command: string): string | null {
  const match = command.match(/(?:scripts|test)\/[A-Za-z0-9_./:-]+\.(?:mts|ts|js|cjs)/);
  return match ? match[0].replace(/\\/g, "/") : null;
}

function evaluatePackageScripts(catalogResults: AuditResult[]): PackageScriptFinding[] {
  const scripts = parsePackageScripts();
  const catalogByPath = new Map(catalogResults.map((entry) => [entry.filePath, entry]));
  const findings: PackageScriptFinding[] = [];

  for (const [scriptName, command] of Object.entries(scripts)) {
    const reasons: string[] = [];
    const referencedPath = referencedScriptPath(command);
    const referencedEntry = referencedPath ? catalogByPath.get(referencedPath) ?? null : null;
    const disabledByRefusal = command.includes("scripts/safety/refuse-dangerous-script.cjs");

    if (command.includes("firebase firestore:delete")) {
      reasons.push("forbidden_firebase_firestore_delete_command");
    }

    if (
      ["debug:feed-for-you:simple", "debug:feed:for-you-simple", "debug:feed:for-you-ready-deck", "emergency:restore-posts:apply"].includes(
        scriptName
      ) &&
      !disabledByRefusal
    ) {
      reasons.push("known_dangerous_script_not_routed_to_refusal_stub");
    }

    if (referencedEntry?.actualAction === "violation") {
      reasons.push(`references_unprotected_file:${referencedEntry.filePath}`);
    }

    if (scriptName === "test:firestore:reset" || scriptName === "test:firestore:seed") {
      if (!command.includes("ALLOW_DESTRUCTIVE_FIRESTORE_EMULATOR_ONLY=I_UNDERSTAND_THIS_ONLY_RUNS_ON_EMULATOR")) {
        reasons.push("missing_destructive_emulator_confirmation_env");
      }
      if (!command.includes("ALLOW_POSTS_WIPE_IN_EMULATOR=I_UNDERSTAND_POSTS_WIPE_EMULATOR_ONLY")) {
        reasons.push("missing_posts_wipe_confirmation_env");
      }
    }

    findings.push({
      scriptName,
      command,
      status: reasons.length > 0 ? "violation" : "ok",
      reasons
    });
  }

  return findings.sort((a, b) => a.scriptName.localeCompare(b.scriptName));
}

function findUnexpectedDangerousFiles(catalogPaths: Set<string>): AuditResult[] {
  const createAppText = readRelative(createAppPath);
  const candidateRoots = ["scripts", "test", "src/routes/debug"];
  const candidates = new Set<string>();
  for (const root of candidateRoots) {
    for (const relativePath of listFilesRecursive(root)) {
      if (!/\.(?:ts|mts|js|cjs)$/.test(relativePath)) continue;
      if (relativePath.startsWith("scripts/safety/")) continue;
      const text = readRelative(relativePath);
      const hasFirestoreSignal = /getFirestoreSourceClient|getFirestore\(|firebase-admin\/firestore|FirebaseFirestore\./.test(
        text
      );
      const touchesPostsWrite =
        /collection\((["'])posts\1\)[\s\S]{0,300}(batch\.delete\(|batch\.set\(|\.delete\(|\.set\(|\.update\()/.test(
          text
        ) ||
        /collection\((["'])posts\1\)\.doc\([^)]*\)\.(set|delete|update)\(/.test(text) ||
        /batch\.(delete|set)\([^)]*collection\((["'])posts\2\)/.test(text);
      const hasDeleteCollection = /deleteCollection|recursiveDelete|wipePostsCollection|firestore:delete/.test(text);
      if (hasFirestoreSignal && (touchesPostsWrite || hasDeleteCollection)) {
        candidates.add(relativePath);
      }
    }
  }

  const out: AuditResult[] = [];
  for (const relativePath of [...candidates].sort()) {
    if (catalogPaths.has(relativePath)) continue;
    const text = readRelative(relativePath);
    const guarded = hasGuard(text);
    const gated = createAppGatesDangerousRoutes(createAppText) && relativePath.startsWith("src/routes/debug/");
    out.push({
      filePath: relativePath,
      scriptNames: [],
      exactDangerousOperation: "Unexpected dangerous /posts write or delete pattern",
      touchesPosts: true,
      canRunAgainstProduction: true,
      expectedAction: guarded ? "guarded" : gated ? "gated" : "guarded",
      actualAction: guarded ? "guarded" : gated ? "gated" : "violation",
      reasons: guarded
        ? ["destructive_guard_present"]
        : gated
          ? ["dangerous_debug_route_registration_is_gated"]
          : ["unexpected_dangerous_pattern_without_guard"]
    });
  }
  return out;
}

export function runDestructiveFirestoreScan(): {
  catalogResults: AuditResult[];
  packageFindings: PackageScriptFinding[];
  unexpectedResults: AuditResult[];
} {
  const createAppText = readRelative(createAppPath);
  const catalogResults = dangerousCatalog.map((entry) =>
    detectActualAction(entry, readRelative(entry.filePath), createAppText)
  );
  const catalogPaths = new Set(dangerousCatalog.map((entry) => entry.filePath));
  const unexpectedResults = findUnexpectedDangerousFiles(catalogPaths);
  const packageFindings = evaluatePackageScripts(catalogResults);
  return { catalogResults, packageFindings, unexpectedResults };
}

export function collectViolations(scan: ReturnType<typeof runDestructiveFirestoreScan>): Array<string> {
  const violations: string[] = [];
  for (const entry of [...scan.catalogResults, ...scan.unexpectedResults]) {
    if (entry.actualAction === "violation") {
      violations.push(`${entry.filePath}: ${entry.reasons.join(",")}`);
    }
  }
  for (const finding of scan.packageFindings) {
    if (finding.status === "violation") {
      violations.push(`package.json#scripts.${finding.scriptName}: ${finding.reasons.join(",")}`);
    }
  }
  return violations;
}
