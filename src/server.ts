import 'dotenv/config'
import { createApp } from "./app/createApp.js";
import { collectDevHttpBaseUrls, printDevListenUrlBanner } from "./boot/printDevListenUrls.js";
import { getAnalyticsStartupLogPayload } from "./repositories/analytics/analytics-publisher.js";
import { logVideoProcessingCloudTasksStartup } from "./services/posting/video-processing-cloud-tasks.diagnostics.js";

const app = createApp();

const start = async (): Promise<void> => {
  try {
    const host = app.config.HOST;
    await app.listen({
      host,
      port: app.config.PORT,
      // When binding IPv6 unspecified address, allow IPv4-mapped traffic so
      // `localhost` / legacy IPv4 clients still reach the same socket.
      ...(host === "::" ? { ipv6Only: false as const } : {}),
    });

    app.log.info(
      {
        service: app.config.SERVICE_NAME,
        version: app.config.SERVICE_VERSION,
        env: app.config.NODE_ENV,
        port: app.config.PORT
      },
      "server started"
    );
    const analyticsBoot = getAnalyticsStartupLogPayload(app.config);
    const analyticsWarnings = Array.isArray(analyticsBoot.warnings) ? analyticsBoot.warnings : [];
    app.log.info(analyticsBoot, "analytics_config");
    if (analyticsWarnings.length > 0) {
      app.log.warn({ ...analyticsBoot, warnings: analyticsWarnings }, "analytics_config_warnings");
    }
    logVideoProcessingCloudTasksStartup(app.log);

    printDevListenUrlBanner(app.config.PORT, app.config.NODE_ENV, app.config);
    if (app.config.NODE_ENV !== "production") {
      app.log.info(
        { devListenUrls: collectDevHttpBaseUrls(app.config.PORT), port: app.config.PORT },
        "dev_listen_urls"
      );
    }
  } catch (error) {
    app.log.fatal({ err: error }, "failed to start server");
    process.exit(1);
  }
};

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

void start();
