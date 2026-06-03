import { describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { importVtClass4RoadsGeojson } from "./vtClass4RoadsSource.js";
import { importNhClass6RoadsGeojson } from "./nhClass6RoadsSource.js";

describe("offroad state geojson sources", () => {
  it("VT Class 4 GeoJSON imports as offroading", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vt4-"));
    const file = path.join(dir, "vt4.geojson");
    await fs.writeFile(
      file,
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { name: "Pent Road", town: "Hartland", road_class: "Class 4", access: "public" },
            geometry: { type: "LineString", coordinates: [[-72.39, 43.54], [-72.388, 43.541]] },
          },
        ],
      })
    );
    const result = await importVtClass4RoadsGeojson({
      filePath: file,
      sourceLabel: "vt",
      sourceDatasetName: "vt_class4_test",
      state: "VT",
      importRunId: "test",
    });
    expect(result.routes.length).toBe(1);
    expect(result.routes[0]?.activity).toBe("offroading");
    expect(result.routes[0]?.offroad?.offroadCategory).toBe("class4_road");
  });

  it("NH Class VI GeoJSON imports as offroading", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nh6-"));
    const file = path.join(dir, "nh6.geojson");
    await fs.writeFile(
      file,
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { name: "Discontinued Road", nh_class: "VI", town: "Lebanon" },
            geometry: { type: "LineString", coordinates: [[-72.39, 43.54], [-72.387, 43.542]] },
          },
        ],
      })
    );
    const result = await importNhClass6RoadsGeojson({
      filePath: file,
      sourceLabel: "nh",
      sourceDatasetName: "nh_class6_test",
      state: "NH",
      importRunId: "test",
    });
    expect(result.routes.length).toBe(1);
    expect(result.routes[0]?.offroad?.offroadCategory).toBe("class6_road");
  });

  it("VTrans AOTCLASS=4 imports as class4_road", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vt4aot-"));
    const file = path.join(dir, "vt4.geojson");
    await fs.writeFile(
      file,
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { AOTCLASS: 4, PRIMARYNAME: "TOWN LINE RD", TOWNGEOID: "5002732425" },
            geometry: { type: "LineString", coordinates: [[-72.39, 43.54], [-72.388, 43.541], [-72.386, 43.542]] },
          },
        ],
      })
    );
    const result = await importVtClass4RoadsGeojson({
      filePath: file,
      sourceLabel: "vtrans",
      sourceDatasetName: "vt_class4_test",
      state: "VT",
      importRunId: "test",
    });
    expect(result.routes.length).toBe(1);
    expect(result.routes[0]?.name).toContain("TOWN LINE RD");
    expect(result.routes[0]?.offroad?.offroadCategory).toBe("class4_road");
    expect(result.routes[0]?.offroad?.offroadConfidence).toBe("explicit");
  });

  it("private state feature rejected", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vt4p-"));
    const file = path.join(dir, "vt4.geojson");
    await fs.writeFile(
      file,
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { name: "Private Lane", road_class: "Class 4", access: "private" },
            geometry: { type: "LineString", coordinates: [[-72.39, 43.54], [-72.388, 43.541]] },
          },
        ],
      })
    );
    const result = await importVtClass4RoadsGeojson({
      filePath: file,
      sourceLabel: "vt",
      sourceDatasetName: "vt_class4_test",
      state: "VT",
      importRunId: "test",
    });
    expect(result.routes.length).toBe(0);
    expect(result.rejected.some((r) => r.reason === "private_access")).toBe(true);
  });
});
