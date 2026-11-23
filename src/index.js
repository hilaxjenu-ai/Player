const HTML_PLAYER = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Direct Stream Player</title>
  <script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: #090d16;
      color: #f1f5f9;
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding: 24px 14px;
    }
    .app {
      width: 100%;
      max-width: 820px;
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 14px;
      padding: 20px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
    }
    .title {
      margin: 0 0 14px;
      font-size: 20px;
      font-weight: 700;
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 14px;
    }
    .url-input {
      flex: 1 1 280px;
      padding: 12px 14px;
      border-radius: 10px;
      border: 1px solid #374151;
      background: #090d16;
      color: #fff;
      font-size: 14px;
      outline: none;
    }
    .url-input:focus {
      border-color: #3b82f6;
    }
    .btn {
      padding: 12px 16px;
      border: none;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      color: #fff;
      cursor: pointer;
    }
    .btn-direct { background: #16a34a; }
    .btn-proxy { background: #2563eb; }
    .btn-stop { background: #475569; }
    .stage {
      width: 100%;
      background: #000;
      border: 1px solid #1f2937;
      border-radius: 12px;
      overflow: hidden;
    }
    video {
      width: 100%;
      max-height: 450px;
      display: block;
      background: #000;
    }
    .meta {
      margin-top: 12px;
      padding: 12px;
      border-radius: 10px;
      background: #090d16;
      border: 1px solid #1f2937;
      font-size: 13px;
      color: #94a3b8;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .quick-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }
    .chip {
      padding: 6px 10px;
      border-radius: 8px;
      border: 1px solid #334155;
      background: #1e293b;
      color: #cbd5e1;
      font-size: 12px;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="app">
    <h1 class="title">Direct Stream Player</h1>

    <div class="controls">
      <input
        id="streamUrl"
        class="url-input"
        type="url"
        placeholder="Paste .mp4 / .m3u8 / .webm link here..."
      />
      <button id="playDirect" class="btn btn-direct" type="button">Play Direct</button>
      <button id="playProxy" class="btn btn-proxy" type="button">Play via Proxy</button>
      <button id="stopBtn" class="btn btn-stop" type="button">Stop</button>
    </div>

    <div class="stage">
      <video id="player" controls playsinline preload="metadata"></video>
    </div>

    <div id="statusBox" class="meta">Ready. Direct stream link paste panni Play Direct or Play via Proxy click pannunga.</div>

    <div class="quick-row">
      <button
        id="sampleMp4"
        class="chip"
        type="button"
        data-url="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
      >
        Test Sample MP4
      </button>
      <button id="checkHeadersBtn" class="chip" type="button">
        Check Link Status
      </button>
    </div>
  </div>

  <script>
    const inputEl = document.getElementById("streamUrl");
    const directBtn = document.getElementById("playDirect");
    const proxyBtn = document.getElementById("playProxy");
    const stopBtn = document.getElementById("stopBtn");
    const sampleBtn = document.getElementById("sampleMp4");
    const checkBtn = document.getElementById("checkHeadersBtn");
    const videoEl = document.getElementById("player");
    const statusEl = document.getElementById("statusBox");

    let hls = null;

    function setStatus(msg) {
      statusEl.textContent = msg;
    }

    function cleanupPlayer() {
      if (hls) {
        hls.destroy();
        hls = null;
      }
      videoEl.pause();
      videoEl.removeAttribute("src");
      videoEl.load();
    }

    function startPlayback(useProxy) {
      const rawUrl = inputEl.value.trim();
      if (!rawUrl) {
        setStatus("First stream URL podunga.");
        return;
      }

      let finalUrl = rawUrl;
      if (useProxy) {
        finalUrl = "/stream?url=" + encodeURIComponent(rawUrl);
      }

      cleanupPlayer();
      setStatus((useProxy ? "Proxy" : "Direct") + " mode-la load aagudhu:\\n" + rawUrl);

      const isM3u8 = /\.m3u8(\?|#|$)/i.test(rawUrl);

      if (isM3u8 && window.Hls && window.Hls.isSupported()) {
        hls = new window.Hls({ enableWorker: true });
        hls.loadSource(finalUrl);
        hls.attachMedia(videoEl);
        hls.on(window.Hls.Events.MANIFEST_PARSED, function () {
          setStatus("HLS manifest loaded. Playing...");
          videoEl.play().catch(function () {
            setStatus("HLS ready. Video controls-la Play press pannunga.");
          });
        });
        hls.on(window.Hls.Events.ERROR, function (_, data) {
          if (data && data.fatal) {
            setStatus("HLS Fatal Error: " + (data.type || "") + " - " + (data.details || "failed"));
          }
        });
        return;
      }

      videoEl.src = finalUrl;
      videoEl.play()
        .then(function () {
          setStatus("Playing successfully (" + (useProxy ? "Proxy" : "Direct") + ").");
        })
        .catch(function (err) {
          setStatus(
            "Autoplay/Load note: " +
              (err && err.message ? err.message : "Controls-la play try pannunga or Check Link Status click pannunga.")
          );
        });
    }

    videoEl.addEventListener("error", function () {
      const e = videoEl.error;
      const map = {
        1: "MEDIA_ERR_ABORTED (Playback stopped)",
        2: "MEDIA_ERR_NETWORK (Network error / 403 / 404 / expired / blocked)",
        3: "MEDIA_ERR_DECODE (Video codec/stream corrupted or unsupported)",
        4: "MEDIA_ERR_SRC_NOT_SUPPORTED (Format not supported or URL returned HTML/error)"
      };
      setStatus("Video Element Error: " + (e ? (map[e.code] || "Code " + e.code) : "Unknown error"));
    });

    directBtn.addEventListener("click", function () {
      startPlayback(false);
    });

    proxyBtn.addEventListener("click", function () {
      startPlayback(true);
    });

    stopBtn.addEventListener("click", function () {
      cleanupPlayer();
      setStatus("Stopped.");
    });

    sampleBtn.addEventListener("click", function () {
      inputEl.value = sampleBtn.getAttribute("data-url");
      startPlayback(false);
    });

    checkBtn.addEventListener("click", async function () {
      const target = inputEl.value.trim();
      if (!target) {
        setStatus("First URL podunga.");
        return;
      }
      setStatus("Checking link status via Worker...");
      try {
        const res = await fetch("/probe?url=" + encodeURIComponent(target));
        const info = await res.json();
        setStatus(JSON.stringify(info, null, 2));
      } catch (err) {
        setStatus("Probe error: " + err.message);
      }
    });
  </script>
</body>
</html>`;

function parseHttpUrl(raw) {
  try {
    const u = new URL((raw || "").trim());
    if (u.protocol === "http:" || u.protocol === "https:") {
      return u;
    }
    return null;
  } catch {
    return null;
  }
}

async function handleProbe(targetUrl) {
  const parsed = parseHttpUrl(targetUrl);
  if (!parsed) {
    return Response.json({ ok: false, error: "Invalid HTTP/HTTPS URL" }, { status: 400 });
  }

  try {
    const resp = await fetch(parsed.toString(), {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Referer": parsed.origin + "/",
        "Range": "bytes=0-1023",
      },
      redirect: "follow",
    });

    const contentType = resp.headers.get("content-type") || "";
    const contentLength = resp.headers.get("content-length") || "";
    const acceptRanges = resp.headers.get("accept-ranges") || "";
    const snippetText = contentType.includes("text") || contentType.includes("html") || contentType.includes("json")
      ? await resp.text().then((t) => t.slice(0, 300))
      : "[binary/media stream]";

    return Response.json({
      ok: resp.ok || resp.status === 206,
      status: resp.status,
      statusText: resp.statusText,
      finalUrl: resp.url,
      contentType,
      contentLength,
      acceptRanges,
      preview: snippetText,
    });
  } catch (err) {
    return Response.json({ ok: false, error: err.message || "Fetch failed" }, { status: 502 });
  }
}

async function handleStreamProxy(request, targetUrl) {
  const parsed = parseHttpUrl(targetUrl);
  if (!parsed) {
    return new Response("Invalid URL", { status: 400 });
  }

  const upstreamHeaders = new Headers({
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Referer": parsed.origin + "/",
  });

  const range = request.headers.get("Range");
  if (range) {
    upstreamHeaders.set("Range", range);
  }

  const upstream = await fetch(parsed.toString(), {
    method: "GET",
    headers: upstreamHeaders,
    redirect: "follow",
  });

  const resHeaders = new Headers();
  for (const key of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "cache-control",
  ]) {
    const val = upstream.headers.get(key);
    if (val) resHeaders.set(key, val);
  }
  resHeaders.set("Access-Control-Allow-Origin", "*");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: resHeaders,
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(HTML_PLAYER, {
        headers: { "Content-Type": "text/html; charset=UTF-8" },
      });
    }

    if (request.method === "GET" && url.pathname === "/probe") {
      return handleProbe(url.searchParams.get("url") || "");
    }

    if (request.method === "GET" && url.pathname === "/stream") {
      return handleStreamProxy(request, url.searchParams.get("url") || "");
    }

    return new Response("Not Found", { status: 404 });
  },
};
