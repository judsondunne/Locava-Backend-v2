import { spawn } from "node:child_process";

function readHelp(ffmpegBin: string, filterName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin, ["-hide_banner", "-h", `filter=${filterName}`], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    const chunks: Buffer[] = [];
    child.stdout?.on("data", (d) => chunks.push(Buffer.from(d)));
    child.stderr?.on("data", (d) => chunks.push(Buffer.from(d)));
    child.on("error", reject);
    child.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

/**
 * Ensures this ffmpeg build can run the HDR zscale + tonemap chain. Call before any HDR color-v2 encode.
 */
export async function assertFfmpegSupportsZscaleTonemap(ffmpegBin: string): Promise<void> {
  const [zscaleHelp, tonemapHelp] = await Promise.all([
    readHelp(ffmpegBin, "zscale"),
    readHelp(ffmpegBin, "tonemap")
  ]);
  if (!/^Filter zscale/m.test(zscaleHelp) && !/\bFilter zscale\b/m.test(zscaleHelp)) {
    throw new Error(
      `ffmpeg_missing_zscale: "${ffmpegBin}" -h filter=zscale did not document the zscale filter (libzimg). Install a full ffmpeg build with --enable-libzimg.`
    );
  }
  if (!/^Filter tonemap/m.test(tonemapHelp) && !/\bFilter tonemap\b/m.test(tonemapHelp)) {
    throw new Error(
      `ffmpeg_missing_tonemap: "${ffmpegBin}" -h filter=tonemap did not document the tonemap filter.`
    );
  }
}
