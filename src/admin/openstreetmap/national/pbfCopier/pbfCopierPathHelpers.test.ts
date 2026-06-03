import { describe, expect, it } from "vitest";
import {
  DEFAULT_VERMONT_PBF_PATH,
  inferStateCodeFromFilePath,
  isVermontPbfPath,
  VERMONT_PBF_DOWNLOAD_COMMAND,
} from "./pbfCopierPathHelpers.js";
import { DEFAULT_PBF_COPIER_CONFIG } from "./pbfCopierTypes.js";

describe("pbfCopierPathHelpers", () => {
  it("defaults Vermont PBF path", () => {
    expect(DEFAULT_VERMONT_PBF_PATH).toBe("./data/osm/vermont-latest.osm.pbf");
  });

  it("includes Geofabrik download command without auto-download", () => {
    expect(VERMONT_PBF_DOWNLOAD_COMMAND).toContain("curl -L -o data/osm/vermont-latest.osm.pbf");
    expect(VERMONT_PBF_DOWNLOAD_COMMAND).toContain("mkdir -p data/osm");
  });

  it("infers VT from vermont file paths", () => {
    expect(inferStateCodeFromFilePath("./data/osm/vermont-latest.osm.pbf")).toBe("VT");
    expect(isVermontPbfPath("./data/osm/vermont-latest.osm.pbf")).toBe(true);
  });

  it("infers NH, ME, MA, CT, RI from common paths", () => {
    expect(inferStateCodeFromFilePath("./data/osm/new-hampshire-latest.osm.pbf")).toBe("NH");
    expect(inferStateCodeFromFilePath("./data/osm/maine-latest.osm.pbf")).toBe("ME");
    expect(inferStateCodeFromFilePath("./data/osm/massachusetts-latest.osm.pbf")).toBe("MA");
    expect(inferStateCodeFromFilePath("./data/osm/connecticut-latest.osm.pbf")).toBe("CT");
    expect(inferStateCodeFromFilePath("./data/osm/rhode-island-latest.osm.pbf")).toBe("RI");
  });

  it("defaults raw scan cap to null in copier config", () => {
    expect(DEFAULT_PBF_COPIER_CONFIG.maxRawObjectsToScan).toBeNull();
  });
});
