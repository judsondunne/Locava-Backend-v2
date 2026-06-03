import { diagnosePlaceInPbf } from "../../src/admin/openstreetmap/national/pbfCopier/pbfCopierDiagnosePlace.js";

const searchText = process.argv[2] ?? "Olcot Falls Mobile Home Park";

async function main() {
  const r = await diagnosePlaceInPbf({
    filePath: "./data/osm/vermont-latest.osm.pbf",
    searchText,
    maxRawObjectsToScan: null,
    stateCode: "VT",
  });
  console.log(JSON.stringify(r, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
