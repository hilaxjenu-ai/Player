import { launch } from "@cloudflare/playwright";

const AD_KEYWORDS = [
  "doubleclick",
  "googlesyndication",
  "popads",
  "propeller",
  "adsterra",
  "exoclick",
  "onclick",
  "trafficjunky",
  "analytics",
];

const SKIP_WORDS = ["sample", "trailer", "promo", "preview", "teaser"];

const HTML_UI = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Cloudflare Browser Stream Extractor</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      display: flex;
      justify-content: center;
      padding: 40px 16px;
      margin: 0;
    }
    .card {
      background: #1e293b;
      padding: 24px;
      border-radius: 12px;
      width: 100%;
      max-width: 760px;
    }
    .row { display: flex; gap: 10px; margin-bottom: 14px; }
    input {
      flex: 1;
      padding: 12px;
      border-radius: 8px;
      border: 1px solid #334155;
      background: #0f172a;
      color: #fff;
      font-size: 15px;
    }
    button {
      padding: 12px 18px;
      border: none;
      border-radius: 8px;
      background: #3b82f6;
      color: white;
      font-weight: 600;
      cursor: pointer;
    }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .status {
      color: #94a3b8;
      font-size: 14px;
      white-space: pre-line;
      margin-top: 8px;
    }
    .box {
      background: #0f172a;
      padding: 12px;
      border-radius: 8px;
      margin-top: 14px;
      word-break: break-all;
      font-size: 12px;
      color: #38bdf8;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <div class="card">
    <h2>Cloudflare Browser Stream Extractor</h2>
    <div class="row">
      <input id="urlInput" type="text" placeholder="https://..." />
      <button id="runBtn" type="button">Extract</button>
    </div>
    <div id="status" class="status">Ready.</div>
    <div id="output" class="box" style="display:none;"></div>
  </div>

  <script>
    const inputEl = document.getElementById("urlInput");
    const btnEl = document.getElementById("runBtn");
    const statusEl = document.getElementById("status");
    const outEl = document.getElementById("output");
    const NL = String.fromCharCode(10);

    btnEl.addEventListener("click", async function () {
      const target = inputEl.value.trim();
      outEl.style.display = "none";

      if (!target) {
        statusEl.textContent = "URL podunga first.";
        return;
      }

      btnEl.disabled = true;
      statusEl.textContent = "Launching browser & capturing media requests...";

      try {
        const res = await fetch("/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: target }),
        });
        const data = await res.json();

        if (!res.ok) {
          statusEl.textContent = "Error: " + (data.detail || res.status);
        } else {
          const mediaUrls = Array.isArray(data.media_urls) ? data.media_urls : [];
          const debugUrls = Array.isArray(data.debug_urls) ? data.debug_urls : [];
          statusEl.textContent =
            "Captured: " +
            mediaUrls.length +
            " | Seen: " +
            debugUrls.length +
            " | Status: " +
            (data.main_status ?? "?") +
            " | Title: " +
            (data.page_title || "n/a");

          if (mediaUrls.length > 0) {
            outEl.textContent = mediaUrls.join(NL);
          } else {
            outEl.textContent =
              "Seen URLs:" +
              NL +
              debugUrls.join(NL) +
              NL +
              NL +
              "HTML Preview:" +
              NL +
              (data.html_preview || "");
          }
          outEl.style.display = "block";
        }
      } catch (e) {
        statusEl.textContent = "Request failed: " + e.message;
      } finally {
        btnEl.disabled = false;
      }
    });
  </script>
</body>
</html>`;

function isValidUrl(raw) {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isBlocked(text) {
  const s = (text || "").toLowerCase();
  return (
    AD_KEYWORDS.some((k) => s.includes(k)) ||
    SKIP_WORDS.some((k) => s.includes(k))
  );
}

function looksLikeMediaUrl(urlStr, contentType = "") {
  const u = (urlStr || "").toLowerCase();
  const ct = (contentType || "").toLowerCase();

  if (
    ct.startsWith("video/") ||
    ct.startsWith("audio/") ||
    ct.includes("mpegurl") ||
    ct.includes("dash+xml") ||
    ct.includes("x-mpegurl")
  ) {
    return true;
  }

  return (
    /\.(mp4|m3u8|mpd|m4s|ts|webm|mkv)(\?|#|$)/i.test(u) ||
    /stream=1|playlist\.m3u8|master\.m3u8|manifest/i.test(u)
  );
}

async function triggerPlayInAllFrames(page) {
  for (const frame of page.frames()) {
    try {
      await frame.evaluate(async () => {
        const videos = [...document.querySelectorAll("video")];
        for (const v of videos) {
          try {
            v.muted = true;
            await v.play();
          } catch {}
        }

        const btns = [
          ...document.querySelectorAll(
            "[class*='play'], [id*='play'], button[aria-label*='play' i], .vjs-big-play-button, .jw-icon-playback, video"
          ),
        ];
        for (const b of btns.slice(0, 5)) {
          try {
            b.click();
          } catch {}
        }
      });
    } catch {}
  }
}

async function captureMediaWithBrowser(browserBinding, targetUrl) {
  const captured = new Set();
  const seen = new Set();
  let mainStatus = null;
  const browser = await launch(browserBinding);

  try {
    const page = await browser.newPage();

    await page.route("**/*", (route) => {
      const reqUrl = route.request().url();
      const type = route.request().resourceType();
      if (isBlocked(reqUrl) || type === "image" || type === "font") {
        return route.abort();
      }
      return route.continue();
    });

    page.on("request", (req) => {
      const reqUrl = req.url();
      if (!isBlocked(reqUrl)) {
        seen.add(reqUrl);
        if (looksLikeMediaUrl(reqUrl, "")) {
          captured.add(reqUrl);
        }
      }
    });

    page.on("response", (res) => {
      const resUrl = res.url();
      const ct = res.headers()["content-type"] || "";
      if (mainStatus === null && res.request().isNavigationRequest()) {
        mainStatus = res.status();
      }
      if (!isBlocked(resUrl)) {
        seen.add(resUrl);
        if (looksLikeMediaUrl(resUrl, ct)) {
          captured.add(resUrl);
        }
      }
    });

    const navRes = await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    if (navRes && mainStatus === null) {
      mainStatus = navRes.status();
    }

    await page.waitForTimeout(4000);
    await triggerPlayInAllFrames(page);
    await page.waitForTimeout(5000);

    const pageTitle = await page.title().catch(() => "");
    const html = await page.content().catch(() => "");

    return {
      mediaUrls: [...captured],
      debugUrls: [...seen].slice(0, 30),
      mainStatus,
      pageTitle,
      htmlPreview: html.slice(0, 600),
    };
  } finally {
    await browser.close();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(HTML_UI, {
        headers: { "Content-Type": "text/html; charset=UTF-8" },
      });
    }

    if (request.method === "POST" && url.pathname === "/extract") {
      try {
        const body = await request.json();
        const targetUrl = (body && body.url ? body.url : "").trim();

        if (!isValidUrl(targetUrl)) {
          return Response.json({ detail: "Invalid URL" }, { status: 400 });
        }

        if (!env || !env.BROWSER) {
          return Response.json(
            {
              detail:
                "BROWSER binding missing. Cloudflare Worker settings-la Browser binding add pannunga.",
            },
            { status: 500 }
          );
        }

        const result = await captureMediaWithBrowser(env.BROWSER, targetUrl);
        const preferred =
          result.mediaUrls.find((u) => /\.(m3u8|mp4|mpd)(\?|#|$)/i.test(u)) ||
          result.mediaUrls[0] ||
          null;

        return Response.json({
          stream_url: preferred,
          media_urls: result.mediaUrls,
          debug_urls: result.debugUrls,
          main_status: result.mainStatus,
          page_title: result.pageTitle,
          html_preview: result.htmlPreview,
        });
      } catch (err) {
        return Response.json(
          { detail: err && err.message ? err.message : "Browser capture error" },
          { status: 500 }
        );
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};
