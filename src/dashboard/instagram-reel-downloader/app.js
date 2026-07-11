(function () {
  const API = "/admin/instagram-downloader/api";
  const DELAY_MS = 3400;
  const DELAY_WITH_COOKIES_MS = 900;
  const BATCH_DOWNLOAD_MS = 450;
  const MAX_RETRIES = 5;
  const RETRY_BACKOFF_MS = 1100;
  const LARGE_BATCH = 45;

  const inputEl = document.getElementById("input");
  const cookiesEl = document.getElementById("cookies");
  const fetchBtn = document.getElementById("fetchBtn");
  const downloadAllBtn = document.getElementById("downloadAllBtn");
  const probeBtn = document.getElementById("probeBtn");
  const statusEl = document.getElementById("status");
  const probeOut = document.getElementById("probeOut");
  const rowsEl = document.getElementById("rows");

  let rows = [];
  let busy = false;

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  function setStatus(text, kind) {
    statusEl.textContent = text || "";
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  function shortcodeFromUrl(url) {
    var m = String(url || "").match(/\/reel\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : "";
  }

  function parseIgCookiesJson(text) {
    var t = String(text || "").trim();
    if (!t) return { cookies: null, error: null };
    try {
      var j = JSON.parse(t);
      if (!Array.isArray(j)) return { cookies: null, error: "Cookies must be a JSON array." };
      return { cookies: j, error: null };
    } catch (e) {
      return { cookies: null, error: "Cookies must be valid JSON." };
    }
  }

  function parseReelUrls(text) {
    var lines = String(text || "")
      .split(/\r?\n/)
      .map(function (l) {
        return l.trim();
      })
      .filter(Boolean);
    var seen = new Set();
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var href = line;
      try {
        var u = new URL(line.indexOf("://") >= 0 ? line : "https://" + line);
        if (u.hostname.indexOf("instagram.com") < 0) continue;
        u.search = "";
        u.hash = "";
        href = u.href;
      } catch (e) {
        continue;
      }
      if (!/\/reels?\//i.test(href)) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      out.push(href);
    }
    return out;
  }

  function parseReelsInput(text) {
    var t = String(text || "").trim();
    var metaByShortcode = {};
    if (t.indexOf("{") === 0) {
      try {
        var j = JSON.parse(t);
        var reels = Array.isArray(j.reels) ? j.reels : [];
        var urls = [];
        var seen = new Set();
        for (var i = 0; i < reels.length; i++) {
          var r = reels[i];
          var raw = typeof r.url === "string" ? r.url.trim() : "";
          if (!raw) continue;
          var sc = typeof r.shortcode === "string" ? r.shortcode : shortcodeFromUrl(raw);
          if (sc) {
            metaByShortcode[sc] = {
              titleOrCaption: typeof r.titleOrCaption === "string" ? r.titleOrCaption : "",
            };
          }
          if (seen.has(raw)) continue;
          seen.add(raw);
          urls.push(raw);
        }
        return { urls: urls, metaByShortcode: metaByShortcode };
      } catch (e) {
        return { urls: [], metaByShortcode: {} };
      }
    }
    return { urls: parseReelUrls(t), metaByShortcode: {} };
  }

  function shouldRetry(res, data) {
    if (!res) return true;
    if (res.status === 429) return true;
    if (res.status >= 502 && res.status <= 504) return true;
    if (res.status === 408) return true;
    if (res.status === 422 && data && data.retryable) return true;
    return false;
  }

  async function resolveOne(url, cookies) {
    var payload = { url: url };
    if (Array.isArray(cookies) && cookies.length) payload.cookies = cookies;
    var sc = shortcodeFromUrl(url);
    var lastErr = "Unknown error";
    for (var attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        var res = await fetch(API + "/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        var data = await res.json().catch(function () {
          return {};
        });
        if (res.ok && data && data.ok && data.videoUrl) {
          return {
            url: url,
            shortcode: data.shortcode || sc,
            status: "ok",
            error: "",
            videoUrl: data.videoUrl,
            method: data.method || "",
            caption: String(data.caption || data.title || "").slice(0, 200),
          };
        }
        lastErr = (data && (data.error || data.detail)) || "HTTP " + res.status;
        if (!(attempt < MAX_RETRIES && shouldRetry(res, data))) break;
        var extra = res.status === 422 && data && typeof data.retryAfterMs === "number" ? data.retryAfterMs : 0;
        await sleep(RETRY_BACKOFF_MS * attempt + extra);
      } catch (e) {
        lastErr = String((e && e.message) || e);
        if (attempt >= MAX_RETRIES) break;
        await sleep(RETRY_BACKOFF_MS * attempt);
      }
    }
    return {
      url: url,
      shortcode: sc,
      status: "error",
      error: lastErr,
      videoUrl: "",
      method: "",
      caption: "",
    };
  }

  function renderRows() {
    if (!rows.length) {
      rowsEl.innerHTML = '<tr><td colspan="5" class="empty">Fetch reels to see results here.</td></tr>';
      downloadAllBtn.disabled = true;
      return;
    }
    var html = "";
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var badge =
        r.status === "ok"
          ? '<span class="badge ok">ok</span>'
          : r.status === "pending"
            ? '<span class="badge wait">…</span>'
            : '<span class="badge err">fail</span>';
      var cap = r.caption ? escapeHtml(r.caption.slice(0, 80)) : "—";
      var dl =
        r.status === "ok" && r.videoUrl
          ? '<button type="button" class="row-btn" data-dl="' + i + '">Download</button>'
          : "";
      html +=
        "<tr><td><code>" +
        escapeHtml(r.shortcode || "—") +
        "</code></td><td>" +
        badge +
        (r.error ? '<div style="color:#991b1b;font-size:0.75rem">' + escapeHtml(r.error) + "</div>" : "") +
        "</td><td>" +
        escapeHtml(r.method || "—") +
        "</td><td>" +
        cap +
        "</td><td>" +
        dl +
        "</td></tr>";
    }
    rowsEl.innerHTML = html;
    var okCount = rows.filter(function (x) {
      return x.status === "ok" && x.videoUrl;
    }).length;
    downloadAllBtn.disabled = okCount === 0 || busy;
    rowsEl.querySelectorAll("[data-dl]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = Number(btn.getAttribute("data-dl"));
        void downloadRow(rows[idx]);
      });
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function downloadRow(row) {
    if (!row || !row.videoUrl) return;
    var parsed = parseIgCookiesJson(cookiesEl.value);
    var baseName = row.shortcode ? "instagram-" + row.shortcode + ".mp4" : "instagram-reel.mp4";
    setStatus("Downloading " + baseName + "…");
    var res = await fetch(API + "/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: row.videoUrl,
        sourceUrl: row.url,
        shortcode: row.shortcode || "",
        resolverMethod: row.method || "",
        preferMuxedAudio: true,
        filename: baseName,
        download: true,
        ...(parsed.cookies && parsed.cookies.length ? { cookies: parsed.cookies } : {}),
      }),
    });
    var ct = res.headers.get("content-type") || "";
    if (!res.ok || ct.indexOf("application/json") >= 0) {
      var err = await res.json().catch(function () {
        return {};
      });
      setStatus((err && (err.error || err.detail)) || "Download failed", "err");
      return;
    }
    var blob = await res.blob();
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = baseName;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus("Saved " + baseName, "ok");
  }

  async function fetchAll() {
    if (busy) return;
    var parsedCookies = parseIgCookiesJson(cookiesEl.value);
    if (parsedCookies.error) {
      setStatus(parsedCookies.error, "err");
      return;
    }
    var parsed = parseReelsInput(inputEl.value);
    var urls = parsed.urls;
    if (!urls.length) {
      setStatus("No reel URLs found. Paste JSON or URLs.", "warn");
      return;
    }
    if (urls.length > LARGE_BATCH) {
      setStatus("Large batch (" + urls.length + " URLs). Consider splitting if you see 429s.", "warn");
    }
    busy = true;
    fetchBtn.disabled = true;
    downloadAllBtn.disabled = true;
    rows = urls.map(function (u) {
      return {
        url: u,
        shortcode: shortcodeFromUrl(u),
        status: "pending",
        error: "",
        videoUrl: "",
        method: "",
        caption: "",
      };
    });
    renderRows();
    var cookies = parsedCookies.cookies;
    var delay = cookies && cookies.length ? DELAY_WITH_COOKIES_MS : DELAY_MS;
    for (var i = 0; i < urls.length; i++) {
      setStatus("Resolving " + (i + 1) + "/" + urls.length + "…");
      var meta = parsed.metaByShortcode[shortcodeFromUrl(urls[i])];
      var result = await resolveOne(urls[i], cookies);
      if (meta && meta.titleOrCaption && !result.caption) {
        result.caption = meta.titleOrCaption.slice(0, 200);
      }
      rows[i] = result;
      renderRows();
      if (i < urls.length - 1) {
        setStatus("Waiting " + delay + "ms…");
        await sleep(delay);
      }
    }
    var ok = rows.filter(function (r) {
      return r.status === "ok";
    }).length;
    setStatus("Done — " + ok + "/" + urls.length + " resolved.", ok === urls.length ? "ok" : "warn");
    busy = false;
    fetchBtn.disabled = false;
    renderRows();
  }

  async function downloadAll() {
    if (busy) return;
    var okRows = rows.filter(function (r) {
      return r.status === "ok" && r.videoUrl;
    });
    if (!okRows.length) return;
    busy = true;
    downloadAllBtn.disabled = true;
    for (var i = 0; i < okRows.length; i++) {
      setStatus("Batch download " + (i + 1) + "/" + okRows.length);
      await downloadRow(okRows[i]);
      if (i < okRows.length - 1) await sleep(BATCH_DOWNLOAD_MS);
    }
    setStatus("Batch download complete.", "ok");
    busy = false;
    renderRows();
  }

  async function runProbe() {
    probeOut.hidden = false;
    probeOut.textContent = "Probing Cobalt…";
    try {
      var health = await fetch(API + "/health").then(function (r) {
        return r.json();
      });
      var probe = await fetch(API + "/probe").then(function (r) {
        return r.json();
      });
      probeOut.textContent =
        "Service: " +
        (health.service || "backendv2") +
        "\nCobalt: " +
        (probe.cobaltBase || probe.cobaltDefault || "?") +
        " (" +
        (probe.cobaltSource || "?") +
        ")";
      setStatus("Probe OK", "ok");
    } catch (e) {
      probeOut.textContent = "Probe failed: " + String((e && e.message) || e);
      setStatus("Probe failed — is Backendv2 running with Cobalt?", "err");
    }
  }

  fetchBtn.addEventListener("click", function () {
    void fetchAll();
  });
  downloadAllBtn.addEventListener("click", function () {
    void downloadAll();
  });
  probeBtn.addEventListener("click", function () {
    void runProbe();
  });
})();
