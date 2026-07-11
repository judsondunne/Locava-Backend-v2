/**
 * Instagram reel downloader MVP — /admin/instagram-downloader
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function resolveAssetDir(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, "instagram-reel-downloader"),
    join(process.cwd(), "src", "dashboard", "instagram-reel-downloader"),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "content.html"))) return dir;
  }
  return join(moduleDir, "instagram-reel-downloader");
}

let cachedHtml: string | null = null;

export function renderInstagramReelDownloaderPage(): string {
  if (cachedHtml) return cachedHtml;
  const dir = resolveAssetDir();
  const css = readFileSync(join(dir, "styles.css"), "utf8");
  const content = readFileSync(join(dir, "content.html"), "utf8");
  const js = readFileSync(join(dir, "app.js"), "utf8");
  cachedHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Instagram Reel Downloader</title>
  <style>${css}</style>
</head>
<body>
${content}
<script>${js}</script>
</body>
</html>`;
  return cachedHtml;
}
