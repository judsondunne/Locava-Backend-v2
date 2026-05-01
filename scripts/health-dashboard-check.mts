import { createApp } from "../src/app/createApp.js";

async function main(): Promise<void> {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent", INTERNAL_DASHBOARD_TOKEN: undefined });
  try {
    const html = await app.inject({ method: "GET", url: "/internal/health-dashboard" });
    if (html.statusCode !== 200 || !html.headers["content-type"]?.includes("text/html")) {
      throw new Error(`html_check_failed:${html.statusCode}`);
    }

    const data = await app.inject({ method: "GET", url: "/internal/health-dashboard/data" });
    if (data.statusCode !== 200) {
      throw new Error(`data_check_failed:${data.statusCode}`);
    }

    const secured = createApp({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      INTERNAL_DASHBOARD_TOKEN: "dashboard-token"
    });
    try {
      const unauthorized = await secured.inject({
        method: "GET",
        url: "/internal/health-dashboard/data",
        headers: { "x-internal-dashboard-token": "wrong-token" }
      });
      if (unauthorized.statusCode !== 401) {
        throw new Error(`token_check_failed:${unauthorized.statusCode}`);
      }
    } finally {
      await secured.close();
    }

    console.log("health dashboard check passed");
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
