import { describe, expect, it } from "vitest";
import {
  buildPublicPbfDryRunRequest,
  PBF_COPIER_VERMONT_FULL_DRY_RUN_DEFAULTS,
  PBF_COPIER_VERMONT_REVIEW_1000_DEFAULTS,
} from "./pbfCopierPublicDefaults.js";

describe("pbfCopierPublicDefaults", () => {
  it("matches Vermont full dry-run admin button defaults", () => {
    const req = buildPublicPbfDryRunRequest({ preset: "vermont_full" });
    expect(req.filePath).toBe(PBF_COPIER_VERMONT_FULL_DRY_RUN_DEFAULTS.filePath);
    expect(req.acceptedLimit).toBe(100);
    expect(req.maxRawObjectsToScan).toBeNull();
    expect(req.config.skipExisting).toBe(false);
    expect(req.config.stateCode).toBe("VT");
    expect(req.config.includePublicOnly).toBe(true);
    expect(req.config.includeReviewDocs).toBe(false);
  });

  it("supports vermont_review_1000 preset", () => {
    const req = buildPublicPbfDryRunRequest({ preset: "vermont_review_1000" });
    expect(req.acceptedLimit).toBe(1000);
    expect(req.filePath).toBe(PBF_COPIER_VERMONT_REVIEW_1000_DEFAULTS.filePath);
    expect(req.config.dryRunLimit).toBe(1000);
  });

  it("supports maxAccepted override on vermont_full", () => {
    const req = buildPublicPbfDryRunRequest({ preset: "vermont_full", maxAccepted: 250 });
    expect(req.acceptedLimit).toBe(250);
  });

  it("supports fast smoke overrides", () => {
    const req = buildPublicPbfDryRunRequest({ preset: "fast_smoke", fast: true });
    expect(req.acceptedLimit).toBe(5);
    expect(req.maxRawObjectsToScan).toBe(250_000);
    expect(req.mode).toBe("fast_dry_run");
  });
});
