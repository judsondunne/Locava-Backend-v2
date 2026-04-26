import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

type TestSummary = {
  generatedAt: string;
  command: string[];
  exitCode: number | null;
};

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "..");
const reportPath = path.join(backendRoot, "tmp", "native-action-tests-report.json");

const testFiles = [
  "src/routes/v2/auth-bootstrap.routes.test.ts",
  "src/routes/v2/collections-create.routes.test.ts",
  "src/routes/v2/collections-detail.routes.test.ts",
  "src/routes/v2/collections-list.routes.test.ts",
  "src/routes/v2/collections-update.routes.test.ts",
  "src/routes/v2/comments.routes.test.ts",
  "src/routes/v2/chats-inbox.routes.test.ts",
  "src/routes/v2/feed-bootstrap.routes.test.ts",
  "src/routes/v2/feed-item-detail.routes.test.ts",
  "src/routes/v2/feed-page.routes.test.ts",
  "src/routes/v2/map-bootstrap.routes.test.ts",
  "src/routes/v2/map-markers.routes.test.ts",
  "src/routes/v2/notifications.routes.test.ts",
  "src/routes/v2/post-detail.routes.test.ts",
  "src/routes/v2/posts-detail.routes.test.ts",
  "src/routes/v2/posts-publish.routes.test.ts",
  "src/routes/v2/posting-media.routes.test.ts",
  "src/routes/v2/posting.routes.test.ts",
  "src/routes/v2/profile-grid.routes.test.ts",
  "src/routes/v2/profile-post-detail.routes.test.ts",
  "src/routes/v2/profile.routes.test.ts",
  "src/routes/v2/search-discovery.routes.test.ts",
  "src/routes/v2/search-results.routes.test.ts",
  "src/routes/v2/search-users.routes.test.ts",
  "src/routes/v2/social.routes.test.ts",
  "src/repositories/surfaces/achievements.repository.test.ts",
  "src/repositories/surfaces/auth-bootstrap.repository.test.ts",
  "src/repositories/surfaces/feed.repository.test.ts",
  "src/repositories/surfaces/profile-post-detail.repository.test.ts",
  "src/repositories/surfaces/profile.repository.test.ts",
  "src/repositories/surfaces/search.repository.test.ts",
  "src/repositories/surfaces/search-users.repository.test.ts",
  "src/services/mutations/posting-mutation.service.test.ts",
  "src/services/surfaces/achievements.service.test.ts",
  "src/services/surfaces/search.service.test.ts",
];

function runVitest(): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(backendRoot, "node_modules", "vitest", "vitest.mjs"), "run", ...testFiles],
      {
        cwd: backendRoot,
        stdio: "inherit",
        env: process.env,
      }
    );
    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  });
}

async function main() {
  const exitCode = await runVitest();
  const summary: TestSummary = {
    generatedAt: new Date().toISOString(),
    command: ["vitest", "run", ...testFiles],
    exitCode,
  };
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (exitCode && exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

await main();
