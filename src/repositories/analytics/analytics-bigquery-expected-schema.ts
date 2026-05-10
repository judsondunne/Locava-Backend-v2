/**
 * Expected BigQuery columns for streaming inserts from `BigQueryAnalyticsPublisher`.
 * Used by diagnostics and compatibility checks (not auto-applied to production).
 */
export const ANALYTICS_CLIENT_EVENTS_EXPECTED_FIELDS: Array<{ name: string; type: string }> = [
  { name: "event", type: "STRING" },
  { name: "schemaVersion", type: "STRING" },
  { name: "userId", type: "STRING" },
  { name: "anonId", type: "STRING" },
  { name: "sessionId", type: "STRING" },
  { name: "clientTime", type: "TIMESTAMP" },
  { name: "receivedAt", type: "TIMESTAMP" },
  { name: "platform", type: "STRING" },
  { name: "requestIp", type: "STRING" },
  { name: "userAgent", type: "STRING" },
  { name: "properties", type: "STRING" }
];

export function buildClientEventsTableSchemaJson(): string {
  return `${JSON.stringify(
    ANALYTICS_CLIENT_EVENTS_EXPECTED_FIELDS.map((f) => ({ name: f.name, type: f.type, mode: "NULLABLE" })),
    null,
    2
  )}\n`;
}

export function compareClientEventsSchema(
  fields: Array<{ name?: string; type?: string } | undefined> | undefined
): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const list = fields ?? [];
  const byName = new Map(list.map((f) => [String(f?.name ?? "").toLowerCase(), f]));
  for (const expected of ANALYTICS_CLIENT_EVENTS_EXPECTED_FIELDS) {
    const found = byName.get(expected.name.toLowerCase());
    if (!found?.name) {
      issues.push(`missing column: ${expected.name} (${expected.type})`);
      continue;
    }
    const got = String(found.type ?? "").toUpperCase();
    const want = expected.type.toUpperCase();
    if (got && want && got !== want) {
      issues.push(`column ${expected.name}: expected type ${want}, found ${got}`);
    }
  }
  return { ok: issues.length === 0, issues };
}

export function buildCreateClientEventsTableSql(projectId: string, dataset: string, table: string): string {
  const fq = `\`${projectId}.${dataset}.${table}\``;
  return [
    `CREATE TABLE IF NOT EXISTS ${fq} (`,
    `  event STRING,`,
    `  schemaVersion STRING,`,
    `  userId STRING,`,
    `  anonId STRING,`,
    `  sessionId STRING,`,
    `  clientTime TIMESTAMP,`,
    `  receivedAt TIMESTAMP,`,
    `  platform STRING,`,
    `  requestIp STRING,`,
    `  userAgent STRING,`,
    `  properties STRING`,
    `);`
  ].join("\n");
}
