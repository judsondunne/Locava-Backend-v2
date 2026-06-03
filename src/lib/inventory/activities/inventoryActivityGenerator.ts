import type { OffroadRouteFields } from "../inventoryLocavaTypes.js";
import {
  dedupeActivities,
  expandActivitySearchAliases,
  normalizeActivity,
  pickPrimaryActivity,
  rankActivities,
  type LocavaActivity,
} from "./locavaActivities.js";

export type ActivityReasonSource =
  | "tag"
  | "name"
  | "parent"
  | "child"
  | "route"
  | "nearby"
  | "source_dataset"
  | "access"
  | "geometry";

export type ActivityReason = {
  activity: string;
  weight: number;
  reason: string;
  source: ActivityReasonSource;
};

export type LocavaActivityResult = {
  primaryActivity: string | null;
  activities: string[];
  activityWeights: Record<string, number>;
  activityReasons: ActivityReason[];
  searchableAliases: string[];
  activityConfidence: "high" | "medium" | "low";
  activityWarnings: string[];
};

export type ActivityGenerationContext = {
  itemKind: "spot" | "route";
  tags: Record<string, string>;
  category?: string | null;
  name?: string | null;
  rawName?: string | null;
  parentPlaceName?: string | null;
  parentCategory?: string | null;
  parentContext?: { parentName?: string; parentCategory?: string; relation?: string } | null;
  childHighlights?: Array<{ type: string; name?: string; displayName?: string }>;
  childFeatureTypes?: string[];
  source?: string;
  sourceDatasetName?: string;
  routeKind?: string;
  routeActivity?: string | null;
  offroad?: OffroadRouteFields;
  hasParking?: boolean;
  hasTrailhead?: boolean;
  distanceMiles?: number;
};

function tag(tags: Record<string, string>, key: string): string | undefined {
  const v = tags[key];
  return v?.trim() ? v.trim().toLowerCase() : undefined;
}

function addWeight(
  weights: Record<string, number>,
  reasons: ActivityReason[],
  activity: string,
  weight: number,
  reason: string,
  source: ActivityReasonSource
): void {
  const norm = normalizeActivity(activity);
  if (!norm || weight <= 0) return;
  weights[norm] = (weights[norm] ?? 0) + weight;
  reasons.push({ activity: norm, weight, reason, source });
}

function nameLower(ctx: ActivityGenerationContext): string {
  return (ctx.rawName ?? ctx.name ?? "").trim().toLowerCase();
}

function applyNameSignals(ctx: ActivityGenerationContext, weights: Record<string, number>, reasons: ActivityReason[]): void {
  const n = nameLower(ctx);
  if (!n || n.length < 3) return;

  const rules: Array<{ re: RegExp; activities: Array<[string, number]>; reason: string }> = [
    { re: /\b(view|vista|overlook|ledge|lookout)\b/, activities: [["view", 8], ["sunset", 5], ["overlook", 6]], reason: "name_view_signal" },
    { re: /\b(falls|cascade|waterfall)\b/, activities: [["waterfall", 10], ["hiking", 4]], reason: "name_waterfall_signal" },
    { re: /\b(pond|lake)\b/, activities: [["pond", 6], ["lake", 6], ["water", 5], ["fishing", 4]], reason: "name_water_body" },
    { re: /\b(river|brook|creek|stream)\b/, activities: [["river", 7], ["water", 5], ["fishing", 3], ["kayaking", 3]], reason: "name_river_signal" },
    { re: /\bbeach\b/, activities: [["beach", 9], ["swimming", 6]], reason: "name_beach_signal" },
    { re: /\b(swim|bathing)\b/, activities: [["swimming", 8], ["swimminghole", 6]], reason: "name_swim_signal" },
    { re: /\b(trail|loop|path)\b/, activities: [["hiking", 6], ["walking", 5], ["trail", 6]], reason: "name_trail_signal" },
    { re: /\b(farm|orchard)\b/, activities: [["farm", 7], ["applepicking", 5], ["orchard", 6]], reason: "name_farm_signal" },
    { re: /\b(brewery|brewing)\b/, activities: [["brewery", 9], ["bar", 5]], reason: "name_brewery_signal" },
    { re: /\b(cafe|coffee)\b/, activities: [["cafe", 8], ["coffee", 7]], reason: "name_cafe_signal" },
    { re: /\b(ice cream|creamery|gelato)\b/, activities: [["icecream", 9], ["things", 3]], reason: "name_icecream_signal" },
    { re: /\b(museum|historic|fort|memorial)\b/, activities: [["museum", 7], ["historical", 7], ["monuments", 5]], reason: "name_historic_signal" },
    { re: /\bquarry\b/, activities: [["quarries", 9], ["rockformations", 6], ["weird", 4]], reason: "name_quarry_signal" },
    { re: /\bcovered\s+bridge\b/, activities: [["coveredbridge", 10], ["bridge", 8], ["historical", 5]], reason: "name_covered_bridge_signal" },
    { re: /\bbridge\b/, activities: [["bridge", 8], ["view", 3], ["historical", 3]], reason: "name_bridge_signal" },
    { re: /\btower\b/, activities: [["tower", 8], ["view", 5], ["sunset", 4]], reason: "name_tower_signal" },
    { re: /\b(road|track)\b/, activities: [["offroading", 3], ["unmaintainedroad", 2]], reason: "name_road_signal" },
    { re: /\b(ropeswing|rope swing)\b/, activities: [["ropeswing", 9], ["swimming", 4]], reason: "name_ropeswing_signal" },
  ];

  for (const rule of rules) {
    if (rule.re.test(n)) {
      for (const [act, w] of rule.activities) addWeight(weights, reasons, act, w, rule.reason, "name");
    }
  }
}

function applyTagSignals(ctx: ActivityGenerationContext, weights: Record<string, number>, reasons: ActivityReason[]): void {
  const t = ctx.tags;
  const amenity = tag(t, "amenity");
  const tourism = tag(t, "tourism");
  const natural = tag(t, "natural");
  const leisure = tag(t, "leisure");
  const historic = tag(t, "historic");
  const highway = tag(t, "highway");
  const route = tag(t, "route");
  const waterway = tag(t, "waterway");
  const landuse = tag(t, "landuse");
  const boundary = tag(t, "boundary");
  const sport = tag(t, "sport");
  const cuisine = tag(t, "cuisine");
  const craft = tag(t, "craft");
  const shop = tag(t, "shop");
  const water = tag(t, "water");
  const access = tag(t, "access");

  if (amenity === "cafe") {
    addWeight(weights, reasons, "cafe", 10, "amenity=cafe", "tag");
    addWeight(weights, reasons, "coffee", 8, "amenity=cafe", "tag");
  }
  if (amenity === "ice_cream") {
    addWeight(weights, reasons, "icecream", 10, "amenity=ice_cream", "tag");
    addWeight(weights, reasons, "things", 3, "amenity=ice_cream", "tag");
  }
  if (amenity === "restaurant") {
    addWeight(weights, reasons, "restaurants", 10, "amenity=restaurant", "tag");
    if (cuisine === "burger") addWeight(weights, reasons, "burger", 8, "cuisine=burger", "tag");
    if (cuisine === "pizza") addWeight(weights, reasons, "pizza", 8, "cuisine=pizza", "tag");
    if (cuisine === "chinese") addWeight(weights, reasons, "chinesefood", 8, "cuisine=chinese", "tag");
  }
  if (amenity === "fast_food") {
    addWeight(weights, reasons, "restaurants", 7, "amenity=fast_food", "tag");
    if (cuisine === "burger") addWeight(weights, reasons, "burger", 8, "cuisine=burger", "tag");
    if (cuisine === "pizza") addWeight(weights, reasons, "pizza", 8, "cuisine=pizza", "tag");
    if (cuisine === "ice_cream") addWeight(weights, reasons, "icecream", 9, "cuisine=ice_cream", "tag");
  }
  if (amenity === "pub" || amenity === "bar") {
    addWeight(weights, reasons, "bar", 9, `amenity=${amenity}`, "tag");
  }
  if (craft === "brewery" || /brewery|brewing/i.test(nameLower(ctx))) {
    addWeight(weights, reasons, "brewery", 10, "craft=brewery", "tag");
    addWeight(weights, reasons, "bar", 5, "craft=brewery", "tag");
  }
  if (amenity === "marketplace") {
    addWeight(weights, reasons, "farmersmarket", 9, "amenity=marketplace", "tag");
    addWeight(weights, reasons, "market", 7, "amenity=marketplace", "tag");
    addWeight(weights, reasons, "shopping", 5, "amenity=marketplace", "tag");
  }
  if (shop === "farm" || shop === "greengrocer") {
    addWeight(weights, reasons, "farmstand", 8, `shop=${shop}`, "tag");
    addWeight(weights, reasons, "farm", 6, `shop=${shop}`, "tag");
    addWeight(weights, reasons, "market", 4, `shop=${shop}`, "tag");
  }
  if (/maple|sugar/i.test(nameLower(ctx)) || tag(t, "produce") === "maple_syrup") {
    addWeight(weights, reasons, "maplesugar", 9, "maple/sugarhouse", "tag");
    addWeight(weights, reasons, "farm", 5, "maple/sugarhouse", "tag");
  }

  if (leisure === "park") {
    addWeight(weights, reasons, "park", 9, "leisure=park", "tag");
    addWeight(weights, reasons, "walking", 5, "leisure=park", "tag");
    if (tag(t, "picnic") === "yes" || tourism === "picnic_site") addWeight(weights, reasons, "picnic", 6, "picnic signal", "tag");
  }
  if (leisure === "nature_reserve" || boundary === "protected_area") {
    addWeight(weights, reasons, "nature", 8, "protected/nature_reserve", "tag");
    addWeight(weights, reasons, "conservation", 8, "protected/nature_reserve", "tag");
    addWeight(weights, reasons, "hiking", 5, "protected/nature_reserve", "tag");
    if (natural === "wood" || landuse === "forest") addWeight(weights, reasons, "forest", 6, "wooded reserve", "tag");
  }
  if (natural === "wood" || landuse === "forest") {
    addWeight(weights, reasons, "forest", 9, "forest/wood", "tag");
    addWeight(weights, reasons, "hiking", 5, "forest/wood", "tag");
    addWeight(weights, reasons, "walking", 4, "forest/wood", "tag");
    addWeight(weights, reasons, "nature", 5, "forest/wood", "tag");
  }
  if (natural === "peak") {
    addWeight(weights, reasons, "mountain", 9, "natural=peak", "tag");
    addWeight(weights, reasons, "peak", 9, "natural=peak", "tag");
    addWeight(weights, reasons, "hiking", 6, "natural=peak", "tag");
    addWeight(weights, reasons, "view", 5, "natural=peak", "tag");
    addWeight(weights, reasons, "sunset", 4, "natural=peak", "tag");
  }
  if (natural === "hill") {
    addWeight(weights, reasons, "hill", 9, "natural=hill", "tag");
    addWeight(weights, reasons, "hiking", 5, "natural=hill", "tag");
    addWeight(weights, reasons, "view", 4, "natural=hill", "tag");
  }
  if (tourism === "viewpoint") {
    addWeight(weights, reasons, "view", 10, "tourism=viewpoint", "tag");
    addWeight(weights, reasons, "overlook", 7, "tourism=viewpoint", "tag");
    addWeight(weights, reasons, "sunset", 5, "tourism=viewpoint", "tag");
    addWeight(weights, reasons, "hiking", 3, "tourism=viewpoint", "tag");
  }
  if (natural === "waterfall" || waterway === "waterfall") {
    addWeight(weights, reasons, "waterfall", 10, "waterfall tag", "tag");
    addWeight(weights, reasons, "hiking", 5, "waterfall tag", "tag");
    addWeight(weights, reasons, "view", 4, "waterfall tag", "tag");
  }
  if (natural === "beach") {
    addWeight(weights, reasons, "beach", 10, "natural=beach", "tag");
    addWeight(weights, reasons, "swimming", 6, "natural=beach", "tag");
    addWeight(weights, reasons, "water", 4, "natural=beach", "tag");
  }
  if (leisure === "swimming_area" || tag(t, "swimming") === "yes" || tag(t, "swimming") === "designated") {
    addWeight(weights, reasons, "swimming", 9, "swimming access", "tag");
    addWeight(weights, reasons, "swimminghole", 6, "swimming access", "tag");
    addWeight(weights, reasons, "beach", 4, "swimming access", "tag");
    addWeight(weights, reasons, "water", 4, "swimming access", "tag");
  }
  if (natural === "water") {
    if (water === "pond") {
      addWeight(weights, reasons, "pond", 9, "natural=water pond", "tag");
      addWeight(weights, reasons, "water", 6, "natural=water pond", "tag");
      addWeight(weights, reasons, "fishing", 4, "natural=water pond", "tag");
      if (tag(t, "access") === "yes" || tag(t, "access") === "permissive") {
        addWeight(weights, reasons, "fishing", 3, "pond public access", "access");
        addWeight(weights, reasons, "kayaking", 3, "pond public access", "access");
      }
    } else if (water === "lake") {
      addWeight(weights, reasons, "lake", 9, "natural=water lake", "tag");
      addWeight(weights, reasons, "fishing", 4, "natural=water lake", "tag");
      addWeight(weights, reasons, "kayaking", 4, "natural=water lake", "tag");
      if (access !== "private" && access !== "no") addWeight(weights, reasons, "swimming", 3, "lake access", "access");
    } else {
      addWeight(weights, reasons, "water", 6, "natural=water", "tag");
    }
  }
  if (waterway === "river" || waterway === "stream") {
    const w = waterway === "river" ? 8 : 4;
    addWeight(weights, reasons, "river", w, `waterway=${waterway}`, "tag");
    addWeight(weights, reasons, "water", w - 1, `waterway=${waterway}`, "tag");
    addWeight(weights, reasons, "fishing", 3, `waterway=${waterway}`, "tag");
    addWeight(weights, reasons, "kayaking", 3, `waterway=${waterway}`, "tag");
  }
  if (waterway === "dam" || tag(t, "man_made") === "dam") {
    addWeight(weights, reasons, "dam", 8, "dam", "tag");
    addWeight(weights, reasons, "water", 5, "dam", "tag");
    addWeight(weights, reasons, "view", 3, "dam", "tag");
  }
  if (natural === "wetland" || natural === "marsh" || natural === "bog") {
    addWeight(weights, reasons, "nature", 8, `natural=${natural}`, "tag");
    addWeight(weights, reasons, "conservation", 7, `natural=${natural}`, "tag");
    addWeight(weights, reasons, "animals", 4, `natural=${natural}`, "tag");
    addWeight(weights, reasons, "birdwatching", 5, `natural=${natural}`, "tag");
    addWeight(weights, reasons, "walking", 3, `natural=${natural}`, "tag");
  }

  if (route === "hiking" || route === "foot" || highway === "path" || highway === "footway" || ctx.category === "path" || ctx.category === "footway") {
    addWeight(weights, reasons, "hiking", 8, "trail/hiking signal", "tag");
    addWeight(weights, reasons, "walking", 6, "trail/hiking signal", "tag");
    addWeight(weights, reasons, "trail", 7, "trail/hiking signal", "tag");
  }
  if (highway === "cycleway" || route === "bicycle" || tag(t, "bicycle") === "designated" || tag(t, "mtb") === "yes") {
    addWeight(weights, reasons, "biking", 8, "cycle/mtb signal", "tag");
    if (tag(t, "mtb") === "yes") addWeight(weights, reasons, "mtb", 9, "mtb=yes", "tag");
  }
  if (highway === "bridleway" || tag(t, "horse") === "designated" || tag(t, "horse") === "yes") {
    addWeight(weights, reasons, "riding", 8, "horse/bridleway", "tag");
  }
  if (/ski|nordic|snowshoe|piste/i.test(JSON.stringify(t))) {
    if (/nordic|piste:type=nordic/i.test(JSON.stringify(t))) addWeight(weights, reasons, "skiingnordic", 8, "nordic ski", "tag");
    if (/snowshoe/i.test(JSON.stringify(t))) addWeight(weights, reasons, "snowshoeing", 8, "snowshoe", "tag");
    addWeight(weights, reasons, "skiing", 6, "ski signal", "tag");
  }
  if (tag(t, "snowmobile") === "yes" || tag(t, "snowmobile") === "designated") {
    addWeight(weights, reasons, "snowmobiling", 9, "snowmobile", "tag");
  }

  if (tourism === "museum") {
    addWeight(weights, reasons, "museum", 10, "tourism=museum", "tag");
    if (historic) addWeight(weights, reasons, "historical", 6, "museum+historic", "tag");
  }
  if (historic || tag(t, "heritage")) {
    addWeight(weights, reasons, "historical", 8, "historic/heritage", "tag");
    if (historic === "ruins" || tag(t, "ruins") === "yes") {
      addWeight(weights, reasons, "ruins", 8, "ruins", "tag");
      addWeight(weights, reasons, "abandoned", 5, "ruins", "tag");
    }
    if (historic === "castle") addWeight(weights, reasons, "castle", 9, "historic=castle", "tag");
  }
  if (tourism === "artwork") {
    const artworkType = tag(t, "artwork_type");
    if (artworkType === "mural") addWeight(weights, reasons, "mural", 9, "artwork_type=mural", "tag");
    else addWeight(weights, reasons, "sculptures", 8, "tourism=artwork", "tag");
    addWeight(weights, reasons, "art", 6, "tourism=artwork", "tag");
  }
  if (historic === "monument" || tourism === "monument") {
    addWeight(weights, reasons, "monuments", 9, "monument", "tag");
    addWeight(weights, reasons, "historical", 5, "monument", "tag");
  }
  if (highway === "bridleway" || ctx.category === "bridge" || tag(t, "man_made") === "bridge") {
    addWeight(weights, reasons, "bridge", 8, "bridge tag", "tag");
    if (/covered/i.test(nameLower(ctx)) || tag(t, "bridge") === "covered") {
      addWeight(weights, reasons, "coveredbridge", 9, "covered bridge", "tag");
      addWeight(weights, reasons, "historical", 5, "covered bridge", "tag");
    }
    if (historic) addWeight(weights, reasons, "historical", 5, "historic bridge", "tag");
    addWeight(weights, reasons, "view", 3, "bridge scenic", "tag");
  }
  if (tag(t, "man_made") === "lighthouse" || tourism === "lighthouse") {
    addWeight(weights, reasons, "lighthouse", 10, "lighthouse", "tag");
    addWeight(weights, reasons, "ocean", 4, "lighthouse", "tag");
    addWeight(weights, reasons, "view", 4, "lighthouse", "tag");
  }
  if (leisure === "marina" || tag(t, "man_made") === "pier" || highway === "pier") {
    addWeight(weights, reasons, "pier", 8, "pier/marina", "tag");
    addWeight(weights, reasons, "sailing", 5, "pier/marina", "tag");
    addWeight(weights, reasons, "boating", 5, "pier/marina", "tag");
    addWeight(weights, reasons, "water", 4, "pier/marina", "tag");
  }
  if (tag(t, "canoe") === "yes" || tag(t, "boat") === "yes" || amenity === "boat_rental") {
    addWeight(weights, reasons, "kayaking", 6, "boat/canoe access", "tag");
    addWeight(weights, reasons, "canoeing", 6, "boat/canoe access", "tag");
    addWeight(weights, reasons, "wateraccess", 7, "boat/canoe access", "tag");
  }

  if (leisure === "golf_course") addWeight(weights, reasons, "golfing", 10, "golf", "tag");
  if (leisure === "pitch" && sport === "soccer") addWeight(weights, reasons, "soccer", 9, "soccer pitch", "tag");
  if (sport === "basketball") addWeight(weights, reasons, "basketball", 9, "basketball", "tag");
  if (sport === "hockey") addWeight(weights, reasons, "hockey", 9, "hockey", "tag");
  if (sport === "climbing" || natural === "cliff") {
    addWeight(weights, reasons, "climbing", 9, "climbing/cliff", "tag");
    addWeight(weights, reasons, "rockformations", 5, "climbing/cliff", "tag");
  }
  if (leisure === "playground") {
    addWeight(weights, reasons, "playground", 9, "playground", "tag");
    addWeight(weights, reasons, "familyfriendly", 6, "playground", "tag");
  }
  if (leisure === "skatepark") addWeight(weights, reasons, "skateboarding", 9, "skatepark", "tag");
  if (amenity === "cinema") addWeight(weights, reasons, "movies", 9, "cinema", "tag");
  if (amenity === "theatre" || amenity === "theater") addWeight(weights, reasons, "theater", 9, "theater", "tag");
  if (amenity === "bowling_alley") addWeight(weights, reasons, "bowling", 9, "bowling", "tag");
  if (tag(t, "shooting") === "range" || amenity === "hunting_stand") addWeight(weights, reasons, "gunrange", 8, "gun range", "tag");

  if (landuse === "orchard" || /apple/i.test(nameLower(ctx))) {
    addWeight(weights, reasons, "applepicking", 7, "orchard/apple", "tag");
    addWeight(weights, reasons, "farm", 5, "orchard/apple", "tag");
    addWeight(weights, reasons, "orchard", 7, "orchard/apple", "tag");
  }
  if (leisure === "garden") addWeight(weights, reasons, "garden", 9, "garden", "tag");
  if (tourism === "zoo" || tag(t, "attraction") === "animal") {
    addWeight(weights, reasons, "animals", 9, "zoo/wildlife", "tag");
    addWeight(weights, reasons, "wildlife", 8, "zoo/wildlife", "tag");
  }
  if (natural === "cave_entrance" || tag(t, "place") === "cave" || ctx.category === "cave") {
    addWeight(weights, reasons, "cave", 9, "cave", "tag");
  }
  if (natural === "bare_rock" || landuse === "quarry" || ctx.category === "quarry") {
    addWeight(weights, reasons, "quarries", 8, "quarry/rock", "tag");
    addWeight(weights, reasons, "rockformations", 6, "quarry/rock", "tag");
  }
  if (tag(t, "disused") === "yes" || tag(t, "abandoned") === "yes") {
    addWeight(weights, reasons, "abandoned", 7, "abandoned/disused", "tag");
    addWeight(weights, reasons, "ruins", 4, "abandoned/disused", "tag");
  }
  if (tourism === "attraction") addWeight(weights, reasons, "things", 6, "tourism=attraction", "tag");
  if (tourism === "theme_park" || leisure === "amusement_arcade") {
    addWeight(weights, reasons, "amusementpark", 9, "amusement park", "tag");
  }

  const catNorm = normalizeActivity(ctx.category ?? "");
  if (catNorm) addWeight(weights, reasons, catNorm, 5, `category=${ctx.category}`, "tag");
}

function applyParentChildSignals(ctx: ActivityGenerationContext, weights: Record<string, number>, reasons: ActivityReason[]): void {
  const parentCat = ctx.parentCategory ?? ctx.parentContext?.parentCategory ?? "";
  const parentName = ctx.parentPlaceName ?? ctx.parentContext?.parentName;

  if (parentCat) {
    const pc = parentCat.toLowerCase();
    if (/forest|wood|nature_reserve|protected/.test(pc)) {
      addWeight(weights, reasons, "forest", 4, "parent forest/nature", "parent");
      addWeight(weights, reasons, "nature", 4, "parent forest/nature", "parent");
      addWeight(weights, reasons, "hiking", 3, "parent forest/nature", "parent");
      addWeight(weights, reasons, "conservation", 3, "parent forest/nature", "parent");
    }
    if (/park|recreation/.test(pc)) {
      addWeight(weights, reasons, "park", 4, "parent park", "parent");
      addWeight(weights, reasons, "walking", 3, "parent park", "parent");
      addWeight(weights, reasons, "picnic", 2, "parent park", "parent");
      addWeight(weights, reasons, "familyfriendly", 2, "parent park", "parent");
    }
    if (/national_park|historic/.test(pc)) {
      addWeight(weights, reasons, "nationalpark", 4, "parent national/historic park", "parent");
      addWeight(weights, reasons, "historical", 4, "parent national/historic park", "parent");
      addWeight(weights, reasons, "museum", 3, "parent national/historic park", "parent");
    }
    if (/water|lake|pond|river|beach/.test(pc)) {
      addWeight(weights, reasons, "water", 4, "parent water context", "parent");
      if (/beach|swim/.test(pc)) {
        addWeight(weights, reasons, "beach", 4, "parent beach", "parent");
        addWeight(weights, reasons, "swimming", 4, "parent beach", "parent");
      }
    }
    if (/peak|mountain|hill/.test(pc)) {
      addWeight(weights, reasons, "mountain", 4, "parent mountain", "parent");
      addWeight(weights, reasons, "view", 3, "parent mountain", "parent");
      addWeight(weights, reasons, "hiking", 3, "parent mountain", "parent");
    }
  }

  if (parentName) {
    addWeight(weights, reasons, "things", 1, `parent=${parentName}`, "parent");
  }

  for (const ch of ctx.childHighlights ?? []) {
    const ct = ch.type.toLowerCase();
    if (ct.includes("view")) {
      addWeight(weights, reasons, "view", 5, "child viewpoint", "child");
      addWeight(weights, reasons, "sunset", 3, "child viewpoint", "child");
    }
    if (ct.includes("waterfall")) {
      addWeight(weights, reasons, "waterfall", 5, "child waterfall", "child");
      addWeight(weights, reasons, "hiking", 3, "child waterfall", "child");
    }
    if (/beach|swim/.test(ct)) {
      addWeight(weights, reasons, "beach", 4, "child beach/swim", "child");
      addWeight(weights, reasons, "swimming", 4, "child beach/swim", "child");
    }
    if (/trail|route|hiking/.test(ct)) {
      addWeight(weights, reasons, "hiking", 4, "child trail", "child");
      addWeight(weights, reasons, "trail", 3, "child trail", "child");
    }
    if (/historic|museum|monument/.test(ct)) {
      addWeight(weights, reasons, "historical", 4, "child historic", "child");
    }
  }

  for (const ct of ctx.childFeatureTypes ?? []) {
    const t = ct.toLowerCase();
    if (t.includes("view")) addWeight(weights, reasons, "view", 3, "childFeatureTypes view", "child");
    if (t.includes("waterfall")) addWeight(weights, reasons, "waterfall", 3, "childFeatureTypes waterfall", "child");
    if (/trail|route/.test(t)) addWeight(weights, reasons, "hiking", 3, "childFeatureTypes trail", "child");
  }
}

function applyRouteSourceSignals(ctx: ActivityGenerationContext, weights: Record<string, number>, reasons: ActivityReason[]): void {
  if (ctx.itemKind !== "route") return;

  const act = ctx.routeActivity ?? "hiking";
  if (act === "offroading" || ctx.offroad) {
    addWeight(weights, reasons, "offroading", 12, "offroad route", "route");
    addWeight(weights, reasons, "unmaintainedroad", 10, "offroad route", "route");
    const cat = ctx.offroad?.offroadCategory;
    if (cat === "class4_road") addWeight(weights, reasons, "class4road", 10, "class4 road", "source_dataset");
    if (cat === "legal_trail") addWeight(weights, reasons, "legaltrail", 10, "legal trail", "source_dataset");
    if (cat === "atv_trail" || ctx.offroad?.vehicleSignals?.atv) addWeight(weights, reasons, "atv", 8, "atv trail", "source_dataset");
    if (ctx.source === "vtrans_public_highway_system") {
      addWeight(weights, reasons, "class4road", 8, "vtrans source", "source_dataset");
    }
  } else if (act === "bicycle" || act === "biking") {
    addWeight(weights, reasons, "biking", 9, "bicycle route", "route");
    addWeight(weights, reasons, "mtb", 5, "bicycle route", "route");
  } else {
    addWeight(weights, reasons, "hiking", 9, "hiking route", "route");
    addWeight(weights, reasons, "walking", 6, "hiking route", "route");
    addWeight(weights, reasons, "trail", 7, "hiking route", "route");
  }

  if (ctx.hasTrailhead) addWeight(weights, reasons, "trailhead", 4, "has trailhead", "nearby");
  if (ctx.hasParking && ctx.itemKind === "route") addWeight(weights, reasons, "wateraccess", 1, "parking nearby", "nearby");
}

function applyNearbySignals(ctx: ActivityGenerationContext, weights: Record<string, number>, reasons: ActivityReason[]): void {
  if (ctx.hasTrailhead && ctx.itemKind === "spot") {
    addWeight(weights, reasons, "trailhead", 6, "trailhead spot", "nearby");
    addWeight(weights, reasons, "hiking", 3, "trailhead spot", "nearby");
  }
}

function confidenceFromWeights(weights: Record<string, number>, warnings: string[]): "high" | "medium" | "low" {
  const top = Math.max(0, ...Object.values(weights));
  if (top >= 8 && warnings.length === 0) return "high";
  if (top >= 5) return "medium";
  return "low";
}

export function generateLocavaActivities(item: ActivityGenerationContext, _context?: ActivityGenerationContext): LocavaActivityResult {
  const weights: Record<string, number> = {};
  const reasons: ActivityReason[] = [];
  const warnings: string[] = [];

  applyTagSignals(item, weights, reasons);
  applyNameSignals(item, weights, reasons);
  applyParentChildSignals(item, weights, reasons);
  applyRouteSourceSignals(item, weights, reasons);
  applyNearbySignals(item, weights, reasons);

  if (item.routeActivity && item.itemKind === "route") {
    const ra = normalizeActivity(item.routeActivity);
    if (ra) addWeight(weights, reasons, ra, 6, `routeActivity=${item.routeActivity}`, "route");
  }

  const activities = rankActivities(weights);
  const primaryActivity = pickPrimaryActivity(weights, { routeActivity: item.routeActivity ?? undefined, category: item.category ?? undefined });

  if (!activities.length) {
    warnings.push("no_strong_activity_signals");
  }
  if (activities.length === 1 && (activities[0] === "things" || activities[0] === "random")) {
    warnings.push("weak_generic_activity");
  }

  const canonical = dedupeActivities(activities);
  const searchableAliases = [
    ...expandActivitySearchAliases(canonical),
    ...(item.parentPlaceName ? [item.parentPlaceName.toLowerCase()] : []),
    ...(item.category ? [item.category.replace(/_/g, " ")] : []),
    ...(item.offroad?.legalDisplayLabel ? [item.offroad.legalDisplayLabel.toLowerCase()] : []),
    ...((item.childHighlights ?? []).map((c) => c.displayName ?? c.name ?? c.type).filter(Boolean) as string[]).map((s) => s.toLowerCase()),
  ];

  return {
    primaryActivity,
    activities: canonical,
    activityWeights: weights,
    activityReasons: reasons,
    searchableAliases: [...new Set(searchableAliases.filter(Boolean))],
    activityConfidence: confidenceFromWeights(weights, warnings),
    activityWarnings: warnings,
  };
}
