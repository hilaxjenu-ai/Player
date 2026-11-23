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

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const HTML_UI = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Cloudflare Stream Player & Extractor</title>
  <script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      display: flex;
      justify-content: center;
      padding: 28px 14px;
      margin: 0;
    }
    .card {
      background: #1e293b;
      padding: 20px;
      border-radius: 14px;
      width: 100%;
      max-width: 820px;
      box-shadow: 0 12px 30px rgba(0,0,0,0.35);
    }
    h2 { margin: 0 0 14px; font-size: 20px; }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 14px;
    }
    input {
      flex: 1 1 280px;
      padding: 12px 14px;
      border-radius: 9px;
      border: 1px solid #334155;
      background: #0f172a;
      color: #fff;
      font-size: 14px;
    }
    button {
      padding: 12px 16px;
      border: none;
      border-radius: 9px;
      background: #3b82f6;
      color: white;
      font-weight: 600;
      cursor: pointer;
      font-size: 14px;
    }
    button.play-btn { background: #10b981; }
    button.secondary-btn { background: #475569; padding: 8px 12px; font-size: 12px; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .player-wrap {
      background: #000;
      border-radius: 10px;
      overflow: hidden;
      margin-top: 10px;
      border: 1px solid #334155;
    }
    video {
      width: 100%;
      max-height: 440px;
      display: block;
      background: #000;
    }
    .status {
      color: #94a3b8;
      font-size: 13px;
      white-space: pre-line;
      margin-top: 10px;
    }
    .box {
      background: #0f172a;
      padding: 12px;
      border-radius: 9px;
      margin-top: 12px;
      word-break: break-all;
      font-size: 12px;
      color: #38bdf8;
      white-space: pre-wrap;
    }
    .url-item {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 0;
      border-bottom: 1px solid #1e293b;
    }
    .url-item:last-child { border-bottom: none; }
    .url-text { flex: 1 1 260px; color: #e2e8f0; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Stream Player & Extractor</h2>
    <div class="row">
      <input id="urlInput" type="text" placeholder="Paste .mp4 / .m3u8 stream URL or video page URL..." />
      <button id="playBtn" class="play-btn" type="button">Play</button>
      <button id="extractBtn" type="button">Extract</button>
    </div>

    <div class="player-wrap">
      <video id="videoPlayer" controls playsinline preload="metadata"></video>
    </div>

    <div id="status" class="status">Direct .mp4 / .m3u8 link potu Play click pannunga, illai page URL potu Extract pannunga.</div>
    <div id="output" class="box" style="display:none;"></div>
  </div>

  <script>
    const inputEl = document.getElementById("urlInput");
    const playBtn = document.getElementById("playBtn");
    const extractBtn = document.getElementById("extractBtn");
    const videoEl = document.getElementById("videoPlayer");
    const statusEl = document.getElementById("status");
    const outEl = document.getElementById("output");
    const NL = String.fromCharCode(10);

    let hlsInstance = null;

    function destroyHls() {
      if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
      }
    }

    function playStreamUrl(rawUrl) {
      const streamUrl = (rawUrl || "").trim();
      if (!streamUrl) {
        statusEl.textContent = "Stream URL podunga first.";
        return;
      }

      inputEl.value = streamUrl;
      destroyHls();
      videoEl.pause();
      videoEl.removeAttribute("src");
      videoEl.load();

      const isHls = /\.m3u8(\?|#|$)/i.test(streamUrl);

      if (isHls && window.Hls && window.Hls.isSupported()) {
        statusEl.textContent = "Loading HLS (.m3u8) stream...";
        hlsInstance = new window.Hls();
        hlsInstance.loadSource(streamUrl);
        hlsInstance.attachMedia(videoEl);
        hlsInstance.on(window.Hls.Events.MANIFEST_PARSED, function () {
          statusEl.textContent = "HLS stream ready. Playing...";
          videoEl.play().catch(function () {});
        });
        hlsInstance.on(window.Hls.Events.ERROR, function (_, data) {
          if (data && data.fatal) {
            statusEl.textContent = "HLS playback error: " + (data.details || "failed");
          }
        });
      } else {
        statusEl.textContent = "Loading video stream...";
        videoEl.src = streamUrl;
        videoEl.play().then(function () {
          statusEl.textContent = "Playing stream.";
        }).catch(function () {
          statusEl.textContent = "Stream loaded. Controls moolama play pannunga (or link block aagirukkalaam).";
        });
      }
    }

    videoEl.addEventListener("error", function () {
      const err = videoEl.error;
      const codeMap = {
        1: "Aborted",
        2: "Network error (CORS / blocked / expired link)",
        3: "Decode error",
        4: "Format not supported or blocked by host"
      };
      const msg = err ? (codeMap[err.code] || ("Code " + err.code)) : "Playback failed";
      statusEl.textContent = "Player Error: " + msg;
    });

    playBtn.addEventListener("click", function () {
      playStreamUrl(inputEl.value);
    });

    extractBtn.addEventListener("click", async function () {
      const target = inputEl.value.trim();
      outEl.style.display = "none";
      outEl.innerHTML = "";

      if (!target) {
        statusEl.textContent = "URL podunga first.";
        return;
      }

      if (/\.(mp4|m3u8|webm)(\?|#|$)/i.test(target)) {
        statusEl.textContent = "Direct stream link detect aagirukku—player-la load panren...";
        playStreamUrl(target);
        return;
      }

      playBtn.disabled = true;
      extractBtn.disabled = true;
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
            outEl.style.display = "block";
            mediaUrls.forEach(function (u) {
              const row = document.createElement("div");
              row.className = "url-item";

              const txt = document.createElement("div");
              txt.className = "url-text";
              txt.textContent = u;

              const pBtn = document.createElement("button");
              pBtn.type = "button";
              pBtn.className = "secondary-btn";
              pBtn.textContent = "Play";
              pBtn.addEventListener("click", function () {
                playStreamUrl(u);
              });

              row.appendChild(txt);
              row.appendChild(pBtn);
              outEl.appendChild(row);
            });

            if (data.stream_url) {
              playStreamUrl(data.stream_url);
            }
          } else {
            outEl.style.display = "block";
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
        }
      } catch (e) {
        statusEl.textContent = "Request failed: " + e.message;
      } finally {
        playBtn.disabled = false;
        extractBtn.disabled = false;
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
    const origin = new URL(targetUrl).origin + "/";
    const context = await browser.newContext({
      userAgent: DESKTOP_UA,
      viewport: { width: 1280, height: 720 },
      locale: "en-US",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        Referer: origin,
      },
    });

    const page = await context.newPage();

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
