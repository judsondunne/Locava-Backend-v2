import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderOpenStreetMapPbfCopierPage } from "./openstreetmap-pbf-copier.js";

describe("renderOpenStreetMapPbfCopierPage", () => {
  it("renders and inline script parses", () => {
    const html = renderOpenStreetMapPbfCopierPage();
    expect(html).toContain("Master PBF OSM Copier");
    expect(html).toContain("btnValidateFile");
    const match = html.match(/<script>\n([\s\S]*?)<\/script>/);
    expect(match).toBeTruthy();
    const jsPath = join(tmpdir(), "pbf-copier-page-" + process.pid + ".js");
    writeFileSync(jsPath, match![1]!);
    execSync(`node --check ${JSON.stringify(jsPath)}`, { stdio: "pipe" });
  });
});
