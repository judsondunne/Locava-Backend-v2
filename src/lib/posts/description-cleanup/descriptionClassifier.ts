/**
 * Deterministic junk / generated post description classifier.
 * Conservative: high bar for REMOVE; ambiguous → REVIEW.
 */

export type DescriptionCleanupAction = "keep" | "remove" | "review";

export type ClassifyDescriptionInput = {
  /** The specific description/caption string being scored (one field value). */
  description: string;
  title: string;
  activities: string[];
  /** Human-readable location label (address, place name, etc.). */
  location: string;
  /** Media filenames or URL tails considered for overlap / filename signals. */
  mediaAssets: string[];
  /** classification.source or similar: user | imported | seeded | admin | unknown */
  source: string;
  importedFrom: string | null;
  postDoc: Record<string, unknown>;
};

export type ClassifyDescriptionResult = {
  action: DescriptionCleanupAction;
  confidence: number;
  reasons: string[];
  matchedSignals: string[];
};

const REMOVE_THRESHOLD = 0.85;
const REVIEW_LOW = 0.45;

const FILE_EXT_RE =
  /\.(jpe?g|png|webp|heic|mov|mp4|gif|tif|tiff|webm|m4v|avi)(\?|#|$|\s|"|'|,)/i;
const FILE_EXT_END_RE = /\.(jpe?g|png|webp|heic|mov|mp4|gif|tif|tiff|webm|m4v|avi)$/i;

const WIKI_META = [
  "wikimedia",
  "wiki commons",
  "wikicommons",
  "commons.wikimedia",
  "upload.wikimedia.org",
  "file:",
  "category:",
  "thumb",
  "own work",
  "creative commons",
  "cc-by",
  "cc by",
  "public domain",
  "source:",
  "author:",
  "license:",
  "gnu free documentation",
  "gfdl"
] as const;

const TEMPLATE_LABEL_RE =
  /\b(title|activities|activity|place|location|asset|filename|image|file)\s*:/gi;

const FIRST_PERSON_RE =
  /\b(i|we|my|our|me|us)\b.*\b(went|found|saw|loved|visited|hiked|tried|had|got|enjoyed|recommend|felt|thought|remember|miss|spent|wandering|wandered)\b/i;
const HUMAN_SENTENCE_RE = /[.!?].+[.!?]/;

function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[""'`]/g, "");
}

function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  for (const raw of norm(s).split(/[^a-z0-9]+/i)) {
    const t = raw.trim();
    if (t.length > 1) out.add(t);
  }
  return out;
}

function jaccardOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter += 1;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function filenameLikeScore(value: string): number {
  const t = value.trim();
  if (!t) return 0;
  const alnum = (t.match(/[a-z0-9]/gi) ?? []).length;
  const sep = (t.match(/[_-]/g) ?? []).length;
  const ratio = alnum > 0 ? sep / alnum : 0;
  let score = 0;
  if (ratio > 0.22) score += 0.28;
  if (/[a-f0-9]{12,}/i.test(t)) score += 0.22;
  if (/\b(img|dscn|dscf|gopr|mov|clip)\b/i.test(t)) score += 0.18;
  if (/^\s*[a-z0-9._-]+\.(jpe?g|png|webp|heic|mov|mp4)\s*$/i.test(t)) score += 0.45;
  return Math.min(0.55, score);
}

function templatedSectionsScore(value: string): number {
  const m = value.match(TEMPLATE_LABEL_RE);
  const labels = m ? m.length : 0;
  if (labels >= 3) return 0.55;
  if (labels >= 2) return 0.38;
  if (labels >= 1) return 0.18;
  const pipeDashBlocks = (value.match(/\s[-|]\s/g) ?? []).length;
  if (pipeDashBlocks >= 3 && value.length < 220) return 0.28;
  return 0;
}

function wikiMetaScore(lower: string): number {
  let s = 0;
  for (const k of WIKI_META) {
    if (lower.includes(k)) {
      s += 0.32;
      if (s >= 0.72) break;
    }
  }
  return Math.min(0.85, s);
}

function extensionSignal(lower: string, trimmed: string): number {
  if (FILE_EXT_END_RE.test(trimmed)) return 0.55;
  if (FILE_EXT_RE.test(lower)) return 0.42;
  return 0;
}

function dimensionSignal(lower: string): number {
  if (/\b\d{3,5}\s*x\s*\d{3,5}\b/i.test(lower)) return 0.22;
  if (/\b\d{3,5}px\b/i.test(lower)) return 0.18;
  return 0;
}

function urlFileSignal(lower: string): number {
  if (/https?:\/\/[^\s]+\.(jpe?g|png|webp|mp4)/i.test(lower)) return 0.45;
  return 0;
}

function importedSourceBoost(source: string): number {
  const s = source.toLowerCase();
  if (s === "imported" || s === "seeded") return 0.18;
  return 0;
}

function keepSignals(value: string): { score: number; signals: string[] } {
  const signals: string[] = [];
  let score = 0;
  if (FIRST_PERSON_RE.test(value)) {
    score += 0.55;
    signals.push("first_person_or_experience_language");
  }
  if (HUMAN_SENTENCE_RE.test(value) && value.length > 35) {
    score += 0.22;
    signals.push("multi_sentence_punctuation");
  }
  const letters = (value.match(/[a-z]/gi) ?? []).length;
  const nonLetters = value.length - letters;
  if (value.length > 55 && letters / Math.max(1, value.length) > 0.55 && nonLetters < value.length * 0.12) {
    score += 0.12;
    signals.push("long_natural_letter_ratio");
  }
  return { score: Math.min(0.85, score), signals };
}

function metadataCompositionOverlap(
  descNorm: string,
  title: string,
  activities: string[],
  location: string,
  mediaAssets: string[],
): number {
  const dTokens = tokenize(descNorm);
  if (dTokens.size === 0) return 0;
  const metaParts = [title, ...activities, location, ...mediaAssets].filter(Boolean);
  const metaText = metaParts.join(" ");
  const mTokens = tokenize(metaText);
  const jac = jaccardOverlap(dTokens, mTokens);
  if (jac > 0.62 && descNorm.length < 120) return 0.28;
  if (jac > 0.45 && descNorm.length < 90) return 0.18;
  return 0;
}

/**
 * `confidence` is the model's estimated probability that this string is generated junk
 * (used against REMOVE_THRESHOLD / REVIEW_LOW).
 */
export function classifyDescription(input: ClassifyDescriptionInput): ClassifyDescriptionResult {
  void input.postDoc;
  const trimmed = (input.description ?? "").trim();
  const reasons: string[] = [];
  const matchedSignals: string[] = [];

  if (!trimmed) {
    return {
      action: "keep",
      confidence: 0,
      reasons: ["empty_description_no_op"],
      matchedSignals: [],
    };
  }

  const lower = trimmed.toLowerCase();
  const source = (input.source || "unknown").trim().toLowerCase();
  const importedHint = (input.importedFrom ?? "").toLowerCase();

  let junk = 0;
  const pushJunk = (amount: number, signal: string, reason: string) => {
    junk += amount;
    matchedSignals.push(signal);
    reasons.push(reason);
  };

  const ext = extensionSignal(lower, trimmed);
  if (ext > 0) pushJunk(ext, "file_extension", "Description contains image/video filename extension pattern.");

  const wiki = wikiMetaScore(lower);
  if (wiki > 0) pushJunk(wiki, "wikimedia_or_commons_metadata", "Description contains Wikimedia/Commons-style metadata tokens.");

  const tmpl = templatedSectionsScore(trimmed);
  if (tmpl > 0) pushJunk(tmpl, "templated_labels_or_blocks", "Description looks like auto-generated labeled sections or delimiter-stacked metadata.");

  const fn = filenameLikeScore(trimmed);
  if (fn > 0) pushJunk(fn, "filename_like", "Description resembles a camera/upload filename or hash-heavy asset name.");

  const dim = dimensionSignal(lower);
  if (dim > 0) pushJunk(dim, "dimension_tokens", "Description contains resolution/dimension tokens common in asset metadata.");

  const url = urlFileSignal(lower);
  if (url > 0) pushJunk(url, "direct_media_url", "Description embeds a direct media URL.");

  const comp = metadataCompositionOverlap(trimmed, input.title, input.activities, input.location, input.mediaAssets);
  if (comp > 0) pushJunk(comp, "metadata_token_overlap", "Description tokens overlap heavily with title/activities/location/media hints.");

  const importBoost = importedSourceBoost(source);
  if (importBoost > 0) {
    junk += importBoost;
    matchedSignals.push("imported_or_seeded_source_context");
    reasons.push("Post classification source is imported/seeded (extra caution weight).");
  }

  if (importedHint && (importedHint.includes("wiki") || importedHint.includes("commons"))) {
    junk += 0.12;
    matchedSignals.push("imported_from_wiki_hint");
    reasons.push("importedFrom hints at Wikimedia-derived content.");
  }

  if ((source === "imported" || source === "seeded") && ext >= 0.38) {
    junk += 0.22;
    matchedSignals.push("imported_source_plus_media_filename_pattern");
    reasons.push("Imported/seeded post with filename-like description.");
  }

  const dN = norm(trimmed);
  const tN = norm(input.title);
  if (dN.length > 2 && tN.length > 2 && dN === tN) {
    matchedSignals.push("description_equals_title");
    reasons.push("Description exactly matches title.");
    if (source === "imported" || source === "seeded") {
      junk += 0.35;
    } else {
      junk = Math.max(junk, 0.48);
    }
  }

  const keep = keepSignals(trimmed);
  for (const s of keep.signals) matchedSignals.push(s);
  if (keep.score > 0) {
    reasons.push("Human-language keep heuristics matched.");
  }

  junk = junk * (1 - Math.min(0.82, keep.score));

  junk = Math.min(0.98, Math.max(0, junk));

  if (trimmed.length <= 44 && keep.score < 0.22 && junk >= 0.1 && junk < REMOVE_THRESHOLD) {
    junk = Math.max(junk, REVIEW_LOW + 0.02);
    matchedSignals.push("short_ambiguous");
    reasons.push("Short description without strong human cues — conservative manual review.");
  }

  let action: DescriptionCleanupAction;
  if (junk >= REMOVE_THRESHOLD && keep.score < 0.42) {
    action = "remove";
  } else if (junk >= REVIEW_LOW) {
    action = "review";
  } else {
    action = "keep";
  }

  if (action === "remove" && keep.score >= 0.42) {
    action = "review";
    reasons.push("Downgraded remove→review due to strong keep signals.");
  }

  if (dN === tN && dN.length > 2 && source === "user" && action === "remove" && ext < 0.25 && wiki < 0.2) {
    action = "review";
    reasons.push("Downgraded remove→review: description equals title on user-sourced post without strong file/wiki signals.");
  }

  return {
    action,
    confidence: Number(junk.toFixed(4)),
    reasons,
    matchedSignals,
  };
}
