import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "..");
const NATIVE_SRC = path.join(ROOT, "Locava-Native", "src");
const ROUTES_SRC = path.join(process.cwd(), "src", "routes");
const OUTPUT = path.join(ROOT, "docs", "backendv2-native-path-coverage-2026-04-23.md");

const PATH_PATTERN = /["'`]((?:\/api\/v1\/product|\/v2)\/[^"'`\s)]+)["'`]/g;
const ROUTE_PATTERN = /app\.(?:get|post|put|patch|delete)(?:<[\s\S]*?>)?\("([^"]+)"/g;
const CONTRACT_PATTERN = /path:\s*"([^"]+)"/g;

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(p)));
    } else if (entry.isFile() && (p.endsWith(".ts") || p.endsWith(".tsx") || p.endsWith(".js"))) {
      out.push(p);
    }
  }
  return out;
}

function normalize(p: string): string {
  return p
    .replace(/\$\{[^}]+\}/g, ":param")
    .replace(/:param:param/g, ":param")
    .replace(/\?.*$/, "")
    .replace(/[;,]+$/, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function toRegex(route: string): RegExp {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wild = escaped
    .replace(/:([A-Za-z0-9_]+)/g, "[^/]+")
    .replace(/\\\*/g, ".*");
  return new RegExp(`^${wild}$`);
}

async function extractNativePaths(): Promise<Set<string>> {
  const files = await walk(NATIVE_SRC);
  const paths = new Set<string>();
  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    for (const match of text.matchAll(PATH_PATTERN)) {
      const p = normalize(match[1] ?? "");
      if (
        (p.startsWith("/api/v1/product/") || p.startsWith("/v2/")) &&
        !p.includes("*") &&
        p.split("/").length > 3
      ) {
        paths.add(p);
      }
    }
  }
  return paths;
}

async function extractBackendRoutes(): Promise<string[]> {
  const files = await walk(ROUTES_SRC);
  const routes: string[] = [];
  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    for (const match of text.matchAll(ROUTE_PATTERN)) {
      const route = normalize(match[1] ?? "");
      if (
        (route.startsWith("/api/v1/product/") || route.startsWith("/v2/")) &&
        !route.includes("*") &&
        route.split("/").length > 3
      ) {
        routes.push(route);
      }
    }
    for (const match of text.matchAll(CONTRACT_PATTERN)) {
      const route = normalize(match[1] ?? "");
      if (
        (route.startsWith("/api/v1/product/") || route.startsWith("/v2/")) &&
        !route.includes("*") &&
        route.split("/").length > 3
      ) {
        routes.push(route);
      }
    }
  }
  return [...new Set(routes)].sort();
}

function covered(nativePath: string, routes: string[]): boolean {
  return routes.some((r) => toRegex(r).test(nativePath));
}

async function main(): Promise<void> {
  const native = [...(await extractNativePaths())].sort();
  const routes = await extractBackendRoutes();
  const missing = native.filter((p) => !covered(p, routes));
  const coveredNative = native.filter((p) => covered(p, routes));
  const coveredCount = native.length - missing.length;
  const lines: string[] = [];
  lines.push("# Native Path Coverage (2026-04-23)");
  lines.push("");
  lines.push(`- Native paths detected: ${native.length}`);
  lines.push(`- Backendv2/compat routes detected: ${routes.length}`);
  lines.push(`- Covered: ${coveredCount}`);
  lines.push(`- Missing: ${missing.length}`);
  lines.push("");
  lines.push("## Missing Paths");
  lines.push("");
  if (missing.length === 0) {
    lines.push("- None detected");
  } else {
    for (const p of missing) lines.push(`- \`${p}\``);
  }
  lines.push("");
  lines.push("## Covered Paths (Native)");
  lines.push("");
  for (const p of coveredNative) lines.push(`- \`${p}\``);
  await fs.writeFile(OUTPUT, `${lines.join("\n")}\n`, "utf8");
  console.log(`Wrote ${OUTPUT}`);
}

await main();
