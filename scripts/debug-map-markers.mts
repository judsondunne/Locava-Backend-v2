const baseUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:8080";
const headers = {
  "x-viewer-id": process.env.DEBUG_VIEWER_ID ?? "internal-viewer",
  "x-viewer-roles": "internal"
};

async function run(): Promise<void> {
  const first = await fetch(`${baseUrl}/v2/map/markers`, { headers });
  const firstText = await first.text();
  const etag = first.headers.get("etag");
  console.log("[debug:map:markers] first", {
    status: first.status,
    etag,
    bytes: Buffer.byteLength(firstText, "utf8")
  });
  if (etag) {
    const second = await fetch(`${baseUrl}/v2/map/markers`, {
      headers: { ...headers, "If-None-Match": etag }
    });
    console.log("[debug:map:markers] second", {
      status: second.status,
      etag: second.headers.get("etag")
    });
  }
}

void run();
