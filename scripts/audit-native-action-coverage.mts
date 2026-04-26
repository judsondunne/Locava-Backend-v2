import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { listRoutePolicies } from "../src/observability/route-policies.js";

type TriggerKind =
  | "press"
  | "long_press"
  | "refresh"
  | "pagination"
  | "submit"
  | "change"
  | "effect"
  | "focus_effect"
  | "deep_link"
  | "notification"
  | "startup"
  | "unknown";

type CoverageClassification =
  | "COVERED_FULL_AUDIT"
  | "COVERED_SEMANTIC"
  | "COVERED_ROUTE_TEST"
  | "COVERED_MANUAL_ONLY"
  | "UNCOVERED_BACKEND_ACTION"
  | "UNCOVERED_NATIVE_ACTION"
  | "INTENTIONAL_DISABLED"
  | "INTENTIONAL_LEGACY"
  | "STALE_V1_CALL"
  | "DOUBLE_FETCH_RISK"
  | "UNKNOWN";

type FunctionRecord = {
  name: string;
  start: number;
  end: number;
  node: ts.Node;
};

type RouteContract = {
  routeName: string;
  method: string | null;
  path: string;
  normalizedPath: string;
  contractFile: string;
};

type RouteBinding = {
  routeName: string | null;
  method: string;
  path: string;
  normalizedPath: string;
  routeFile: string;
  hasRouteTest: boolean;
};

type NativeActionRecord = {
  id: string;
  surface: string;
  file: string;
  line: number;
  functionName: string | null;
  rawPath: string | null;
  normalizedPath: string | null;
  method: string | null;
  callKind: string;
  triggerKinds: TriggerKind[];
  requestShape: string[];
  responseFields: string[];
  sourceFirestoreDocsExpected: string[];
  cacheKeysTouched: string[];
  invalidationExpected: string[];
  priority: "P0" | "P1" | "P2" | "P3" | "UNKNOWN";
  routeName: string | null;
  routeFile: string | null;
  contractFile: string | null;
  hasRouteTest: boolean;
  currentSemanticCoverage: string | null;
  currentArchitectureCoverage: string | null;
  currentFullAuditCoverage: string | null;
  coverageScopeKey: string;
  notes: string[];
  classification: CoverageClassification;
};

type MarkdownSummary = {
  inventoryLines: string[];
  coverageLines: string[];
};

type JsonReport = {
  generatedAt: string;
  summary: Record<string, number>;
  triggerSummary: Record<string, number>;
  routeSummary: {
    nativeActions: number;
    nativeActionsWithBackendRoute: number;
    staleV1Calls: number;
    doubleFetchRisks: number;
    uncoveredBackendActions: number;
    uncoveredNativeActions: number;
  };
  actions: NativeActionRecord[];
};

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "..");
const workspaceRoot = path.resolve(backendRoot, "..");
const nativeRoot = path.join(workspaceRoot, "Locava-Native");
const nativeSrcRoot = path.join(nativeRoot, "src");
const contractsRoot = path.join(backendRoot, "src", "contracts", "surfaces");
const routesRoot = path.join(backendRoot, "src", "routes", "v2");
const reportPath = path.join(backendRoot, "tmp", "native-action-coverage-report.json");
const coverageDocPath = path.join(workspaceRoot, "docs", "native-action-coverage-report-2026-04-25.md");
const inventoryDocPath = path.join(workspaceRoot, "docs", "native-action-surface-inventory-2026-04-25.md");
const fullAuditPath = path.join(backendRoot, "tmp", "full-app-v2-audit-report.json");
const semanticsPath = path.join(backendRoot, "tmp", "real-user-v2-semantics-report.json");
const architecturePath = path.join(backendRoot, "tmp", "v2-architecture-governance-report.json");

const ROUTE_LITERAL_RE = /(?:\/v2\/[^"'`\s)]+|\/api\/v1\/[^"'`\s)]+)/;
const ROUTE_DECL_RE = /app\.(get|post|put|patch|delete)(?:<[\s\S]*?>)?\(\s*["'`]([^"'`]+)["'`]/;
const ROUTE_NAME_RE = /routeName:\s*"([^"]+)"/;
const METHOD_RE = /method:\s*"([^"]+)"/;
const PATH_RE = /path:\s*"([^"]+)"/;
const SET_ROUTE_NAME_RE_GLOBAL = /setRouteName\(\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([A-Za-z0-9_]+Contract)\.routeName)\s*\)/g;

const DISABLED_PATTERNS = [/unsupported/i, /not_supported/i, /disabled/i, /boundedV2ReadMode\s*\?\s*undefined/i];
const LEGACY_OK_PATTERNS = [/legacy/i, /compat/i, /fallback/i];
const EFFECT_NAMES = new Set(["useEffect", "useLayoutEffect", "useMemoEffect"]);

function normalizeRoutePath(input: string): string {
  return input
    .replace(/\$\{[^}]+\}/g, (_match, offset, source) => {
      const prev = source[offset - 1] ?? "";
      return prev === "/" ? ":param" : "";
    })
    .replace(/:param:param/g, ":param")
    .replace(/\?.*$/, "")
    .replace(/[;,]+$/, "")
    .replace(/:param(?=[A-Za-z0-9_-])/g, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function routeToRegex(route: string): RegExp {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wildcarded = escaped.replace(/:([A-Za-z0-9_]+)/g, "[^/]+");
  return new RegExp(`^${wildcarded}$`);
}

function rel(file: string): string {
  return path.relative(workspaceRoot, file);
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
    if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      files.push(absolute);
    }
  }
  return files;
}

function getLine(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function getText(node: ts.Node, sourceFile: ts.SourceFile): string {
  return node.getText(sourceFile);
}

function flattenPropertyAccess(node: ts.Expression, sourceFile: ts.SourceFile): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) {
    const left = flattenPropertyAccess(node.expression, sourceFile);
    return left ? `${left}.${node.name.text}` : node.name.text;
  }
  if (ts.isElementAccessExpression(node)) {
    const left = flattenPropertyAccess(node.expression, sourceFile);
    const right = node.argumentExpression ? getText(node.argumentExpression, sourceFile) : "[]";
    return left ? `${left}[${right}]` : right;
  }
  return null;
}

function literalToPath(expression: ts.Expression, sourceFile: ts.SourceFile): string | null {
  if (ts.isStringLiteralLike(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  if (ts.isTemplateExpression(expression)) {
    const rendered = expression.head.text + expression.templateSpans.map((span) => `\${${span.expression.getText(sourceFile)}}${span.literal.text}`).join("");
    return rendered;
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = literalToPath(expression.left, sourceFile);
    const right = literalToPath(expression.right, sourceFile);
    return left && right ? `${left}${right}` : getText(expression, sourceFile);
  }
  return ROUTE_LITERAL_RE.test(getText(expression, sourceFile)) ? getText(expression, sourceFile) : null;
}

function detectSurface(file: string): string {
  const normalized = rel(file).replace(/\\/g, "/");
  if (normalized.includes("/features/home/")) return "feed";
  if (normalized.includes("/features/liftable/")) return "post_viewer";
  if (normalized.includes("/features/post/")) return "posting";
  if (normalized.includes("/features/search/")) return "search";
  if (normalized.includes("/features/map/")) return "map";
  if (normalized.includes("/features/profile/") || normalized.includes("/features/userDisplay/")) return "profile";
  if (normalized.includes("/features/togo/") || normalized.includes("/features/collections/") || normalized.includes("/sheets/data/viewerCollections")) {
    return "collections";
  }
  if (normalized.includes("/features/comments/")) return "comments";
  if (normalized.includes("/features/notifications/")) return "notifications";
  if (normalized.includes("/features/chats/") || normalized.includes("/features/chatThread/")) return "chats";
  if (normalized.includes("/features/findFriends/") || normalized.includes("/data/users/")) return "social";
  if (normalized.includes("/features/achievements/")) return "achievements";
  if (normalized.includes("/features/deepLinking/") || normalized.includes("/nav/")) return "navigation";
  if (normalized.includes("/auth/") || normalized.includes("/data/auth/")) return "auth";
  return "other";
}

function inferPriority(routeName: string | null, normalizedPath: string | null, surface: string): NativeActionRecord["priority"] {
  const key = routeName ?? normalizedPath ?? "";
  if (
    /auth\.session|get|feed\.bootstrap|get|posts\..*detail|search\.suggest|get|map\.bootstrap|get|map\.markers|get|profile\.bootstrap|get|chats\.thread|get|notifications/.test(
      key,
    )
  ) {
    return "P0";
  }
  if (
    /(like|save|follow|comment|markread|markunread|create_or_get|create_group|send|typing|collection|search\.results|get|feed\.itemdetail|get|posts\.detail\.batch|posting)/.test(
      key,
    )
  ) {
    return "P1";
  }
  if (/(hero|snapshot|status|leagues|pendingdelta|users|get|directory|detail)/.test(key) || ["profile", "achievements"].includes(surface)) {
    return "P2";
  }
  if (surface === "navigation" || surface === "other") return "P3";
  return "UNKNOWN";
}

function inferSourceFirestoreDocsExpected(normalizedPath: string | null, surface: string): string[] {
  if (!normalizedPath) return surface === "navigation" ? [] : ["n/a"];
  if (/^\/v2\/auth\//.test(normalizedPath)) return ["users/{viewerId}"];
  if (/^\/v2\/feed\//.test(normalizedPath) || /^\/v2\/posts\//.test(normalizedPath)) return ["posts/{postId}", "users/{authorId}"];
  if (/^\/v2\/profiles\//.test(normalizedPath)) return ["users/{userId}", "posts/{postId}"];
  if (/^\/v2\/search\//.test(normalizedPath)) return ["posts/{postId}", "users/{userId}", "collections/{collectionId}", "places_index/*"];
  if (/^\/v2\/map\//.test(normalizedPath)) return ["posts/{postId}"];
  if (/^\/v2\/collections/.test(normalizedPath)) return ["collections/{collectionId}", "posts/{postId}", "users/{viewerId}"];
  if (/^\/v2\/comments\//.test(normalizedPath) || /\/comments\//.test(normalizedPath)) return ["posts/{postId}/comments/{commentId}", "posts/{postId}"];
  if (/^\/v2\/notifications/.test(normalizedPath)) return ["users/{viewerId}/notifications/{notificationId}", "users/{actorId}", "posts/{postId}"];
  if (/^\/v2\/chats/.test(normalizedPath)) return ["chats/{conversationId}", "chats/{conversationId}/messages/{messageId}", "users/{userId}"];
  if (/^\/v2\/social\//.test(normalizedPath) || /^\/v2\/directory\//.test(normalizedPath)) return ["users/{viewerId}", "users/{userId}"];
  if (/^\/v2\/achievements\//.test(normalizedPath)) return ["users/{viewerId}/achievements/state", "users/{viewerId}/badges/*", "leagues/*"];
  if (/^\/v2\/posting\//.test(normalizedPath)) return ["uploadOperations/{operationId}", "posts/{postId}", "storage/media/*"];
  return ["n/a"];
}

function getObjectKeys(expression: ts.Expression | undefined, sourceFile: ts.SourceFile): string[] {
  if (!expression) return [];
  if (!ts.isObjectLiteralExpression(expression)) return [getText(expression, sourceFile).slice(0, 80)];
  const keys: string[] = [];
  for (const property of expression.properties) {
    if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
      const name = property.name?.getText(sourceFile);
      if (name) keys.push(name);
    }
    if (ts.isSpreadAssignment(property)) keys.push(`...${getText(property.expression, sourceFile).slice(0, 32)}`);
  }
  return keys;
}

function collectResponseFields(functionNode: ts.Node, variableName: string, sourceFile: ts.SourceFile): string[] {
  const fields = new Set<string>();
  function visit(node: ts.Node) {
    if (ts.isPropertyAccessExpression(node)) {
      const chain = flattenPropertyAccess(node, sourceFile);
      if (chain && (chain === variableName || chain.startsWith(`${variableName}.`))) {
        fields.add(chain.replace(`${variableName}.`, ""));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(functionNode);
  return [...fields]
    .filter((value) => value.length > 0 && value !== variableName && !value.startsWith("ok") && !value.startsWith("error"))
    .sort()
    .slice(0, 20);
}

async function extractContracts(): Promise<{ byPath: RouteContract[]; byName: Map<string, RouteContract> }> {
  const files = await walk(contractsRoot);
  const byPath: RouteContract[] = [];
  const byName = new Map<string, RouteContract>();
  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    const routeName = source.match(ROUTE_NAME_RE)?.[1];
    const method = source.match(METHOD_RE)?.[1] ?? null;
    const routePath = source.match(PATH_RE)?.[1];
    if (!routeName || !routePath) continue;
    const contract: RouteContract = {
      routeName,
      method,
      path: routePath,
      normalizedPath: normalizeRoutePath(routePath),
      contractFile: rel(file),
    };
    byPath.push(contract);
    byName.set(routeName, contract);
  }
  return { byPath, byName };
}

async function extractRouteBindings(contracts: RouteContract[]): Promise<RouteBinding[]> {
  const files = await walk(routesRoot);
  const bindings: RouteBinding[] = [];
  const contractByPath = new Map(contracts.map((contract) => [contract.normalizedPath, contract] as const));
  const contractByFile = new Map(contracts.map((contract) => [path.basename(contract.contractFile).replace(/\.ts$/, ""), contract] as const));
  const routeTestFiles = (await walk(routesRoot)).filter((file) => file.endsWith(".test.ts"));
  const routeTests = new Set(routeTestFiles.map((file) => path.basename(file)));
  const routeTestSources = await Promise.all(
    routeTestFiles.map(async (file) => ({
      file,
      text: await fs.readFile(file, "utf8"),
    })),
  );
  const hasCoverageTest = (routeName: string | null, routePath: string, normalizedPath: string, routeFile: string): boolean => {
    const siblingTest = routeTests.has(path.basename(routeFile).replace(/\.ts$/, ".test.ts"));
    if (siblingTest) return true;
    return routeTestSources.some(({ text }) => {
      if (routeName && text.includes(routeName)) return true;
      if (text.includes(routePath)) return true;
      return text.includes(normalizedPath);
    });
  };
  for (const file of files.filter((candidate) => candidate.endsWith(".ts") && !candidate.endsWith(".test.ts"))) {
    const source = await fs.readFile(file, "utf8");
    const lines = source.split(/\r?\n/);
    const uniqueRouteNames = [
      ...new Set(
        [...source.matchAll(SET_ROUTE_NAME_RE_GLOBAL)]
          .map((match) => match[1] ?? match[2] ?? match[3] ?? null)
          .filter(Boolean),
      ),
    ];
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index]?.match(ROUTE_DECL_RE);
      if (!match) continue;
      const method = match[1]?.toUpperCase() ?? "GET";
      const routePath = match[2] ?? "";
      const normalizedPath = normalizeRoutePath(routePath);
      const contract = contractByPath.get(normalizedPath) ?? null;
      const routeName = contract?.routeName ?? (uniqueRouteNames.length === 1 ? uniqueRouteNames[0] ?? null : null);
      const routeFile = rel(file);
      bindings.push({
        routeName,
        method,
        path: routePath,
        normalizedPath,
        routeFile,
        hasRouteTest: hasCoverageTest(routeName, routePath, normalizedPath, routeFile),
      });
    }
    const importedContracts = [...source.matchAll(/import\s+\{\s*([^}]+)\s*\}\s+from\s+["'][^"']*\/contracts\/surfaces\/([^/"']+)\.contract\.js["']/g)];
    for (const imported of importedContracts) {
      const importedNames = imported[1]?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
      const contractBase = `${imported[2]}.contract`;
      const contract = contractByFile.get(contractBase);
      if (!contract) continue;
      const used = importedNames.some((name) => source.includes(`${name}.path`));
      if (!used) continue;
      const exists = bindings.some(
        (binding) => binding.routeFile === rel(file) && binding.normalizedPath === contract.normalizedPath && binding.method === (contract.method ?? "GET").toUpperCase(),
      );
      if (exists) continue;
      const routeFile = rel(file);
      bindings.push({
        routeName: contract.routeName,
        method: (contract.method ?? "GET").toUpperCase(),
        path: contract.path,
        normalizedPath: contract.normalizedPath,
        routeFile,
        hasRouteTest: hasCoverageTest(contract.routeName, contract.path, contract.normalizedPath, routeFile),
      });
    }
  }
  return bindings;
}

async function readJsonIfExists<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function buildRouteLookups(bindings: RouteBinding[]) {
  return bindings.map((binding) => ({
    ...binding,
    regex: routeToRegex(binding.normalizedPath),
  }));
}

async function buildExistingCoverageLookups() {
  const [fullAudit, semantics, architecture] = await Promise.all([
    readJsonIfExists<{ rows?: Array<{ routeName?: string; path?: string | null; classification?: string }> }>(fullAuditPath),
    readJsonIfExists<{ results?: Array<{ route?: string; classification?: string }> }>(semanticsPath),
    readJsonIfExists<{ routeChecks?: Array<{ routeName?: string | null; backendPath?: string | null; violations?: string[] }> }>(architecturePath),
  ]);

  const fullAuditByRoute = new Map<string, string>();
  const fullAuditByPath = new Map<string, string>();
  for (const row of fullAudit?.rows ?? []) {
    if (row.routeName) fullAuditByRoute.set(row.routeName, row.classification ?? "unknown");
    if (row.path) fullAuditByPath.set(normalizeRoutePath(row.path), row.classification ?? "unknown");
  }

  const semanticsByPath = new Map<string, string>();
  for (const row of semantics?.results ?? []) {
    if (!row.route) continue;
    semanticsByPath.set(normalizeRoutePath(row.route), row.classification ?? "unknown");
  }

  const architectureByRoute = new Map<string, string>();
  const architectureByPath = new Map<string, string>();
  for (const row of architecture?.routeChecks ?? []) {
    const status = (row.violations ?? []).length === 0 ? "ARCHITECTURE_PASS" : `ARCHITECTURE_FAIL:${(row.violations ?? []).join(",")}`;
    if (row.routeName) architectureByRoute.set(row.routeName, status);
    if (row.backendPath) architectureByPath.set(normalizeRoutePath(row.backendPath), status);
  }

  return { fullAuditByRoute, fullAuditByPath, semanticsByPath, architectureByRoute, architectureByPath };
}

function identifierText(node: ts.Node | undefined, sourceFile: ts.SourceFile): string | null {
  if (!node) return null;
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return flattenPropertyAccess(node, sourceFile);
  return null;
}

function inferTriggerKinds(functionName: string | null, fileText: string, functionText: string): TriggerKind[] {
  const triggers = new Set<TriggerKind>();
  const haystack = `${functionName ?? ""}\n${functionText}`;
  if (/handle.*press|open|close|tap|toggle|select|navigate/i.test(haystack)) triggers.add("press");
  if (/longpress|contextmenu/i.test(haystack)) triggers.add("long_press");
  if (/refresh|pull/i.test(haystack)) triggers.add("refresh");
  if (/loadmore|paginate|pagecursor|nextcursor|endreached/i.test(haystack)) triggers.add("pagination");
  if (/submit|send|finalize|create|claim/i.test(haystack)) triggers.add("submit");
  if (/onchangetext|typing|suggest|search/i.test(haystack)) triggers.add("change");
  if (/useeffect|bootstrap|startup|seedstate|initialize/i.test(haystack) || /signedInV2Bootstrap/.test(fileText)) triggers.add("startup");
  if (/usefocuseffect/i.test(haystack)) triggers.add("focus_effect");
  if (/linking|deeplink|intentrouter/i.test(fileText)) triggers.add("deep_link");
  if (/notification/i.test(fileText)) triggers.add("notification");
  if (triggers.size === 0) triggers.add("unknown");
  return [...triggers];
}

async function extractNativeActions(
  routeLookups: Array<RouteBinding & { regex: RegExp }>,
  contractsByName: Map<string, RouteContract>,
) {
  const files = await walk(nativeSrcRoot);
  const actions: NativeActionRecord[] = [];
  const scopeCoverageModes = new Map<string, Set<string>>();

  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const functions: FunctionRecord[] = [];

    function registerFunction(name: string | null, node: ts.Node) {
      if (!name) return;
      functions.push({ name, start: node.getStart(sourceFile), end: node.getEnd(), node });
    }

    function enclosingFunction(node: ts.Node): FunctionRecord | null {
      const pos = node.getStart(sourceFile);
      const matches = functions
        .filter((candidate) => candidate.start <= pos && candidate.end >= pos)
        .sort((a, b) => a.end - a.start - (b.end - b.start));
      return matches[0] ?? null;
    }

    function coverageScopeKeyFor(node: ts.Node, enclosing: FunctionRecord | null): string {
      return enclosing
        ? `${rel(file)}:${enclosing.start}:${enclosing.end}`
        : `${rel(file)}:global`;
    }

    function visitForFunctions(node: ts.Node) {
      if (ts.isFunctionDeclaration(node)) registerFunction(node.name?.text ?? null, node);
      if (ts.isMethodDeclaration(node)) registerFunction(node.name.getText(sourceFile), node);
      if (ts.isVariableDeclaration(node) && node.initializer) {
        if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
          registerFunction(ts.isIdentifier(node.name) ? node.name.text : node.name.getText(sourceFile), node.initializer);
        }
      }
      ts.forEachChild(node, visitForFunctions);
    }
    visitForFunctions(sourceFile);

    function visit(node: ts.Node) {
      if (!ts.isCallExpression(node)) {
        ts.forEachChild(node, visit);
        return;
      }

      const callee = identifierText(node.expression, sourceFile) ?? getText(node.expression, sourceFile);
      const networkKind =
        callee === "backendV2Get" || callee === "backendV2Post" || callee === "backendV2Patch" || callee === "backendV2Delete"
          ? "backendv2_client"
          : /^api(Get|Post|Patch|Delete|Request|FormDataRequest)/.test(callee)
            ? "api_client"
            : callee === "fetch"
              ? "fetch"
              : null;
      if (!networkKind) {
        ts.forEachChild(node, visit);
        return;
      }

      const routeExpr = node.arguments[0];
      const rawPath = routeExpr ? literalToPath(routeExpr, sourceFile) : null;
      const normalizedPath =
        rawPath && (rawPath.startsWith("/v2/") || rawPath.startsWith("/api/v1/"))
          ? normalizeRoutePath(rawPath)
          : null;
      const enclosing = enclosingFunction(node);
      const functionName = enclosing?.name ?? null;
      const functionText = enclosing ? getText(enclosing.node, sourceFile) : "";
      const coverageScopeKey = coverageScopeKeyFor(node, enclosing);
      const triggerKinds = inferTriggerKinds(functionName, text, functionText);
      const requestShape =
        networkKind === "backendv2_client"
          ? getObjectKeys(
              node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])
                ? node.arguments[1].properties.find(
                    (property): property is ts.PropertyAssignment =>
                      ts.isPropertyAssignment(property) &&
                      property.name.getText(sourceFile) === "body",
                  )?.initializer
                : undefined,
              sourceFile,
            )
          : getObjectKeys(node.arguments[2], sourceFile);
      const variableDecl = ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name) ? node.parent.name.text : null;
      const responseFields = variableDecl && enclosing ? collectResponseFields(enclosing.node, variableDecl, sourceFile) : [];
      const callMethod =
        callee === "backendV2Get" || callee === "apiGetWithAuth"
          ? "GET"
          : callee === "backendV2Delete" || callee === "apiDeleteWithAuth"
            ? "DELETE"
            : callee === "backendV2Patch" || callee === "apiPatchWithAuth"
              ? "PATCH"
              : callee === "fetch"
                ? "FETCH"
                : "POST";
      const matchedRoute = normalizedPath
        ? routeLookups.find((candidate) => {
            if (!candidate.regex.test(normalizedPath)) return false;
            if (callMethod === "FETCH") return true;
            return candidate.method === callMethod;
          }) ??
          routeLookups.find((candidate) => candidate.regex.test(normalizedPath))
        : null;
      const routeName = matchedRoute?.routeName ?? contractsByName.get(matchedRoute?.routeName ?? "")?.routeName ?? null;
      const contract = routeName ? contractsByName.get(routeName) ?? null : null;

      if (normalizedPath?.startsWith("/v2/")) {
        const set = scopeCoverageModes.get(coverageScopeKey) ?? new Set<string>();
        set.add("v2");
        scopeCoverageModes.set(coverageScopeKey, set);
      }
      if (rawPath?.includes("/api/v1/") || /API_V1_PRODUCT_PATHS/.test(getText(routeExpr ?? node, sourceFile))) {
        const set = scopeCoverageModes.get(coverageScopeKey) ?? new Set<string>();
        set.add("v1");
        scopeCoverageModes.set(coverageScopeKey, set);
      }

      actions.push({
        id: `${rel(file)}:${getLine(sourceFile, node)}`,
        surface: detectSurface(file),
        file: rel(file),
        line: getLine(sourceFile, node),
        functionName,
        rawPath,
        normalizedPath,
        method: matchedRoute?.method ?? (callMethod === "FETCH" ? null : callMethod),
        callKind: networkKind,
        triggerKinds,
        requestShape,
        responseFields,
        sourceFirestoreDocsExpected: inferSourceFirestoreDocsExpected(normalizedPath, detectSurface(file)),
        cacheKeysTouched: routeName ? [`policy:${routeName}`] : [],
        invalidationExpected:
          callMethod === "GET" || callMethod === "FETCH"
            ? []
            : [
                routeName ? `route:${routeName}` : "route:unknown",
                detectSurface(file) === "collections" ? "collections/viewer" : `${detectSurface(file)}/viewer`,
              ],
        priority: inferPriority(routeName, normalizedPath, detectSurface(file)),
        routeName,
        routeFile: matchedRoute?.routeFile ?? null,
        contractFile: contract?.contractFile ?? null,
        hasRouteTest: matchedRoute?.hasRouteTest ?? false,
        currentSemanticCoverage: null,
        currentArchitectureCoverage: null,
        currentFullAuditCoverage: null,
        coverageScopeKey,
        notes: [],
        classification: "UNKNOWN",
      });
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  const doubleFetchScopes = new Set(
    [...scopeCoverageModes.entries()].filter(([, modes]) => modes.has("v1") && modes.has("v2")).map(([scopeKey]) => scopeKey),
  );

  return { actions, doubleFetchScopes };
}

function classifyActions(
  actions: NativeActionRecord[],
  doubleFetchScopes: Set<string>,
  coverageLookups: Awaited<ReturnType<typeof buildExistingCoverageLookups>>,
): NativeActionRecord[] {
  const migratedDirs = [
    "Locava-Native/src/features/home/backendv2/",
    "Locava-Native/src/features/search/backendv2/",
    "Locava-Native/src/features/map/backendv2/",
    "Locava-Native/src/features/profile/backendv2/",
    "Locava-Native/src/features/comments/backendv2/",
    "Locava-Native/src/features/notifications/backendv2/",
    "Locava-Native/src/features/findFriends/backendv2/",
    "Locava-Native/src/features/togo/backendv2/",
    "Locava-Native/src/features/liftable/backendv2/",
    "Locava-Native/src/features/achievements/backendv2/",
  ];

  for (const action of actions) {
    const semantic = (action.normalizedPath ? coverageLookups.semanticsByPath.get(action.normalizedPath) : null) ?? null;
    const architecture =
      (action.routeName ? coverageLookups.architectureByRoute.get(action.routeName) : null) ??
      (action.normalizedPath ? coverageLookups.architectureByPath.get(action.normalizedPath) : null) ??
      null;
    const fullAudit =
      (action.routeName ? coverageLookups.fullAuditByRoute.get(action.routeName) : null) ??
      (action.normalizedPath ? coverageLookups.fullAuditByPath.get(action.normalizedPath) : null) ??
      null;

    action.currentSemanticCoverage = semantic;
    action.currentArchitectureCoverage = architecture;
    action.currentFullAuditCoverage = fullAudit;

    const isV1 = Boolean(action.rawPath?.includes("/api/v1/")) || /API_V1_PRODUCT_PATHS/.test(action.rawPath ?? "");
    const isMigrated = migratedDirs.some((dir) => action.file.startsWith(dir));
    const functionTextHint = `${action.functionName ?? ""} ${action.file} ${action.rawPath ?? ""}`;
    const disabled = DISABLED_PATTERNS.some((pattern) => pattern.test(functionTextHint));
    const intentionalLegacy = isV1 && LEGACY_OK_PATTERNS.some((pattern) => pattern.test(functionTextHint)) && !isMigrated;

    if (doubleFetchScopes.has(action.coverageScopeKey)) {
      action.classification = "DOUBLE_FETCH_RISK";
      action.notes.push("Function scope references both v1 and v2 transport paths.");
      continue;
    }
    if (disabled) {
      action.classification = "INTENTIONAL_DISABLED";
      action.notes.push("Code path currently advertises an explicit disabled/unsupported state.");
      continue;
    }
    if (isV1 && isMigrated) {
      action.classification = "STALE_V1_CALL";
      action.notes.push("Migrated Backendv2 surface still calls a legacy v1 route.");
      continue;
    }
    if (intentionalLegacy) {
      action.classification = "INTENTIONAL_LEGACY";
      action.notes.push("Legacy transport remains explicitly documented in the source path/function.");
      continue;
    }
    if (
      fullAudit &&
      (fullAudit === "PASS" || fullAudit === "PASS_WITH_STAGED_HYDRATION" || fullAudit === "PASS_WITH_INTENTIONAL_LEGACY_PROXY")
    ) {
      action.classification = "COVERED_FULL_AUDIT";
      continue;
    }
    if (semantic && semantic.startsWith("SEMANTIC_PASS")) {
      action.classification = "COVERED_SEMANTIC";
      continue;
    }
    if (action.hasRouteTest) {
      action.classification = "COVERED_ROUTE_TEST";
      continue;
    }
    if (architecture === "ARCHITECTURE_PASS") {
      action.classification = "COVERED_MANUAL_ONLY";
      continue;
    }
    if (action.normalizedPath?.startsWith("/v2/")) {
      action.classification = action.routeName ? "UNCOVERED_BACKEND_ACTION" : "UNCOVERED_NATIVE_ACTION";
      continue;
    }
    if (isV1) {
      action.classification = "STALE_V1_CALL";
      action.notes.push("Legacy v1 call still reachable from the current Native tree.");
      continue;
    }
    action.classification = "UNKNOWN";
  }
  return actions;
}

function summarize(actions: NativeActionRecord[]) {
  const summary: Record<string, number> = {};
  const triggerSummary: Record<string, number> = {};
  for (const action of actions) {
    summary[action.classification] = (summary[action.classification] ?? 0) + 1;
    for (const trigger of action.triggerKinds) {
      triggerSummary[trigger] = (triggerSummary[trigger] ?? 0) + 1;
    }
  }
  return {
    summary,
    triggerSummary,
    routeSummary: {
      nativeActions: actions.length,
      nativeActionsWithBackendRoute: actions.filter((action) => Boolean(action.routeName)).length,
      staleV1Calls: actions.filter((action) => action.classification === "STALE_V1_CALL").length,
      doubleFetchRisks: actions.filter((action) => action.classification === "DOUBLE_FETCH_RISK").length,
      uncoveredBackendActions: actions.filter((action) => action.classification === "UNCOVERED_BACKEND_ACTION").length,
      uncoveredNativeActions: actions.filter((action) => action.classification === "UNCOVERED_NATIVE_ACTION").length,
    },
  };
}

function buildMarkdown(actions: NativeActionRecord[]): MarkdownSummary {
  const sorted = [...actions].sort((a, b) => {
    const surface = a.surface.localeCompare(b.surface);
    if (surface !== 0) return surface;
    return a.file.localeCompare(b.file) || a.line - b.line;
  });
  const counts = summarize(sorted);
  const inventoryLines: string[] = [];
  const coverageLines: string[] = [];

  inventoryLines.push("# Native Action Surface Inventory - 2026-04-25");
  inventoryLines.push("");
  inventoryLines.push(`Generated: ${new Date().toISOString()}`);
  inventoryLines.push("");
  inventoryLines.push("## Scope");
  inventoryLines.push("");
  inventoryLines.push("- Exhaustive static scan of Native-side backend-triggering actions, handler entrypoints, refresh/pagination paths, and deep-link/notification-adjacent data fetches.");
  inventoryLines.push("- Local-only visual gestures are represented when they are attached to a backend-bearing surface or handler file; route-less UI chrome remains out of this inventory unless it gates backend data.");
  inventoryLines.push("");
  inventoryLines.push("## Action Matrix");
  inventoryLines.push("");
  inventoryLines.push("| Surface | File | Function | Trigger | Method | Backend Route | Route Name | Request Shape | Response Fields Used | Firestore Truth | Priority | Status |");
  inventoryLines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of sorted) {
    inventoryLines.push(
      `| ${row.surface} | \`${row.file}:${row.line}\` | \`${row.functionName ?? "anonymous"}\` | \`${row.triggerKinds.join(",")}\` | \`${row.method ?? "n/a"}\` | \`${row.rawPath ?? "n/a"}\` | \`${row.routeName ?? "n/a"}\` | ${row.requestShape.length ? `\`${row.requestShape.join(", ")}\`` : "n/a"} | ${row.responseFields.length ? `\`${row.responseFields.join(", ")}\`` : "n/a"} | ${row.sourceFirestoreDocsExpected.join(", ")} | \`${row.priority}\` | \`${row.classification}\` |`,
    );
  }

  coverageLines.push("# Native Action Coverage Report - 2026-04-25");
  coverageLines.push("");
  coverageLines.push(`Generated: ${new Date().toISOString()}`);
  coverageLines.push("");
  coverageLines.push("## Summary");
  coverageLines.push("");
  for (const [key, value] of Object.entries(counts.summary).sort((a, b) => a[0].localeCompare(b[0]))) {
    coverageLines.push(`- ${key}: ${value}`);
  }
  coverageLines.push("");
  coverageLines.push("## Trigger Mix");
  coverageLines.push("");
  for (const [key, value] of Object.entries(counts.triggerSummary).sort((a, b) => b[1] - a[1])) {
    coverageLines.push(`- ${key}: ${value}`);
  }
  coverageLines.push("");
  coverageLines.push("## Route Summary");
  coverageLines.push("");
  coverageLines.push(`- Native actions discovered: ${counts.routeSummary.nativeActions}`);
  coverageLines.push(`- Native actions mapped to Backendv2 routes: ${counts.routeSummary.nativeActionsWithBackendRoute}`);
  coverageLines.push(`- Stale v1 calls: ${counts.routeSummary.staleV1Calls}`);
  coverageLines.push(`- Double fetch risks: ${counts.routeSummary.doubleFetchRisks}`);
  coverageLines.push(`- Uncovered backend actions: ${counts.routeSummary.uncoveredBackendActions}`);
  coverageLines.push(`- Uncovered native actions: ${counts.routeSummary.uncoveredNativeActions}`);
  coverageLines.push("");
  coverageLines.push("## Highest-Risk Findings");
  coverageLines.push("");
  const findings = sorted.filter((row) =>
    ["STALE_V1_CALL", "DOUBLE_FETCH_RISK", "UNCOVERED_BACKEND_ACTION", "UNCOVERED_NATIVE_ACTION"].includes(row.classification),
  );
  if (findings.length === 0) {
    coverageLines.push("- None");
  } else {
    for (const row of findings.slice(0, 50)) {
      coverageLines.push(
        `- \`${row.classification}\` ${row.file}:${row.line} -> ${row.rawPath ?? "route-less"} (${row.functionName ?? "anonymous"}; triggers ${row.triggerKinds.join(",")})`,
      );
    }
  }
  coverageLines.push("");
  coverageLines.push("## Full Matrix");
  coverageLines.push("");
  coverageLines.push("| Status | Surface | File | Trigger | Method | Route | Route Name | Semantic | Architecture | Full Audit |");
  coverageLines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of sorted) {
    coverageLines.push(
      `| \`${row.classification}\` | ${row.surface} | \`${row.file}:${row.line}\` | \`${row.triggerKinds.join(",")}\` | \`${row.method ?? "n/a"}\` | \`${row.rawPath ?? "n/a"}\` | \`${row.routeName ?? "n/a"}\` | \`${row.currentSemanticCoverage ?? "none"}\` | \`${row.currentArchitectureCoverage ?? "none"}\` | \`${row.currentFullAuditCoverage ?? "none"}\` |`,
    );
  }

  return { inventoryLines, coverageLines };
}

async function main() {
  const [contracts, routeBindings, coverageLookups] = await Promise.all([
    extractContracts(),
    extractContracts().then((result) => extractRouteBindings(result.byPath)),
    buildExistingCoverageLookups(),
  ]);
  const routeLookups = buildRouteLookups(routeBindings);
  const { actions, doubleFetchScopes } = await extractNativeActions(routeLookups, contracts.byName);
  const classified = classifyActions(actions, doubleFetchScopes, coverageLookups);
  const sorted = classified.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const counts = summarize(sorted);
  const report: JsonReport = {
    generatedAt: new Date().toISOString(),
    summary: counts.summary,
    triggerSummary: counts.triggerSummary,
    routeSummary: counts.routeSummary,
    actions: sorted,
  };
  const markdown = buildMarkdown(sorted);

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.mkdir(path.dirname(coverageDocPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(coverageDocPath, `${markdown.coverageLines.join("\n")}\n`, "utf8");
  await fs.writeFile(inventoryDocPath, `${markdown.inventoryLines.join("\n")}\n`, "utf8");

  console.log(`Wrote ${reportPath}`);
  console.log(`Wrote ${coverageDocPath}`);
  console.log(`Wrote ${inventoryDocPath}`);
  console.log(JSON.stringify({ ...counts.routeSummary, summary: counts.summary, policies: listRoutePolicies().length }, null, 2));
}

await main();
