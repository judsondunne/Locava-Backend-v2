/**
 * Machine-generated grep inventory for AppPostV2 migration audit.
 * Run: npx tsx scripts/audits/app-post-v2-grep-inventory.mts
 * Output: docs/audits/app-post-v2-grep-inventory-2026-05-04.md
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "../..");
const WORKSPACE_ROOT = path.resolve(BACKEND_ROOT, "..");
const NATIVE_SRC = path.join(WORKSPACE_ROOT, "Locava-Native", "src");

const OUTPUT_REL = "docs/audits/app-post-v2-grep-inventory-2026-05-04.md";

const TERM_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "photoLink", re: /\bphotoLink\b/g },
  { label: "photoLinks2", re: /\bphotoLinks2\b/g },
  { label: "photoLinks3", re: /\bphotoLinks3\b/g },
  { label: "displayPhotoLink", re: /\bdisplayPhotoLink\b/g },
  { label: "fallbackVideoUrl", re: /\bfallbackVideoUrl\b/g },
  { label: "thumbUrl", re: /\bthumbUrl\b/g },
  { label: "posterUrl", re: /\bposterUrl\b/g },
  { label: "assets[0]", re: /assets\s*\[\s*0\s*\]/g },
  { label: "post.assets", re: /\bpost\.assets\b/g },
  { label: "media.assets", re: /\bmedia\.assets\b/g },
  { label: "imageUrl", re: /\bimageUrl\b/g },
  { label: "videoUrl", re: /\bvideoUrl\b/g },
  { label: "mediaItems", re: /\bmediaItems\b/g },
  { label: "sharedPost", re: /\bsharedPost\b/g },
  { label: "postPreview", re: /\bpostPreview\b/g },
  { label: "notification", re: /\bnotification\b/gi },
  { label: "MessageBubble", re: /\bMessageBubble\b/g },
  { label: "LiftableViewerHost", re: /\bLiftableViewerHost\b/g },
  { label: "AssetCarouselOnly", re: /\bAssetCarouselOnly\b/g },
  { label: "PostTile", re: /\bPostTile\b/g },
  { label: "EnhancedMediaContent", re: /\bEnhancedMediaContent\b/g },
  { label: "map marker", re: /\bmap\s+marker\b/gi },
  { label: "profile grid", re: /\bprofile\s+grid\b/gi },
  { label: "collection post", re: /\bcollection\s+post\b/gi },
  { label: "search result", re: /\bsearch\s+result\b/gi }
];

type Classification =
  | "migrated_appPostV2"
  | "compatibility_alias_only"
  | "legacy_fallback_inside_helper"
  | "proxy_not_transformable"
  | "test_fixture"
  | "needs_migration"
  | "unknown";

type Hit = {
  file: string;
  line: number;
  term: string;
  snippet: string;
  classification: Classification;
};

const SRC_EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs"]);

function* walkDir(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === "dist" || e.name === ".git") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkDir(full);
    else if (SRC_EXT.has(path.extname(e.name))) yield full;
  }
}

function classify(file: string, line: string, term: string): Classification {
  const f = file.replace(/\\/g, "/").toLowerCase();
  const l = line;

  if (
    f.includes("/test/") ||
    f.includes(".test.") ||
    f.includes(".spec.") ||
    f.endsWith("test.ts") ||
    f.endsWith("test.tsx")
  ) {
    return "test_fixture";
  }
  if (f.includes("docs/") && f.endsWith(".md")) return "unknown";

  if (f.includes("legacy-api-stubs") || f.includes("compat/legacy")) {
    if (l.includes("proxy") || l.includes("forward") || l.includes("fetch(")) return "proxy_not_transformable";
    return "needs_migration";
  }

  if (
    f.includes("app-post-v2") ||
    f.includes("enrichapppostv2") ||
    f.includes("toapppostv2") ||
    f.includes("post-envelope") ||
    f.includes("compact-surface-dto")
  ) {
    if (l.includes("compatibility") || l.includes("photoLink") && l.includes("z.")) return "compatibility_alias_only";
    return "migrated_appPostV2";
  }

  if (f.includes("apppostv2") && f.includes("locava-native")) {
    if (l.includes("normalize") || l.includes("fallback") || l.includes("legacy")) return "legacy_fallback_inside_helper";
    return "migrated_appPostV2";
  }

  if (l.includes("appPost") && l.includes("compatibility")) return "compatibility_alias_only";
  if (l.includes("compatibility.") && (term.startsWith("photo") || term === "displayPhotoLink")) return "compatibility_alias_only";

  if (f.includes("contracts/") && (l.includes("z.") || l.includes("Schema"))) {
    if (term === "notification" && l.includes("routeName")) return "compatibility_alias_only";
    return "compatibility_alias_only";
  }

  if (f.includes("locava-native") && (f.includes("normalize") || f.includes("getpost") || f.includes("apppost"))) {
    if (l.includes("fallback") || l.includes("legacy") || l.includes("||")) return "legacy_fallback_inside_helper";
  }

  if (f.includes("/routes/") || f.includes("/orchestration/") || f.includes("/repositories/")) {
    if (l.includes("attachAppPostV2") || l.includes("appPost") || l.includes("buildPostEnvelope") || l.includes("toFeedCardDTO"))
      return "migrated_appPostV2";
    if (term === "thumbUrl" && l.includes("preview")) return "needs_migration";
    return "needs_migration";
  }

  if (f.includes("locava-native") && f.includes("features/")) {
    if (l.includes("appPostV2") || l.includes("appPost")) return "migrated_appPostV2";
    if (["photoLink", "displayPhotoLink", "assets[0]", "post.assets", "thumbUrl", "videoUrl"].includes(term)) return "needs_migration";
  }

  return "unknown";
}

function scanFile(file: string, rel: string): Hit[] {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const merged: Hit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    for (const { label, re } of TERM_PATTERNS) {
      const testRe = new RegExp(re.source, re.flags);
      if (testRe.test(line)) {
        merged.push({
          file: rel,
          line: i + 1,
          term: label,
          snippet: line.trim().slice(0, 200),
          classification: classify(rel, line, label)
        });
      }
    }
  }
  return merged;
}

function main(): void {
  const roots: Array<{ base: string; label: string }> = [
    { base: path.join(BACKEND_ROOT, "src"), label: "Locava Backendv2/src" },
    { base: path.join(BACKEND_ROOT, "scripts"), label: "Locava Backendv2/scripts" }
  ];
  if (fs.existsSync(NATIVE_SRC)) {
    roots.push({ base: NATIVE_SRC, label: "Locava-Native/src" });
  }

  const allHits: Hit[] = [];
  for (const { base, label } of roots) {
    if (!fs.existsSync(base)) continue;
    for (const file of walkDir(base)) {
      const rel = `${label}/${path.relative(base, file).replace(/\\/g, "/")}`;
      allHits.push(...scanFile(file, rel));
    }
  }

  allHits.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));

  const byClass = new Map<Classification, number>();
  for (const h of allHits) byClass.set(h.classification, (byClass.get(h.classification) ?? 0) + 1);

  const needsMigration = allHits.filter((h) => h.classification === "needs_migration");
  const unknowns = allHits.filter((h) => h.classification === "unknown");

  let md = `# App Post V2 — grep inventory (machine-generated)\n\n`;
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += `## Summary\n\n`;
  md += `| Classification | Count |\n|---|---:|\n`;
  for (const c of [
    "migrated_appPostV2",
    "compatibility_alias_only",
    "legacy_fallback_inside_helper",
    "proxy_not_transformable",
    "test_fixture",
    "needs_migration",
    "unknown"
  ] as const) {
    md += `| ${c} | ${byClass.get(c) ?? 0} |\n`;
  }
  md += `\n**Total hits:** ${allHits.length}\n\n`;

  md += `## needs_migration (${needsMigration.length})\n\n`;
  for (const h of needsMigration.slice(0, 500)) {
    md += `- \`${h.file}:${h.line}\` **${h.term}** — \`${h.snippet.replace(/`/g, "'")}\`\n`;
  }
  if (needsMigration.length > 500) md += `\n… ${needsMigration.length - 500} more …\n`;
  md += `\n## unknown (${unknowns.length})\n\n`;
  for (const h of unknowns.slice(0, 200)) {
    md += `- \`${h.file}:${h.line}\` **${h.term}** — ${h.classification}\n`;
  }
  if (unknowns.length > 200) md += `\n… ${unknowns.length - 200} more …\n`;

  md += `\n## Full hit listing\n\n`;
  let lastFile = "";
  for (const h of allHits) {
    if (h.file !== lastFile) {
      lastFile = h.file;
      md += `\n### ${h.file}\n\n`;
    }
    md += `| L${h.line} | ${h.term} | ${h.classification} | \`${h.snippet.replace(/\|/g, "\\|").replace(/`/g, "'")}\` |\n`;
  }

  const outPath = path.join(BACKEND_ROOT, OUTPUT_REL);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md, "utf8");
  console.log(`Wrote ${outPath} (${allHits.length} hits)`);
}

main();
