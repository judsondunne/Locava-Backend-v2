import process from "node:process";

export type RuntimeHealthSnapshot = {
  timestamp: string;
  uptimeSec: number;
  pid: number;
  nodeVersion: string;
  platform: string;
  arch: string;
  memory: {
    rssBytes: number;
    heapTotalBytes: number;
    heapUsedBytes: number;
    externalBytes: number;
    arrayBuffersBytes: number;
  };
  cpu: {
    userMs: number;
    systemMs: number;
  };
  resourceUsage: {
    maxRssKb: number;
    involuntaryContextSwitches: number;
    voluntaryContextSwitches: number;
  };
};

export function collectRuntimeHealth(): RuntimeHealthSnapshot {
  const usage = process.memoryUsage();
  const cpu = process.cpuUsage();
  const resources = process.resourceUsage();
  return {
    timestamp: new Date().toISOString(),
    uptimeSec: round(process.uptime()),
    pid: process.pid,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    memory: {
      rssBytes: usage.rss,
      heapTotalBytes: usage.heapTotal,
      heapUsedBytes: usage.heapUsed,
      externalBytes: usage.external,
      arrayBuffersBytes: usage.arrayBuffers
    },
    cpu: {
      userMs: round(cpu.user / 1_000),
      systemMs: round(cpu.system / 1_000)
    },
    resourceUsage: {
      maxRssKb: resources.maxRSS,
      involuntaryContextSwitches: resources.involuntaryContextSwitches,
      voluntaryContextSwitches: resources.voluntaryContextSwitches
    }
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
