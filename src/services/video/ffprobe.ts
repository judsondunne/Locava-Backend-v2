import { spawn } from "node:child_process";

export type FfprobeStream = {
  index: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  disposition?: { attached_pic?: number };
};

export type FfprobeResult = {
  format?: { duration?: string; bit_rate?: string };
  streams?: FfprobeStream[];
};

export async function runFfprobeJson(inputPath: string, ffmpegBin = "ffprobe"): Promise<FfprobeResult> {
  const args = ["-v", "error", "-show_entries", "format=duration,bit_rate", "-show_streams", "-of", "json", inputPath];
  const out = await spawnReadStdout(ffmpegBin, args);
  return JSON.parse(out) as FfprobeResult;
}

export function pickPrimaryStreams(streams: FfprobeStream[] | undefined): {
  video: FfprobeStream | null;
  audio: FfprobeStream | null;
} {
  if (!Array.isArray(streams)) return { video: null, audio: null };
  let video: FfprobeStream | null = null;
  for (const s of streams) {
    if (s.codec_type !== "video") continue;
    if (s.disposition?.attached_pic === 1) continue;
    const name = String(s.codec_name ?? "").toLowerCase();
    if (!name || name === "unknown") continue;
    video = s;
    break;
  }
  let audio: FfprobeStream | null = null;
  const audioCodecs = new Set(["aac", "mp3", "opus", "vorbis", "flac", "eac3", "ac3"]);
  for (const s of streams) {
    if (s.codec_type !== "audio") continue;
    const name = String(s.codec_name ?? "").toLowerCase();
    if (!name || name === "unknown") continue;
    if (!audioCodecs.has(name)) continue;
    audio = s;
    break;
  }
  return { video, audio };
}

function spawnReadStdout(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout?.on("data", (d) => chunks.push(Buffer.from(d)));
    child.stderr?.on("data", (d) => errChunks.push(Buffer.from(d)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks).toString("utf8"));
      else reject(new Error(`${cmd} exited ${code}: ${Buffer.concat(errChunks).toString("utf8").slice(0, 800)}`));
    });
  });
}

export function parseDurationSeconds(format: FfprobeResult["format"], streams: FfprobeStream[] | undefined): number {
  const raw = format?.duration;
  if (raw != null) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (Array.isArray(streams)) {
    for (const s of streams) {
      const d = (s as { duration?: string }).duration;
      if (d != null) {
        const n = Number(d);
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
  }
  return 0;
}
