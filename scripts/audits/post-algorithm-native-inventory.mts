/**
 * Scans Locava-Native `src/` for post-shaped field access (heuristic inventory).
 * Run: npx tsx scripts/audits/post-algorithm-native-inventory.mts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "../..");
const WORKSPACE = path.resolve(BACKEND_ROOT, "..");
const NATIVE_SRC = path.join(WORKSPACE, "Locava-Native", "src");
const TODAY = new Date().toISOString().slice(0, 10);
const OUT = path.join(BACKEND_ROOT, "docs", "audits", `post-algorithm-native-inventory-${TODAY}.json`);

const PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "post_dot_activities", re: /\bpost\.activities\b/g },
  { id: "post_dot_lat", re: /\bpost\.(lat|lng|long)\b/g },
  { id: "post_dot_mediaType", re: /\bpost\.mediaType\b/g },
  { id: "getPostActivities", re: /\bgetPostActivities\b/g },
  { id: "getPostCover", re: /\bgetPostCover\b/g },
  { id: "getPostMediaAssets", re: /\bgetPostMediaAssets\b/g },
  { id: "appPostV2", re: /\bappPostV2\b/g },
];

const SRC_EXT = new Set([".ts", ".tsx"]);

function* walk(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) {
    return;
  }
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (SRC_EXT.has(path.extname(e.name))) yield full;
  }
}

type Hit = { file: string; line: number; patternId: string; snippet: string };
const hits: Hit[] = [];

if (fs.existsSync(NATIVE_SRC)) {
  for (const file of walk(NATIVE_SRC)) {
    const rel = path.relative(WORKSPACE, file).replace(/\\/g, "/");
    const lines = fs.readFileSync(file, "utf8").split(/\n/);
    lines.forEach((line, i) => {
      for (const { id, re } of PATTERNS) {
        re.lastIndex = 0;
        if (re.test(line)) hits.push({ file: rel, line: i + 1, patternId: id, snippet: line.trim().slice(0, 200) });
      }
    });
  }
}

const payload = {
  generatedAt: new Date().toISOString(),
  nativeRoot: "Locava-Native/src",
  nativePresent: fs.existsSync(NATIVE_SRC),
  totalHits: hits.length,
  patternCounts: Object.fromEntries(PATTERNS.map(({ id }) => [id, hits.filter((h) => h.patternId === id).length])),
  hits: hits.slice(0, 800),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf8");
console.log(`Wrote ${OUT}`);
