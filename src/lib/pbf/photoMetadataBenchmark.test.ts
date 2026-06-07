import { describe, expect, it } from "vitest";
import type { PbfCopierPreviewDoc } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierTypes.js";
import type { PlaceImageResult } from "../../types/places.js";
import { buildOsmSpecificPhotoQuery } from "./buildOsmSpecificPhotoQuery.js";
import { deriveTargetPlaceIdentityFromParsedQuery } from "./deriveTargetPlaceIdentity.js";
import { scorePhotoSearchResultsForIdentity, scorePhotoSearchResultsForPlace } from "./scorePhotoSearchResultsForPlace.js";
import { deriveTargetPlaceIdentityFromDoc } from "./deriveTargetPlaceIdentity.js";
import { buildPlaceQuery } from "../places/searchPlaceImages.service.js";

function doc(overrides: Partial<PbfCopierPreviewDoc>): PbfCopierPreviewDoc {
  return {
    id: "way/1",
    kind: "unexplored_spot",
    displayName: "Place",
    primaryActivity: "hiking",
    primaryCategory: "trail",
    activities: ["hiking"],
    osmType: "way",
    osmId: 1,
    lat: 43.7,
    lng: -72.3,
    publicMapEligible: true,
    mapReadiness: "ready",
    ...overrides,
  } as PbfCopierPreviewDoc;
}

function img(partial: Partial<PlaceImageResult>): PlaceImageResult {
  return {
    id: "x",
    imageUrl: "https://example.com/a.jpg",
    caption: "",
    sourceName: "example.com",
    sourceUrl: "https://example.com",
    ...partial,
  };
}

function expectFound(displayName: string, partial: Partial<PbfCopierPreviewDoc>, results: PlaceImageResult[]) {
  const d = doc({ displayName, ...partial });
  const query = buildOsmSpecificPhotoQuery(d);
  const scored = scorePhotoSearchResultsForPlace(d, query, results);
  expect(scored.assetStatus, displayName).toBe("found");
  expect(scored.assetsReady, displayName).toBe(true);
  expect(scored.acceptedAssets.length, displayName).toBeGreaterThan(0);
}

function expectBlank(displayName: string, partial: Partial<PbfCopierPreviewDoc>, results: PlaceImageResult[]) {
  const d = doc({ displayName, ...partial });
  const query = buildOsmSpecificPhotoQuery(d);
  const scored = scorePhotoSearchResultsForPlace(d, query, results);
  expect(scored.assetsReady, displayName).toBe(false);
  expect(scored.acceptedAssets, displayName).toHaveLength(0);
  expect(["no_good_match", "low_confidence", "skipped"]).toContain(scored.assetStatus);
}

describe("photo metadata benchmark — 20 Vermont spots", () => {
  const SHOULD_FIND: Array<{ name: string; doc: Partial<PbfCopierPreviewDoc>; results: PlaceImageResult[] }> = [
    {
      name: "Quechee Covered Bridge",
      doc: { displayName: "Quechee Covered Bridge", primaryCategory: "bridge", sourceTagSample: { "addr:city": "Quechee" } },
      results: [
        img({ caption: "Quechee Covered Bridge Hartford Vermont", sourceUrl: "https://www.hartford-vt.org/quechee-covered-bridge", sourceName: "hartford-vt.org" }),
        img({ caption: "Historic Quechee covered bridge over Ottauquechee River", sourceUrl: "https://en.wikipedia.org/wiki/Quechee_Covered_Bridge", sourceName: "wikipedia.org" }),
      ],
    },
    {
      name: "Martha Canfield Library",
      doc: { displayName: "Martha Canfield Library", primaryCategory: "library", sourceTagSample: { "addr:city": "Arlington" } },
      results: [
        img({ caption: "Martha Canfield Library exterior Arlington Vermont", sourceUrl: "https://benningtonbanner.com/martha-canfield-library", sourceName: "benningtonbanner.com" }),
        img({ caption: "Martha Canfield Library Arlington VT building", sourceUrl: "https://librarytechnology.org/loc/martha-canfield", sourceName: "librarytechnology.org" }),
      ],
    },
    {
      name: "Mink Brook Swimming Area",
      doc: { displayName: "Mink Brook Swimming Area", primaryCategory: "swimming", sourceTagSample: { "addr:city": "Norwich" } },
      results: [
        img({ caption: "Mink Brook Swimming Area Norwich Vermont", sourceUrl: "https://www.norwich.vt.us/mink-brook", sourceName: "norwich.vt.us" }),
        img({ caption: "Mink Brook natural swimming hole Norwich VT", sourceUrl: "https://www.alltrails.com/mink-brook-norwich", sourceName: "alltrails.com" }),
      ],
    },
    {
      name: "Taftsville Covered Bridge",
      doc: { displayName: "Taftsville Covered Bridge", primaryCategory: "bridge", sourceTagSample: { "addr:city": "Woodstock" } },
      results: [
        img({ caption: "Taftsville Covered Bridge Woodstock Vermont Ottauquechee River", sourceUrl: "https://www.vermontvacation.com/taftsville-covered-bridge", sourceName: "vermontvacation.com" }),
        img({ caption: "Taftsville bridge Woodstock VT historic photo", sourceUrl: "https://commons.wikimedia.org/wiki/Taftsville_Covered_Bridge", sourceName: "wikimedia.org" }),
      ],
    },
    {
      name: "Quechee Gorge",
      doc: { displayName: "Quechee Gorge", primaryCategory: "gorge", sourceTagSample: { "addr:city": "Hartford" } },
      results: [
        img({ caption: "Quechee Gorge Vermont state park overlook", sourceUrl: "https://vtstateparks.com/quechee.html", sourceName: "vtstateparks.com" }),
        img({ caption: "Quechee Gorge Little Grand Canyon Hartford VT", sourceUrl: "https://www.vermontvacation.com/quechee-gorge", sourceName: "vermontvacation.com" }),
      ],
    },
    {
      name: "Billings Farm",
      doc: { displayName: "Billings Farm & Museum", primaryCategory: "museum", sourceTagSample: { "addr:city": "Woodstock" } },
      results: [
        img({ caption: "Billings Farm Museum Woodstock Vermont", sourceUrl: "https://billingsfarm.org/visit", sourceName: "billingsfarm.org" }),
        img({ caption: "Billings Farm historic barn Woodstock VT", sourceUrl: "https://www.woodstockvt.com/billings-farm", sourceName: "woodstockvt.com" }),
      ],
    },
    {
      name: "Shelburne Museum",
      doc: { displayName: "Shelburne Museum", primaryCategory: "museum", sourceTagSample: { "addr:city": "Shelburne" } },
      results: [
        img({ caption: "Shelburne Museum campus Shelburne Vermont", sourceUrl: "https://shelburnemuseum.org/visit", sourceName: "shelburnemuseum.org" }),
        img({ caption: "Shelburne Museum round barn Vermont", sourceUrl: "https://www.vermontvacation.com/shelburne-museum", sourceName: "vermontvacation.com" }),
      ],
    },
    {
      name: "Moss Glen Falls",
      doc: { displayName: "Moss Glen Falls", primaryCategory: "waterfall", sourceTagSample: { "addr:city": "Granville" } },
      results: [
        img({ caption: "Moss Glen Falls Granville Vermont waterfall", sourceUrl: "https://www.alltrails.com/trail/moss-glen-falls", sourceName: "alltrails.com" }),
        img({ caption: "Moss Glen Falls Granville VT scenic cascade", sourceUrl: "https://www.vermontvacation.com/moss-glen-falls", sourceName: "vermontvacation.com" }),
      ],
    },
    {
      name: "Warren Covered Bridge",
      doc: { displayName: "Warren Covered Bridge", primaryCategory: "bridge", sourceTagSample: { "addr:city": "Warren" } },
      results: [
        img({ caption: "Warren Covered Bridge Warren Vermont", sourceUrl: "https://www.warrenvt.com/covered-bridge", sourceName: "warrenvt.com" }),
        img({ caption: "Warren covered bridge Mad River VT", sourceUrl: "https://en.wikipedia.org/wiki/Warren_Covered_Bridge", sourceName: "wikipedia.org" }),
      ],
    },
    {
      name: "Marsh-Billings-Rockefeller",
      doc: { displayName: "Marsh-Billings-Rockefeller National Historical Park", primaryCategory: "park", sourceTagSample: { "addr:city": "Woodstock" } },
      results: [
        img({ caption: "Marsh Billings Rockefeller National Historical Park Woodstock Vermont", sourceUrl: "https://www.nps.gov/mabi/", sourceName: "nps.gov" }),
        img({ caption: "Marsh-Billings-Rockefeller mansion Woodstock VT", sourceUrl: "https://www.woodstockvt.com/marsh-billings", sourceName: "woodstockvt.com" }),
      ],
    },
  ];

  const SHOULD_BLANK: Array<{ name: string; doc: Partial<PbfCopierPreviewDoc>; results: PlaceImageResult[] }> = [
    {
      name: "Hazen Trail — generic listing",
      doc: { displayName: "Hazen Trail", primaryCategory: "hiking_trail", sourceTagSample: { "addr:city": "Norwich" } },
      results: [
        img({ caption: "Best hiking trails in Vermont for beginners", sourceUrl: "https://blog.example.com/best-trails-vermont", sourceName: "blog.example.com" }),
        img({ caption: "Top 10 trails near Norwich Vermont", sourceUrl: "https://travel.example.com/norwich-trails", sourceName: "travel.example.com" }),
      ],
    },
    {
      name: "Sample's Jump — generic UVLT",
      doc: { displayName: "Sample's Jump", primaryCategory: "swimming", sourceTagSample: { "addr:city": "Norwich" } },
      results: [
        img({ caption: "Upper Valley Land Trust conserved lands Vermont", sourceUrl: "https://uvlt.org/lands", sourceName: "uvlt.org" }),
        img({ caption: "UVLT conservation map Norwich region", sourceUrl: "https://uvlt.org/map", sourceName: "uvlt.org" }),
      ],
    },
    {
      name: "Connector Trail — generic name",
      doc: { displayName: "Connector Trail", primaryCategory: "hiking_trail" },
      results: [
        img({ caption: "Connector trail Vermont woods hiking", sourceUrl: "https://example.com/trail", sourceName: "example.com" }),
      ],
    },
    {
      name: "Unnamed Hiking Trail",
      doc: { displayName: "Unnamed Hiking Trail", primaryCategory: "hiking_trail" },
      results: [
        img({ caption: "Hiking trail Vermont forest", sourceUrl: "https://example.com/hike", sourceName: "example.com" }),
      ],
    },
    {
      name: "Generic Vermont covered bridge",
      doc: { displayName: "Covered Bridge", primaryCategory: "bridge", sourceTagSample: { "addr:city": "Woodstock" } },
      results: [
        img({ caption: "Beautiful covered bridge in Vermont autumn", sourceUrl: "https://stock.example.com/vt-bridge", sourceName: "shutterstock.com" }),
        img({ caption: "Middle Covered Bridge Woodstock Vermont", sourceUrl: "https://woodstockvt.com/middle-bridge", sourceName: "woodstockvt.com" }),
      ],
    },
    {
      name: "Shelter — generic only",
      doc: { displayName: "Shelter", primaryCategory: "shelter", sourceTagSample: { "addr:city": "Woodstock" } },
      results: [
        img({ caption: "Picnic shelter Woodstock Vermont park", sourceUrl: "https://example.com/shelter", sourceName: "example.com" }),
      ],
    },
    {
      name: "Viewpoint Norwich generic",
      doc: { displayName: "Viewpoint", primaryCategory: "viewpoint", sourceTagSample: { "addr:city": "Norwich" } },
      results: [
        img({ caption: "Scenic viewpoint Norwich Vermont valley", sourceUrl: "https://example.com/view", sourceName: "example.com" }),
      ],
    },
    {
      name: "Blood Brook — wrong similar name",
      doc: { displayName: "Blood Brook Falls", primaryCategory: "waterfall", sourceTagSample: { "addr:city": "Greenfield" } },
      results: [
        img({ caption: "Moss Glen Falls Granville Vermont waterfall scenic", sourceUrl: "https://example.com/moss-glen", sourceName: "example.com" }),
        img({ caption: "Vermont waterfall hiking guide best falls", sourceUrl: "https://blog.example.com/vt-waterfalls", sourceName: "blog.example.com" }),
      ],
    },
    {
      name: "Norwich photo without trail name",
      doc: { displayName: "Hazen Trail", primaryCategory: "hiking_trail", sourceTagSample: { "addr:city": "Norwich" } },
      results: [
        img({ caption: "Downtown Norwich Vermont village green", sourceUrl: "https://norwich.vt.us/downtown", sourceName: "norwich.vt.us" }),
        img({ caption: "Norwich Vermont fall foliage village", sourceUrl: "https://vermontvacation.com/norwich", sourceName: "vermontvacation.com" }),
      ],
    },
    {
      name: "Flyer-heavy library events",
      doc: { displayName: "Martha Canfield Library", primaryCategory: "library", sourceTagSample: { "addr:city": "Arlington" } },
      results: [
        img({ imageUrl: "https://marthacanfieldlibrary.org/wp-content/uploads/flyer.png", caption: "Summer reading program flyer Martha Canfield Library", sourceUrl: "https://marthacanfieldlibrary.org/events", sourceName: "marthacanfieldlibrary.org" }),
        img({ caption: "Library newsletter agenda meeting minutes", sourceUrl: "https://marthacanfieldlibrary.org/calendar", sourceName: "marthacanfieldlibrary.org" }),
      ],
    },
  ];

  for (const spot of SHOULD_FIND) {
    it(`ACCEPT: ${spot.name}`, () => {
      expectFound(spot.doc.displayName!, spot.doc, spot.results);
    });
  }

  for (const spot of SHOULD_BLANK) {
    it(`REJECT: ${spot.name}`, () => {
      expectBlank(spot.doc.displayName!, spot.doc, spot.results);
    });
  }

  it("parsed query: Quechee Gorge Vermont accepts exact titles", () => {
    const q = buildPlaceQuery("Quechee Gorge Vermont");
    const identity = deriveTargetPlaceIdentityFromParsedQuery(q);
    const scored = scorePhotoSearchResultsForIdentity(identity, [
      img({ caption: "Quechee Gorge Vermont state park", sourceUrl: "https://vtstateparks.com/quechee", sourceName: "vtstateparks.com" }),
      img({ caption: "Quechee Gorge overlook Hartford VT", sourceUrl: "https://vermontvacation.com/quechee-gorge", sourceName: "vermontvacation.com" }),
    ]);
    expect(scored.assetsReady).toBe(true);
  });

  it("parsed query: Woodstock Vermont alone is too broad without feature", () => {
    const q = buildPlaceQuery("Woodstock Vermont");
    const identity = deriveTargetPlaceIdentityFromParsedQuery(q);
    expect(identity.requiredNameTokens).toContain("woodstock");
  });
});
