import { spawn } from "node:child_process";

export async function runFfmpeg(args: string[], ffmpegBin = "ffmpeg"): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegBin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const errChunks: Buffer[] = [];
    child.stderr?.on("data", (d) => errChunks.push(Buffer.from(d)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${ffmpegBin} ${args.join(" ")} -> ${code}: ${Buffer.concat(errChunks).toString("utf8").slice(0, 2000)}`));
    });
  });
}
