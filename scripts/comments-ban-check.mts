import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const banned = [
  "fakeComments",
  "mockComments",
  "demoComments",
  "fallbackComments",
  "placeholder comments",
  "sample comments"
];

const allowIn = ["/docs/", ".test.", "comments-ban-check.mts"];
const targets = ["src", "../Locava-Native/src/features/comments"];
const violations: string[] = [];

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|mts|js|jsx|md)$/.test(entry.name)) out.push(full);
  }
  return out;
}

for (const target of targets) {
  for (const file of walk(path.resolve(root, target))) {
    const rel = path.relative(root, file);
    if (allowIn.some((token) => rel.includes(token))) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const term of banned) {
      if (text.includes(term)) violations.push(`${rel}: ${term}`);
    }
  }
}

if (violations.length > 0) {
  console.error("Banned comments fallback terms found:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}
console.log("comments-ban-check passed");
