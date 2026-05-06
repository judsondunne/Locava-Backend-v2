#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const scanDirs = [
  path.join(root, "src", "app"),
  path.join(root, "src", "dto"),
  path.join(root, "src", "lib", "posts", "app-post-v2"),
  path.join(root, "src", "repositories", "analytics"),
  path.join(root, "src", "runtime"),
  path.join(root, "src", "services", "surfaces"),
  path.join(root, "src", "routes", "v2"),
  path.join(root, "src", "orchestration", "surfaces"),
];
const allowFile = new Set([
  path.join(root, "src", "lib", "logging", "debug-log.ts"),
]);
const deny = [/console\.(log|warn|info|debug)\s*\(/];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mts)$/.test(name)) out.push(full);
  }
  return out;
}

const offenders = [];
for (const file of scanDirs.flatMap((d) => walk(d))) {
  if (allowFile.has(file) || file.includes(".test.")) continue;
  if (!file.includes(path.join("src", "app", "createApp.ts")) &&
      !file.includes(path.join("src", "dto", "compact-surface-dto.ts")) &&
      !file.includes(path.join("src", "lib", "posts", "app-post-v2", "toAppPostV2.ts")) &&
      !file.includes(path.join("src", "repositories", "analytics", "analytics-publisher.ts")) &&
      !file.includes(path.join("src", "runtime", "server-boot.ts")) &&
      !file.includes(path.join("src", "services", "surfaces", "search-places-index.service.ts")) &&
      !file.includes(path.join("src", "services", "surfaces", "feed-for-you-simple.service.ts")) &&
      !file.includes(path.join("src", "routes", "v2", "auth-mutations.routes.ts")) &&
      !file.includes(path.join("src", "orchestration", "surfaces", "posts-detail.orchestrator.ts"))) {
    continue;
  }
  const text = fs.readFileSync(file, "utf8");
  if (deny.some((re) => re.test(text))) offenders.push(path.relative(root, file));
}

if (offenders.length) {
  console.error("Logging guard failed. Raw console debug logs found:");
  for (const f of offenders) console.error(` - ${f}`);
  process.exit(1);
}
console.log("Logging guard passed.");
