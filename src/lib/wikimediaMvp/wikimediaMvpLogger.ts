const PREFIX = "[WIKIMEDIA_MVP_DEV]";

export function wikimediaMvpDevLog(message: string, extra?: Record<string, unknown>): void {
  if (extra && Object.keys(extra).length > 0) {
    console.info(`${PREFIX} ${message}`, extra);
    return;
  }
  console.info(`${PREFIX} ${message}`);
}
