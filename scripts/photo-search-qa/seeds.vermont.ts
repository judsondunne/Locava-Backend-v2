import type { PhotoQaSeedPlace } from "./types.js";

function slugId(placeName: string, town: string): string {
  return `${placeName}-${town}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const RAW_SEEDS: Omit<PhotoQaSeedPlace, "id">[] = [
  {
    placeName: "Bingham Falls",
    town: "Stowe",
    state: "VT",
    osmStyleTags: ["natural=waterfall", "tourism=attraction", "waterway=waterfall", "leisure=nature_reserve"],
    searchQueries: ["Bingham Falls, Stowe, Vermont", "Bingham Falls waterfall Stowe VT"],
    expectedVisualSignals: ["waterfall", "rock gorge", "forest", "pool", "cascading water"],
    wrongPlaceWarnings: ["Binghamton", "New York", "generic waterfall"],
  },
  {
    placeName: "Moss Glen Falls",
    town: "Granville",
    state: "VT",
    osmStyleTags: ["natural=waterfall", "tourism=attraction", "waterway=waterfall"],
    searchQueries: ["Moss Glen Falls, Granville, Vermont", "Moss Glen Falls Granville VT waterfall"],
    expectedVisualSignals: ["tall waterfall", "roadside waterfall", "forest", "cliff"],
    wrongPlaceWarnings: ["Moss Glen Falls Stowe unless query says Stowe", "generic waterfall"],
  },
  {
    placeName: "Moss Glen Falls",
    town: "Stowe",
    state: "VT",
    osmStyleTags: ["natural=waterfall", "tourism=attraction", "waterway=waterfall", "hiking=trail"],
    searchQueries: ["Moss Glen Falls, Stowe, Vermont", "Moss Glen Falls Stowe VT trail"],
    expectedVisualSignals: ["waterfall", "woods", "short trail", "rocky stream"],
    wrongPlaceWarnings: ["Granville Moss Glen Falls unless query says Granville"],
  },
  {
    placeName: "Texas Falls",
    town: "Hancock",
    state: "VT",
    osmStyleTags: ["natural=waterfall", "tourism=attraction", "waterway=waterfall", "highway=path"],
    searchQueries: ["Texas Falls, Hancock, Vermont", "Texas Falls Recreation Area VT"],
    expectedVisualSignals: ["waterfall", "gorge", "bridge", "forest", "stream"],
    wrongPlaceWarnings: ["Texas state", "generic falls"],
  },
  {
    placeName: "Warren Falls",
    town: "Warren",
    state: "VT",
    osmStyleTags: ["natural=waterfall", "tourism=attraction", "natural=swimming_hole"],
    searchQueries: ["Warren Falls, Warren, Vermont", "Warren Falls swimming hole VT"],
    expectedVisualSignals: ["swimming hole", "waterfall", "rock pools", "clear water"],
    wrongPlaceWarnings: ["Warren County", "generic swimming hole"],
  },
  {
    placeName: "Bartlett Falls",
    town: "Bristol",
    state: "VT",
    osmStyleTags: ["natural=waterfall", "tourism=attraction", "natural=swimming_hole"],
    searchQueries: ["Bartlett Falls, Bristol, Vermont", "Bartlett Falls Bristol VT swimming hole"],
    expectedVisualSignals: ["wide waterfall", "swimming hole", "rock ledge", "river"],
    wrongPlaceWarnings: ["Bartlett New Hampshire"],
  },
  {
    placeName: "Falls of Lana",
    town: "Salisbury",
    state: "VT",
    osmStyleTags: ["natural=waterfall", "tourism=attraction", "hiking=trail", "natural=forest"],
    searchQueries: ["Falls of Lana, Salisbury, Vermont", "Falls of Lana VT waterfall"],
    expectedVisualSignals: ["cascade", "forest trail", "rocky stream"],
    wrongPlaceWarnings: ["Lana Del Rey", "generic falls"],
  },
  {
    placeName: "Lye Brook Falls",
    town: "Manchester",
    state: "VT",
    osmStyleTags: ["natural=waterfall", "tourism=attraction", "hiking=trail", "boundary=protected_area"],
    searchQueries: ["Lye Brook Falls, Manchester, Vermont", "Lye Brook Falls trail VT"],
    expectedVisualSignals: ["tall waterfall", "forest", "hiking trail"],
    wrongPlaceWarnings: ["generic waterfall"],
  },
  {
    placeName: "Hamilton Falls",
    town: "Jamaica",
    state: "VT",
    osmStyleTags: ["natural=waterfall", "tourism=attraction", "natural=swimming_hole"],
    searchQueries: ["Hamilton Falls, Jamaica, Vermont", "Hamilton Falls VT waterfall"],
    expectedVisualSignals: ["waterfall", "rock chute", "forest", "pool"],
    wrongPlaceWarnings: ["Hamilton Ontario", "Jamaica country"],
  },
  {
    placeName: "Thundering Brook Falls",
    town: "Killington",
    state: "VT",
    osmStyleTags: ["natural=waterfall", "tourism=attraction", "hiking=trail", "boardwalk=yes"],
    searchQueries: ["Thundering Brook Falls, Killington, Vermont", "Thundering Brook Falls VT"],
    expectedVisualSignals: ["boardwalk", "waterfall", "forest", "stream"],
    wrongPlaceWarnings: ["generic brook"],
  },
  {
    placeName: "Buttermilk Falls",
    town: "Ludlow",
    state: "VT",
    osmStyleTags: ["natural=waterfall", "tourism=attraction", "natural=swimming_hole"],
    searchQueries: ["Buttermilk Falls, Ludlow, Vermont", "Buttermilk Falls Ludlow VT"],
    expectedVisualSignals: ["waterfall", "swimming hole", "rocks", "forest"],
    wrongPlaceWarnings: ["Buttermilk Falls New York", "Ithaca"],
  },
  {
    placeName: "Bolton Potholes",
    town: "Bolton",
    state: "VT",
    osmStyleTags: ["natural=waterfall", "natural=swimming_hole", "tourism=attraction"],
    searchQueries: ["Bolton Potholes, Bolton, Vermont", "Bolton Potholes swimming hole VT"],
    expectedVisualSignals: ["pothole pools", "rocky stream", "waterfall", "swimming hole"],
    wrongPlaceWarnings: ["Bolton UK", "generic potholes"],
  },
  {
    placeName: "Quechee Gorge",
    town: "Quechee",
    state: "VT",
    osmStyleTags: ["natural=gorge", "tourism=attraction", "bridge=yes", "waterway=river"],
    searchQueries: ["Quechee Gorge, Quechee, Vermont", "Quechee Gorge bridge VT"],
    expectedVisualSignals: ["deep gorge", "bridge", "river", "cliffs", "trees"],
    wrongPlaceWarnings: ["generic canyon"],
  },
  {
    placeName: "Dorset Marble Quarry",
    town: "Dorset",
    state: "VT",
    osmStyleTags: ["historic=quarry", "tourism=attraction", "natural=water", "landuse=quarry"],
    searchQueries: ["Dorset Marble Quarry, Dorset, Vermont", "Dorset Quarry swimming VT"],
    expectedVisualSignals: ["marble quarry", "swimming hole", "stone walls", "clear water"],
    wrongPlaceWarnings: ["Dorset England", "generic quarry"],
  },
  {
    placeName: "Taconic Ramble State Park",
    town: "Hubbardton",
    state: "VT",
    osmStyleTags: ["leisure=park", "tourism=attraction", "natural=viewpoint", "historic=garden"],
    searchQueries: ["Taconic Ramble State Park, Hubbardton, Vermont", "Taconic Ramble Japanese garden VT"],
    expectedVisualSignals: ["viewpoint", "Japanese garden", "stone paths", "mountain view"],
    wrongPlaceWarnings: ["Taconic Parkway", "New York"],
  },
  {
    placeName: "Mount Philo Summit",
    town: "Charlotte",
    state: "VT",
    osmStyleTags: ["natural=peak", "tourism=viewpoint", "leisure=park"],
    searchQueries: ["Mount Philo Summit, Charlotte, Vermont", "Mount Philo view Lake Champlain"],
    expectedVisualSignals: ["summit view", "Lake Champlain", "Adirondacks", "overlook"],
    wrongPlaceWarnings: ["generic mountain"],
  },
  {
    placeName: "Taftsville Covered Bridge",
    town: "Woodstock",
    state: "VT",
    osmStyleTags: ["historic=bridge", "bridge=covered", "tourism=attraction"],
    searchQueries: ["Taftsville Covered Bridge, Woodstock, Vermont", "Taftsville Covered Bridge VT"],
    expectedVisualSignals: ["red covered bridge", "river", "wooden bridge"],
    wrongPlaceWarnings: ["generic covered bridge"],
  },
  {
    placeName: "Slaughterhouse Covered Bridge",
    town: "Northfield",
    state: "VT",
    osmStyleTags: ["historic=bridge", "bridge=covered", "tourism=attraction"],
    searchQueries: ["Slaughterhouse Covered Bridge, Northfield, Vermont", "Slaughterhouse Covered Bridge VT"],
    expectedVisualSignals: ["covered bridge", "red bridge", "river", "rural road"],
    wrongPlaceWarnings: ["literal slaughterhouse", "generic bridge"],
  },
  {
    placeName: "Emily's Bridge",
    town: "Stowe",
    state: "VT",
    osmStyleTags: ["historic=bridge", "bridge=covered", "tourism=attraction"],
    searchQueries: ["Emily's Bridge, Stowe, Vermont", "Gold Brook Covered Bridge Emily's Bridge VT"],
    expectedVisualSignals: ["covered bridge", "wooden bridge", "rural road"],
    wrongPlaceWarnings: ["people named Emily", "generic bridge"],
  },
  {
    placeName: "Dog Mountain",
    town: "St. Johnsbury",
    state: "VT",
    osmStyleTags: ["tourism=attraction", "amenity=arts_centre", "leisure=park"],
    searchQueries: ["Dog Mountain, St. Johnsbury, Vermont", "Dog Chapel Dog Mountain VT"],
    expectedVisualSignals: ["dog chapel", "fields", "art", "mountain view", "dogs"],
    wrongPlaceWarnings: ["generic dog park"],
  },
];

export const VERMONT_PHOTO_QA_SEEDS: PhotoQaSeedPlace[] = RAW_SEEDS.map((seed) => ({
  ...seed,
  id: slugId(seed.placeName, seed.town),
}));

export function buildApiPlaceQuery(seed: PhotoQaSeedPlace): string {
  return `${seed.town} ${seed.state}, ${seed.placeName}`;
}

export function getSeedById(id: string): PhotoQaSeedPlace | undefined {
  return VERMONT_PHOTO_QA_SEEDS.find((seed) => seed.id === id);
}

export function parseSeedIds(raw: string | undefined): string[] {
  if (!raw?.trim()) return VERMONT_PHOTO_QA_SEEDS.map((s) => s.id);
  return raw
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}
