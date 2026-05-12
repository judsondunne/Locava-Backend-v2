const NOISE_WORDS = [
  "photo",
  "photos",
  "photograph",
  "picture",
  "image",
  "img",
  "panorama",
  "pano",
  "hdr",
  "scan",
  "screenshot",
  "cropped",
  "upload",
  "wikimedia",
  "commons",
  "untitled",
  "dsc",
  "jpeg",
  "jpg",
  "png",
  "gif",
  "camera",
  "drone",
];

const NOISE_RE = new RegExp(`\\b(?:${NOISE_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi");

export function stripCommonsFilenameNoise(raw: string): string {
  let s = String(raw || "").trim();
  if (/^file:/i.test(s)) s = s.replace(/^file:/i, "").trim();
  s = s.replace(/\.(jpe?g|png|gif|webp|tiff?|svg|bmp|heic|avif)$/i, "");
  s = s.replace(/\p{Pd}/gu, "-");
  s = s.replace(/_/g, " ");
  s = s.replace(/\d+/g, " ");
  s = s.replace(NOISE_RE, " ");
  s = s.replace(/[^\p{L}\p{M}\s\-'.&,]/gu, " ");
  s = s.replace(/\s+/g, " ").trim();
  let cut = true;
  while (cut) {
    cut = false;
    const m = s.match(/\s[-–—]|[-–—]\s/);
    if (m && m.index !== undefined && m.index >= 0) {
      s = s.slice(0, m.index).trim();
      cut = true;
    }
  }
  s = s.replace(/\d+/g, " ");
  s = s.replace(NOISE_RE, " ");
  return s.replace(/\s+/g, " ").trim();
}

export function generateLocavaTitle(input: {
  sourceTitle: string;
  placeName: string;
  dayKey?: string;
}): { generatedTitle: string; confidence: "high" | "medium" | "low"; reasoning: string[] } {
  const reasoning: string[] = [];
  const cleaned = stripCommonsFilenameNoise(input.sourceTitle);
  if (!cleaned) {
    const dayPart = input.dayKey && input.dayKey !== "unknown" ? ` · ${input.dayKey}` : "";
    reasoning.push("Commons title stripped to empty; using place name fallback");
    return {
      generatedTitle: `${input.placeName}${dayPart}`.slice(0, 180),
      confidence: "low",
      reasoning,
    };
  }
  const raw = String(input.sourceTitle || "");
  if (/^file:/i.test(raw) || /[_\d]{4,}/.test(raw) || cleaned.length + 8 < raw.length) {
    reasoning.push("Filename-like Commons title cleaned for display");
    return { generatedTitle: cleaned.slice(0, 180), confidence: cleaned.length >= 8 ? "medium" : "low", reasoning };
  }
  reasoning.push("Commons title already human-readable");
  return { generatedTitle: cleaned.slice(0, 180), confidence: "high", reasoning };
}
