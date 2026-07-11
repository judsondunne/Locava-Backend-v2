/**
 * Instagram Reel Pipeline — setup guide
 * @route GET /admin/instagram-reel-setup
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function resolveAssetDir(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, "instagram-reel-setup"),
    join(process.cwd(), "src", "dashboard", "instagram-reel-setup"),
    join(process.cwd(), "dist", "dashboard", "instagram-reel-setup"),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "content.html"))) return dir;
  }
  return join(moduleDir, "instagram-reel-setup");
}

let cachedHtml: string | null = null;

export function renderInstagramReelSetupPage(): string {
  if (cachedHtml) return cachedHtml;

  const dir = resolveAssetDir();
  const css = readFileSync(join(dir, "styles.css"), "utf8");
  const content = readFileSync(join(dir, "content.html"), "utf8");

  cachedHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Instagram Reel Pipeline — Setup Guide</title>
  <style>${css}</style>
</head>
<body>
${content}
</body>
</html>`;

  return cachedHtml;
}
