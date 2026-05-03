import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type AuditRow = {
  id: string;
  routeName: string | null;
  statusCode: number | null;
  classification: string;
};

type AuditReport = {
  generatedAt: string;
  rows: AuditRow[];
};

const reportPath = path.resolve(process.cwd(), "tmp", "full-app-v2-audit-report.json");

function loadReport(): AuditReport | null {
  if (!fs.existsSync(reportPath)) return null;
  return JSON.parse(fs.readFileSync(reportPath, "utf8")) as AuditReport;
}

describe("full app launch readiness audit report", () => {
  it("covers the primary authenticated app journey with route-level results", () => {
    const report = loadReport();
    expect(report, "run npm run debug:full-app:v2-audit before this test").not.toBeNull();
    if (!report) return;

    const requiredSpecIds = [
      "auth-session",
      "feed-bootstrap",
      "feed-page",
      "map-bootstrap",
      "map-markers",
      "search-bootstrap",
      "search-results",
      "post-detail",
      "profile-bootstrap",
      "profile-grid",
      "collections-list",
      "notifications-list",
      "chats-inbox",
      "achievements-bootstrap",
      "posting-finalize"
    ];

    const byId = new Map(report.rows.map((row) => [row.id, row] as const));
    for (const id of requiredSpecIds) {
      const row = byId.get(id);
      expect(row, `missing spec in audit report: ${id}`).toBeTruthy();
      if (!row) continue;
      expect(row.statusCode, `non-success status in ${id}`).toBeGreaterThanOrEqual(200);
      expect(row.statusCode, `non-success status in ${id}`).toBeLessThan(500);
      expect(row.classification).not.toBe("MISSING_ROUTE");
    }
  });
});
