import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRoutePolicy, listRoutePolicies } from "../src/observability/route-policies.js";

type NativeCallSite = {
  file: string;
  line: number;
  functionName: string | null;
  path: string;
  normalizedPath: string;
};

type ContractInfo = {
  file: string;
  routeName: string;
  path: string;
  normalizedPath: string;
  method: string | null;
  source: string;
};

type BackendRouteInfo = {
  file: string;
  method: string;
  path: string;
  normalizedPath: string;
  routeName: string | null;
  source: string;
  contract: ContractInfo | null;
};

type CacheDoc = {
  key: string;
  ttl: string;
  scope: "viewer" | "global" | "entity";
  invalidationPath: string;
  sourceFiles: string[];
};

type RouteCheck = {
  routeName: string | null;
  method: string;
  backendPath: string | null;
  nativePaths: string[];
  nativeFiles: string[];
  contractFile: string | null;
  routeFile: string | null;
  policyPresent: boolean;
  requestResponseContractPresent: boolean;
  directFirestoreViolation: boolean;
  unboundedListViolation: boolean;
  mutationInvalidationPresent: boolean;
  cacheDocumentation: CacheDoc | null;
  fakeFallbackDetected: boolean;
  fullAuditClassification: string | null;
  budgetExceptionDocumented: boolean;
  violations: string[];
};

type MigratedSurfaceFinding = {
  check: "silent_v1" | "double_fetch";
  file: string;
  details: string;
};

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "..");
const workspaceRoot = path.resolve(backendRoot, "..");
const nativeRoot = path.join(workspaceRoot, "Locava-Native");
const nativeSrcRoot = path.join(nativeRoot, "src");
const routesRoot = path.join(backendRoot, "src", "routes", "v2");
const contractsRoot = path.join(backendRoot, "src", "contracts", "surfaces");
const reportPath = path.join(backendRoot, "tmp", "v2-architecture-governance-report.json");
const markdownPath = path.join(workspaceRoot, "docs", "backendv2-architecture-governance-report-2026-04-25.md");
const fullAuditPath = path.join(backendRoot, "tmp", "full-app-v2-audit-report.json");
const nativeActionCoveragePath = path.join(backendRoot, "tmp", "native-action-coverage-report.json");

const PATH_PATTERN = /["'`]((?:\/v2)\/[^"'`\s)]+)["'`]/g;
const FUNCTION_PATTERNS = [
  /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/,
  /const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(/,
  /([A-Za-z0-9_]+)\s*:\s*(?:async\s*)?\(/,
  /async\s+([A-Za-z0-9_]+)\s*\(/,
];
const ROUTE_DECL_RE = /app\.(get|post|put|patch|delete)(?:<[\s\S]*?>)?\(\s*["'`]([^"'`]+)["'`]/;
const SET_ROUTE_NAME_RE = /setRouteName\(\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([A-Za-z0-9_]+Contract)\.routeName)\s*\)/;
const SET_ROUTE_NAME_RE_GLOBAL = /setRouteName\(\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([A-Za-z0-9_]+Contract)\.routeName)\s*\)/g;

const SEARCH_AND_PROFILE_ALLOWED_EXCEPTIONS = new Map<string, string>([
  [
    path.join(nativeSrcRoot, "data", "repos", "profileRepo.ts"),
    "Profile self bootstrap keeps an explicit compat fallback documented in the file header."
  ],
  [
    path.join(nativeSrcRoot, "features", "search", "useSearchAutofill.ts"),
    "Search autofill conditionally toggles between v1 and v2 by feature flag; not a silent double fetch."
  ],
  [
    path.join(nativeSrcRoot, "features", "search", "useSearchBootstrapPosts.ts"),
    "Search bootstrap hook is the dedicated v2 bootstrap reader; timing constants still reference legacy path labels."
  ],
]);

const MIGRATED_SURFACE_DIRS = [
  path.join(nativeSrcRoot, "features", "home", "backendv2"),
  path.join(nativeSrcRoot, "features", "search", "backendv2"),
  path.join(nativeSrcRoot, "features", "map", "backendv2"),
  path.join(nativeSrcRoot, "features", "profile", "backendv2"),
  path.join(nativeSrcRoot, "features", "comments", "backendv2"),
  path.join(nativeSrcRoot, "features", "notifications", "backendv2"),
  path.join(nativeSrcRoot, "features", "findFriends", "backendv2"),
  path.join(nativeSrcRoot, "features", "togo", "backendv2"),
  path.join(nativeSrcRoot, "features", "userDisplay", "backendv2"),
  path.join(nativeSrcRoot, "features", "achievements", "backendv2"),
];

const SINGLE_PAGE_LIST_ROUTE_NAMES = new Set([
  "search.suggest.get",
  "search.bootstrap.get",
  "map.markers.get",
  "achievements.snapshot.get",
  "achievements.hero.get",
  "achievements.pendingdelta.get",
  "achievements.status.get",
  "achievements.badges.get",
  "achievements.leagues.get",
  "achievements.leaderboard.get",
  "collections.save-sheet.get",
  "posts.detail.batch",
]);

function normalizeRoutePath(input: string): string {
  return input
    .replace(/\$\{[^}]+\}/g, ":param")
    .replace(/:param:param/g, ":param")
    .replace(/\?.*$/, "")
    .replace(/[;,]+$/, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function routeToRegex(route: string): RegExp {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wildcarded = escaped
    .replace(/:([A-Za-z0-9_]+)/g, "[^/]+")
    .replace(/\\\*/g, ".*");
  return new RegExp(`^${wildcarded}$`);
}

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "__tests__") continue;
      files.push(...(await walk(absolute)));
      continue;
    }
    if (entry.isFile() && (absolute.endsWith(".ts") || absolute.endsWith(".tsx") || absolute.endsWith(".js"))) {
      files.push(absolute);
    }
  }
  return files;
}

function findNearestFunction(lines: string[], index: number): string | null {
  for (let cursor = index; cursor >= Math.max(0, index - 25); cursor -= 1) {
    for (const pattern of FUNCTION_PATTERNS) {
      const match = lines[cursor]?.match(pattern);
      if (match?.[1]) return match[1];
    }
  }
  return null;
}

async function extractNativeCallSites(): Promise<NativeCallSite[]> {
  const files = await walk(nativeSrcRoot);
  const callSites: NativeCallSite[] = [];
  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const matches = line.matchAll(PATH_PATTERN);
      for (const match of matches) {
        const rawPath = match[1] ?? "";
        if (!rawPath.startsWith("/v2/")) continue;
        const normalizedPath = normalizeRoutePath(rawPath);
        callSites.push({
          file: path.relative(workspaceRoot, file),
          line: index + 1,
          functionName: findNearestFunction(lines, index),
          path: rawPath,
          normalizedPath,
        });
      }
    }
  }
  return callSites;
}

async function readNativeActionCoverageCallSites(): Promise<NativeCallSite[]> {
  try {
    const raw = JSON.parse(await fs.readFile(nativeActionCoveragePath, "utf8")) as {
      actions?: Array<{
        file?: string;
        line?: number;
        functionName?: string | null;
        rawPath?: string | null;
        normalizedPath?: string | null;
      }>;
    };
    return (raw.actions ?? [])
      .filter(
        (row): row is { file: string; line: number; functionName?: string | null; rawPath: string; normalizedPath: string } =>
          typeof row.file === "string" &&
          typeof row.line === "number" &&
          typeof row.rawPath === "string" &&
          typeof row.normalizedPath === "string" &&
          row.normalizedPath.startsWith("/v2/"),
      )
      .map((row) => ({
        file: row.file,
        line: row.line,
        functionName: row.functionName ?? null,
        path: row.rawPath,
        normalizedPath: row.normalizedPath,
      }));
  } catch {
    return [];
  }
}

async function extractContracts(): Promise<{ byRouteName: Map<string, ContractInfo>; byPath: Map<string, ContractInfo> }> {
  const files = await walk(contractsRoot);
  const byRouteName = new Map<string, ContractInfo>();
  const byPath = new Map<string, ContractInfo>();
  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    const routeName = source.match(/routeName:\s*"([^"]+)"/)?.[1] ?? null;
    const contractPath = source.match(/path:\s*"([^"]+)"/)?.[1] ?? null;
    const method = source.match(/method:\s*"([^"]+)"/)?.[1] ?? null;
    if (!routeName || !contractPath) continue;
    const contract: ContractInfo = {
      file: path.relative(workspaceRoot, file),
      routeName,
      path: contractPath,
      normalizedPath: normalizeRoutePath(contractPath),
      method,
      source,
    };
    byRouteName.set(routeName, contract);
    byPath.set(contract.normalizedPath, contract);
  }
  return { byRouteName, byPath };
}

async function extractBackendRoutes(contractsByPath: Map<string, ContractInfo>): Promise<BackendRouteInfo[]> {
  const files = await walk(routesRoot);
  const routes: BackendRouteInfo[] = [];
  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    const lines = source.split(/\r?\n/);
    const uniqueRouteNames = [
      ...new Set(
        [...source.matchAll(SET_ROUTE_NAME_RE_GLOBAL)]
          .map((match) => match[1] ?? match[2] ?? match[3] ?? null)
          .filter(Boolean)
      )
    ];
    const routesBeforeFile = routes.length;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const decl = line.match(ROUTE_DECL_RE);
      if (!decl) continue;
      const method = decl[1]?.toUpperCase() ?? "GET";
      const routePath = decl[2] ?? "";
      const normalizedPath = normalizeRoutePath(routePath);
      let routeName: string | null = contractsByPath.get(normalizedPath)?.routeName ?? null;
      if (!routeName) {
        for (let cursor = index; cursor < Math.min(lines.length, index + 90); cursor += 1) {
          if (cursor > index && ROUTE_DECL_RE.test(lines[cursor] ?? "")) break;
          const match = (lines[cursor] ?? "").match(SET_ROUTE_NAME_RE);
          if (match) {
            routeName = match[1] ?? match[2] ?? match[3] ?? null;
            if (!routeName && match[4]) {
              const contractByVar = [...contractsByPath.values()].find((candidate) => source.includes(`import { ${match[4].replace(/Contract$/, "Contract")} `));
              routeName = contractByVar?.routeName ?? null;
            }
            if (routeName) break;
          }
        }
      }
      if (!routeName && uniqueRouteNames.length === 1) {
        routeName = uniqueRouteNames[0] ?? null;
      }
      routes.push({
        file: path.relative(workspaceRoot, file),
        method,
        path: routePath,
        normalizedPath,
        routeName,
        source,
        contract: contractsByPath.get(normalizedPath) ?? (routeName ? null : null),
      });
    }

    const routeFileStem = path.basename(file).replace(/\.routes\.[^.]+$/, "");
    const conventionalContract = [...contractsByPath.values()].find((contract) =>
      path.basename(contract.file).startsWith(`${routeFileStem}.contract`)
    );
    if (conventionalContract) {
      const alreadyTracked = routes
        .slice(routesBeforeFile)
        .some((route) => route.normalizedPath === conventionalContract.normalizedPath);
      if (!alreadyTracked) {
        routes.push({
          file: path.relative(workspaceRoot, file),
          method: conventionalContract.method ?? "GET",
          path: conventionalContract.path,
          normalizedPath: conventionalContract.normalizedPath,
          routeName: conventionalContract.routeName,
          source,
          contract: conventionalContract,
        });
      }
    }
  }
  return routes;
}

function routeUsesDirectFirestore(source: string): boolean {
  return (
    /getFirestoreSourceClient\s*\(/.test(source) ||
    /from\s+"firebase-admin\/firestore"/.test(source) ||
    /from\s+'firebase-admin\/firestore'/.test(source)
  );
}

function isListLike(route: BackendRouteInfo, contract: ContractInfo | null): boolean {
  if (route.method !== "GET") return false;
  const haystack = `${route.path}\n${contract?.source ?? route.source}`;
  if (
    /\/detail\b/.test(route.path) ||
    /\/session\b/.test(route.path) ||
    /check-user-exists|check-handle/.test(route.path) ||
    /collections\.detail\.get|posts\.detail\.get|profile\.postdetail\.get/.test(contract?.source ?? "")
  ) {
    return false;
  }
  return /\blimit\b/.test(haystack) || /\bitems:\s*z\.array/.test(contract?.source ?? "");
}

function hasBoundedLimit(contract: ContractInfo | null, route: BackendRouteInfo): boolean {
  const haystack = `${contract?.source ?? ""}\n${route.source}`;
  return /\blimit\b[\s\S]{0,160}\.max\(/.test(haystack) || /Math\.min\(/.test(haystack);
}

function hasPaginationStrategy(routeName: string | null, contract: ContractInfo | null, route: BackendRouteInfo): boolean {
  const haystack = `${contract?.source ?? ""}\n${route.source}`;
  if (routeName && SINGLE_PAGE_LIST_ROUTE_NAMES.has(routeName)) return true;
  if (/nextCursor/.test(haystack)) {
    const explicitlyBroken = /nextCursor:\s*null/.test(haystack) && /hasMore:\s*(?:items\.length|page\.hasMore|res\.data\.page\.hasMore)/.test(haystack);
    return !explicitlyBroken;
  }
  return false;
}

function mutationHasInvalidation(contract: ContractInfo | null, route: BackendRouteInfo): boolean {
  if (contract?.routeName?.endsWith(".get")) return true;
  if ((contract?.method ?? "").toUpperCase() === "GET") return true;
  if (route.method === "GET") return true;
  const haystack = `${contract?.source ?? ""}\n${route.source}`;
  return /invalidation/.test(haystack) || /invalidate[A-Za-z]+/.test(haystack) || /deleteEntityCacheKeys/.test(haystack);
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function inferCacheDocumentation(route: BackendRouteInfo): Promise<CacheDoc | null> {
  const routeAbsolute = path.join(workspaceRoot, route.file);
  const routeBase = path.basename(route.file).replace(/\.routes\.[^.]+$/, "");
  const candidateFiles = [
    routeAbsolute,
    path.join(backendRoot, "src", "orchestration", "surfaces", `${routeBase}.orchestrator.ts`),
    path.join(backendRoot, "src", "orchestration", "mutations", `${routeBase}.orchestrator.ts`),
    path.join(backendRoot, "src", "services", "surfaces", `${routeBase}.service.ts`),
    path.join(backendRoot, "src", "services", "mutations", `${routeBase}.service.ts`),
  ];
  const contents = (await Promise.all(candidateFiles.map(readIfExists)))
    .map((source, index) => ({ source, file: path.relative(workspaceRoot, candidateFiles[index]!) }))
    .filter((entry): entry is { source: string; file: string } => typeof entry.source === "string");

  const joined = contents.map((entry) => entry.source).join("\n\n");
  const cacheKeyMatch =
    joined.match(/const\s+cacheKey\s*=\s*([^\n;]+);/) ??
    joined.match(/buildCacheKey\(([\s\S]{0,160}?)\)/);
  const ttlMatch =
    joined.match(/setRouteCacheEntry\(\s*cacheKey\s*,\s*response\s*,\s*([^,\n)]+)/) ??
    joined.match(/globalCache\.set\(\s*cacheKey\s*,\s*response\s*,\s*([^,\n)]+)/) ??
    joined.match(/globalCache\.set\(\s*cacheKey\s*,\s*payload\s*,\s*([^,\n)]+)/);
  const hasCache = Boolean(cacheKeyMatch && ttlMatch);
  if (!hasCache) return null;

  const key = String(cacheKeyMatch?.[1] ?? "cacheKey").trim();
  const ttl = String(ttlMatch?.[1] ?? "unknown").trim();
  const tagsMatch = joined.match(/setRouteCacheEntry\([\s\S]*?\[\s*([^\]]+)\]/);
  const scope: CacheDoc["scope"] = /viewerId/.test(key) ? "viewer" : /postId|collectionId|userId|conversationId/.test(key) ? "entity" : "global";
  return {
    key,
    ttl,
    scope,
    invalidationPath: tagsMatch ? `route-cache tags: [${tagsMatch[1].replace(/\s+/g, " ").trim()}]` : "ttl_only",
    sourceFiles: contents.map((entry) => entry.file),
  };
}

async function readFullAuditRows(): Promise<Map<string, { classification: string; budgetViolations: string[] }>> {
  try {
    const raw = JSON.parse(await fs.readFile(fullAuditPath, "utf8")) as {
      rows?: Array<{ routeName?: string; classification?: string; budgetViolations?: string[] }>;
    };
    return new Map(
      (raw.rows ?? [])
        .filter((row): row is { routeName: string; classification: string; budgetViolations: string[] } => typeof row.routeName === "string" && typeof row.classification === "string")
        .map((row) => [row.routeName, { classification: row.classification, budgetViolations: row.budgetViolations ?? [] }]),
    );
  } catch {
    return new Map();
  }
}

async function scanMigratedSurfaceViolations(): Promise<MigratedSurfaceFinding[]> {
  const findings: MigratedSurfaceFinding[] = [];
  const files = await walk(nativeSrcRoot);
  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    const hasV2 = /\/v2\//.test(source);
    const hasV1 = /\/api\/v1\/product\//.test(source) || /API_V1_PRODUCT_PATHS/.test(source);
    if (!hasV1) continue;

    const migrated = MIGRATED_SURFACE_DIRS.some((dir) => file.startsWith(dir));
    const allowed = SEARCH_AND_PROFILE_ALLOWED_EXCEPTIONS.get(file);
    if (migrated && !allowed) {
      findings.push({
        check: "silent_v1",
        file: path.relative(workspaceRoot, file),
        details: "Migrated Backendv2 surface still references legacy product routes."
      });
    }
    if (hasV1 && hasV2 && !allowed && (migrated || /search|profile/i.test(file))) {
      findings.push({
        check: "double_fetch",
        file: path.relative(workspaceRoot, file),
        details: "File references both v1 and v2 routes without a documented exception."
      });
    }
  }
  return findings;
}

async function buildRouteChecks(): Promise<{
  routeChecks: RouteCheck[];
  nativeCallSites: NativeCallSite[];
  migratedSurfaceFindings: MigratedSurfaceFinding[];
}> {
  const [scannedCallSites, coverageCallSites] = await Promise.all([extractNativeCallSites(), readNativeActionCoverageCallSites()]);
  const nativeCallSites = [
    ...scannedCallSites,
    ...coverageCallSites.filter(
      (candidate) =>
        !scannedCallSites.some(
          (existing) =>
            existing.file === candidate.file &&
            existing.line === candidate.line &&
            existing.normalizedPath === candidate.normalizedPath,
        ),
    ),
  ];
  const contracts = await extractContracts();
  const backendRoutes = await extractBackendRoutes(contracts.byPath);
  const fullAuditRows = await readFullAuditRows();
  const migratedSurfaceFindings = await scanMigratedSurfaceViolations();
  const nativePathToRoutes = new Map<string, BackendRouteInfo[]>();

  for (const site of nativeCallSites) {
    const matches = backendRoutes.filter((route) => routeToRegex(route.normalizedPath).test(site.normalizedPath));
    nativePathToRoutes.set(site.normalizedPath, matches);
  }

  const nativeFacingRoutes = new Map<string, { route: BackendRouteInfo; nativeSites: NativeCallSite[] }>();
  for (const site of nativeCallSites) {
    const matches = nativePathToRoutes.get(site.normalizedPath) ?? [];
    for (const route of matches) {
      const key = `${route.method}:${route.path}:${route.routeName ?? "unknown"}`;
      const existing = nativeFacingRoutes.get(key);
      if (existing) {
        existing.nativeSites.push(site);
      } else {
        nativeFacingRoutes.set(key, { route, nativeSites: [site] });
      }
    }
  }

  const routeChecks: RouteCheck[] = [];
  for (const { route, nativeSites } of nativeFacingRoutes.values()) {
    const contract =
      (route.routeName ? contracts.byRouteName.get(route.routeName) : null) ??
      contracts.byPath.get(route.normalizedPath) ??
      null;
    const routeName = route.routeName ?? contract?.routeName ?? null;
    const policyPresent = Boolean(routeName && getRoutePolicy(routeName));
    const requestResponseContractPresent = Boolean(contract?.source && /response:\s*[A-Za-z0-9_]+/.test(contract.source));
    const directFirestoreViolation = routeUsesDirectFirestore(route.source);
    const listLike = isListLike(route, contract);
    const boundedLimit = !listLike || hasBoundedLimit(contract, route);
    const paginationStrategy = !listLike || hasPaginationStrategy(routeName, contract, route);
    const mutationInvalidationPresent = mutationHasInvalidation(contract, route);
    const cacheDocumentation = await inferCacheDocumentation(route);
    const fullAudit = routeName ? fullAuditRows.get(routeName) ?? null : null;
    const fakeFallbackDetected = fullAudit?.classification === "BROKEN_FAKE_FALLBACK";
    const budgetExceptionDocumented = fullAudit?.classification === "PASS_WITH_STAGED_HYDRATION";
    const readOrPayloadViolation =
      Boolean(fullAudit?.budgetViolations?.includes("db_reads_exceeded")) ||
      Boolean(fullAudit?.budgetViolations?.includes("db_queries_exceeded")) ||
      Boolean(fullAudit?.budgetViolations?.includes("payload_bytes_exceeded"));

    const violations: string[] = [];
    if (!policyPresent) violations.push("missing_route_policy");
    if (!requestResponseContractPresent) violations.push("missing_request_response_contract");
    if (directFirestoreViolation) violations.push("route_layer_firestore_access");
    if (!boundedLimit || !paginationStrategy) violations.push("list_pagination_or_limit_gap");
    if (!mutationInvalidationPresent) violations.push("mutation_invalidation_gap");
    if (!cacheDocumentation && (route.source.includes("globalCache") || route.source.includes("setRouteCacheEntry"))) {
      violations.push("cache_documentation_gap");
    }
    if (fakeFallbackDetected) violations.push("fake_or_stub_runtime_fallback");
    if (readOrPayloadViolation && !budgetExceptionDocumented) violations.push("budget_violation_without_staged_hydration");

    routeChecks.push({
      routeName,
      method: route.method,
      backendPath: route.path,
      nativePaths: [...new Set(nativeSites.map((site) => site.path))].sort(),
      nativeFiles: [...new Set(nativeSites.map((site) => `${site.file}:${site.line}`))].sort(),
      contractFile: contract?.file ?? null,
      routeFile: route.file,
      policyPresent,
      requestResponseContractPresent,
      directFirestoreViolation,
      unboundedListViolation: !boundedLimit || !paginationStrategy,
      mutationInvalidationPresent,
      cacheDocumentation,
      fakeFallbackDetected,
      fullAuditClassification: fullAudit?.classification ?? null,
      budgetExceptionDocumented,
      violations,
    });
  }

  routeChecks.sort((a, b) => (a.routeName ?? a.backendPath ?? "").localeCompare(b.routeName ?? b.backendPath ?? ""));
  return { routeChecks, nativeCallSites, migratedSurfaceFindings };
}

function summarize(routeChecks: RouteCheck[], migratedSurfaceFindings: MigratedSurfaceFinding[]) {
  const routesChecked = routeChecks.length;
  const routesMissingContracts = routeChecks.filter((row) => row.violations.includes("missing_request_response_contract")).length;
  const routesMissingPolicy = routeChecks.filter((row) => row.violations.includes("missing_route_policy")).length;
  const firestoreViolations = routeChecks.filter((row) => row.violations.includes("route_layer_firestore_access")).length;
  const unboundedQueriesFound = routeChecks.filter((row) => row.violations.includes("list_pagination_or_limit_gap")).length;
  const fakeDataFound = routeChecks.filter((row) => row.violations.includes("fake_or_stub_runtime_fallback")).length;
  const cacheGaps = routeChecks.filter((row) => row.violations.includes("cache_documentation_gap") || row.violations.includes("mutation_invalidation_gap")).length;
  return {
    routesChecked,
    routesMissingContracts,
    routesMissingPolicy,
    firestoreViolations,
    unboundedQueriesFound,
    fakeDataFound,
    cacheGaps,
    migratedSurfaceV1Violations: migratedSurfaceFindings.filter((row) => row.check === "silent_v1").length,
    migratedSurfaceDoubleFetchViolations: migratedSurfaceFindings.filter((row) => row.check === "double_fetch").length,
  };
}

async function writeMarkdown(routeChecks: RouteCheck[], migratedSurfaceFindings: MigratedSurfaceFinding[]) {
  const summary = summarize(routeChecks, migratedSurfaceFindings);
  const lines: string[] = [];
  lines.push("# Backendv2 Architecture Governance Report - 2026-04-25");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Routes checked: ${summary.routesChecked}`);
  lines.push(`- Routes missing request/response contracts: ${summary.routesMissingContracts}`);
  lines.push(`- Routes missing route policy metadata: ${summary.routesMissingPolicy}`);
  lines.push(`- Route-layer Firestore violations: ${summary.firestoreViolations}`);
  lines.push(`- Unbounded list/pagination gaps: ${summary.unboundedQueriesFound}`);
  lines.push(`- Fake/stub runtime fallbacks found: ${summary.fakeDataFound}`);
  lines.push(`- Cache or invalidation gaps: ${summary.cacheGaps}`);
  lines.push(`- Migrated Native silent v1 references: ${summary.migratedSurfaceV1Violations}`);
  lines.push(`- Migrated Native undocumented v1+v2 double fetches: ${summary.migratedSurfaceDoubleFetchViolations}`);
  lines.push("");
  lines.push("## Route Matrix");
  lines.push("");
  lines.push("| Route | Method | Policy | Contract | Firestore | List Bounds | Mutation Invalidation | Cache Docs | Full Audit | Violations |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of routeChecks) {
    lines.push(
      `| \`${row.routeName ?? row.backendPath ?? "unknown"}\` | \`${row.method}\` | ${row.policyPresent ? "yes" : "no"} | ${row.requestResponseContractPresent ? "yes" : "no"} | ${row.directFirestoreViolation ? "violation" : "clean"} | ${row.unboundedListViolation ? "gap" : "ok"} | ${row.mutationInvalidationPresent ? "yes" : "no"} | ${row.cacheDocumentation ? "yes" : "n/a"} | ${row.fullAuditClassification ?? "unverified"} | ${row.violations.length ? row.violations.join(", ") : "none"} |`
    );
  }
  lines.push("");
  lines.push("## Migrated Native Findings");
  lines.push("");
  if (migratedSurfaceFindings.length === 0) {
    lines.push("- None");
  } else {
    for (const finding of migratedSurfaceFindings) {
      lines.push(`- \`${finding.check}\` ${finding.file}: ${finding.details}`);
    }
  }
  await fs.mkdir(path.dirname(markdownPath), { recursive: true });
  await fs.writeFile(markdownPath, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  const { routeChecks, nativeCallSites, migratedSurfaceFindings } = await buildRouteChecks();
  const summary = summarize(routeChecks, migratedSurfaceFindings);
  const report = {
    generatedAt: new Date().toISOString(),
    summary,
    nativeCallSiteCount: nativeCallSites.length,
    routeChecks,
    migratedSurfaceFindings,
    availablePolicies: listRoutePolicies().map((policy) => policy.routeName),
  };
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeMarkdown(routeChecks, migratedSurfaceFindings);
  console.log(`Wrote ${reportPath}`);
  console.log(`Wrote ${markdownPath}`);
  console.log(JSON.stringify(summary, null, 2));
}

await main();
