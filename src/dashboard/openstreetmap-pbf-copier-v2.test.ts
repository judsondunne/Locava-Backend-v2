import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderOpenStreetMapPbfCopierV2Page } from "./openstreetmap-pbf-copier-v2.js";

describe("renderOpenStreetMapPbfCopierV2Page", () => {
  it("renders and inline script parses", () => {
    const html = renderOpenStreetMapPbfCopierV2Page();
    expect(html).toContain("PBF Copier V2");
    expect(html).toContain("btnShowAllPosts");
    expect(html).toContain("btnCopyJson");
    expect(html).toContain("Support objects");
    expect(html).toContain("qfAttachSupport");
    expect(html).toContain("apply-quality-filters");
    expect(html).toContain("viewport-preview");
    expect(html).toContain("scanCacheId");
    expect(html).toContain("MAP_RENDER_CONFIG");
    expect(html).toContain("mapRenderStats");
    expect(html).toContain("Write V2 Spots");
    expect(html).toContain("validate-write-payload");
    expect(html).toContain("write-blank-spots");
    const match = html.match(/<script>\n([\s\S]*?)<\/script>/);
    expect(match).toBeTruthy();
    const jsPath = join(tmpdir(), "pbf-copier-v2-page-" + process.pid + ".js");
    writeFileSync(jsPath, match![1]!);
    execSync(`node --check ${JSON.stringify(jsPath)}`, { stdio: "pipe" });
  });
});
