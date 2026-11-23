import { launch } from "@cloudflare/playwright";

const NAV_TIMEOUT_MS = 20000;
const MAX_WAIT_MS = 15000;
const POLL_MS = 1000;
const SETTLE_MS = 1500;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const AD_HOSTS = [
  "doubleclick.net", "googlesyndication.com", "googleadservices.com",
  "google-analytics.com", "googletagmanager.com", "googletagservices.com",
  "adservice.google.com", "facebook.net", "connect.facebook.net",
  "scorecardresearch.com", "quantserve.com", "taboola.com", "outbrain.com",
  "adnxs.com", "criteo.com", "criteo.net", "pubmatic.com", "rubiconproject.com",
  "openx.net", "adsrvr.org", "moatads.com", "hotjar.com", "segment.io",
  "mixpanel.com", "amazon-adsystem.com", "popads.net", "propellerads.com",
  "exoclick.com", "juicyads.com", "adsterra.com", "yandex.ru", "mc.yandex.ru",
  "imasdk.googleapis.com", "advertising.com", "serving-sys.com", "smartadserver.com",
];

const MEDIA_EXT_RE = /\.(mp4|m4v|webm|mkv|mov|m3u8|mpd|mp3|m4a|aac|ogg|oga|ogv|flac|wav)$/i;
const SEGMENT_RE = /\.(ts|m4s|cmfv|cmfa)$/i;
const MEDIA_CT_RE =
  /^(video\/|audio\/|application\/(vnd\.apple\.mpegurl|x-mpegurl|dash\+xml|octet-stream-media))/i;

function isAdUrl(u) {
  try {
    const host = new URL(u).hostname.toLowerCase();
    return AD_HOSTS.some((d) => host === d || host.endsWith("." + d));
  } catch (e) {
    return true;
  }
}

function pathOf(u) {
  try {
    return new URL(u).pathname;
  } catch (e) {
    return "";
  }
}

function isPrivateHost(host) {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^\[.*\]$/.test(h)) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

function parseTarget(raw) {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u;
  try {
    u = new URL(s);
  } catch (e) {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (isPrivateHost(u.hostname)) return null;
  return u.toString();
}

function rank(u) {
  const p = pathOf(u).toLowerCase();
  if (p.endsWith(".m3u8")) return 0;
  if (p.endsWith(".mpd")) return 1;
  if (p.endsWith(".mp4") || p.endsWith(".webm") || p.endsWith(".m4v")) return 2;
  return 3;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function json(obj, status) {
  return new Response(JSON.stringify(obj, null, 2), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
    },
  });
}

async function tryPlay(page) {
  const selectors = [
    ".vjs-big-play-button",
    ".jw-icon-display",
    ".plyr__control--overlaid",
    "button[aria-label*='play' i]",
    "[class*='play-btn' i]",
    "[class*='play_button' i]",
    "[class*='playbutton' i]",
  ];
  const mainFrame = page.mainFrame();
  for (const frame of page.frames()) {
    // 1) Ask any media element to play (muted, so autoplay rules allow it).
    try {
      await frame.evaluate(() => {
        document.querySelectorAll("video,audio").forEach((m) => {
          try {
            m.muted = true;
            const p = m.play();
            if (p && p.catch) p.catch(() => {});
          } catch (e) {}
        });
      });
    } catch (e) {}

    // 2) Click common play-button selectors inside the frame.
    let clicked = false;
    for (const sel of selectors) {
      try {
        await frame.locator(sel).first().click({ timeout: 600, force: true });
        clicked = true;
        break;
      } catch (e) {}
    }
    if (clicked) continue;

    // 3) Fallback: click the center of the video element, or of the iframe
    //    that contains it (mouse clicks reach into iframes).
    try {
      if (frame === mainFrame) {
        await frame.locator("video").first().click({ timeout: 600, force: true });
      } else {
        const el = await frame.frameElement();
        const box = await el.boundingBox();
        if (box && box.width > 50 && box.height > 50) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        }
      }
    } catch (e) {}
  }
}

async function collectDomSources(page, record) {
  for (const frame of page.frames()) {
    try {
      const urls = await frame.evaluate(() => {
        const out = [];
        document.querySelectorAll("video,audio").forEach((m) => {
          if (m.currentSrc) out.push(m.currentSrc);
          if (m.src) out.push(m.src);
          m.querySelectorAll("source").forEach((s) => {
            if (s.src) out.push(s.src);
          });
        });
        return out;
      });
      for (const u of urls) record(u, "dom");
    } catch (e) {}
  }
}

async function extract(env, targetUrl, referer) {
  const found = new Map();
  const sample = [];
  const errors = [];
  const redirects = [];
  let segmentCount = 0;
  let mainStatus = null;
  let title = "";
  let finalUrl = targetUrl;
  let browser = null;

  function record(url, via, extra) {
    if (!url || url.startsWith("blob:") || url.startsWith("data:")) return;
    if (!/^https?:/i.test(url)) return;
    if (isAdUrl(url)) return;
    const p = pathOf(url);
    if (SEGMENT_RE.test(p)) {
      segmentCount++;
      return;
    }
    if (!found.has(url)) {
      found.set(url, Object.assign({ via: via }, extra || {}));
    }
  }

  function attach(page) {
    page.on("request", (req) => {
      try {
        const url = req.url();
        if (sample.length < 25 && !isAdUrl(url) && !/\.(png|jpe?g|gif|svg|ico|woff2?|css)(\?|$)/i.test(url)) {
          sample.push(req.resourceType() + " " + url.slice(0, 200));
        }
        if (req.resourceType() === "media" || MEDIA_EXT_RE.test(pathOf(url))) {
          record(url, "request");
        }
      } catch (e) {}
    });
    page.on("response", (res) => {
      try {
        const url = res.url();
        const ct = (res.headers()["content-type"] || "").split(";")[0].trim();
        if (MEDIA_CT_RE.test(ct) || MEDIA_EXT_RE.test(pathOf(url))) {
          record(url, "response", { contentType: ct, status: res.status() });
        }
      } catch (e) {}
    });
    page.on("framenavigated", (frame) => {
      try {
        if (frame === page.mainFrame()) {
          const u = frame.url();
          if (u && redirects[redirects.length - 1] !== u && redirects.length < 15) redirects.push(u);
        }
      } catch (e) {}
    });
  }

  try {
    browser = await launch(env.BROWSER);
    const context = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1280, height: 720 },
      locale: "en-US",
    });

    const page = await context.newPage();
    attach(page);

    context.on("page", (popup) => {
      // Popups are almost always ads; close any page that is not the main one.
      if (popup === page) return;
      popup.close().catch(() => {});
    });

    try {
      const gotoOpts = { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS };
      if (referer) gotoOpts.referer = referer;
      const resp = await page.goto(targetUrl, gotoOpts);
      mainStatus = resp ? resp.status() : null;
    } catch (e) {
      errors.push("navigation: " + String(e && e.message ? e.message : e).slice(0, 300));
    }

    // Let JS redirects and late scripts settle briefly.
    try {
      await page.waitForLoadState("networkidle", { timeout: 4000 });
    } catch (e) {}

    const start = Date.now();
    let lastFoundAt = 0;
    let lastCount = 0;
    let tick = 0;
    while (Date.now() - start < MAX_WAIT_MS) {
      if (tick % 2 === 0) {
        try {
          await tryPlay(page);
        } catch (e) {}
      }
      await sleep(POLL_MS);
      tick++;
      if (tick % 3 === 0) {
        try {
          await collectDomSources(page, record);
        } catch (e) {}
      }
      if (found.size !== lastCount) {
        lastCount = found.size;
        lastFoundAt = Date.now();
      }
      if (found.size > 0 && Date.now() - lastFoundAt >= SETTLE_MS) break;
    }

    try {
      await collectDomSources(page, record);
    } catch (e) {}

    try {
      title = await page.title();
    } catch (e) {}
    try {
      finalUrl = page.url();
    } catch (e) {}
    let frameUrls = [];
    try {
      frameUrls = page.frames().map((f) => f.url()).filter((u) => u && u !== "about:blank").slice(0, 15);
    } catch (e) {}

    const media = Array.from(found.keys()).sort((a, b) => rank(a) - rank(b));
    const result = {
      ok: media.length > 0,
      input_url: targetUrl,
      stream_url: media.length ? media[0] : null,
      media_urls: media,
    };

    const debug = {
      status: mainStatus,
      title: title,
      final_url: finalUrl,
      redirects: redirects,
      frames: frameUrls,
      segments_ignored: segmentCount,
    };

    if (!media.length) {
      const t = (title || "").toLowerCase();
      const blocked =
        mainStatus === 403 || mainStatus === 429 || mainStatus === 503 ||
        /just a moment|attention required|access denied|captcha|verify you are human|blocked/.test(t);
      debug.sample_requests = sample;
      debug.errors = errors;
      debug.message = blocked
        ? "Target appears to block headless or datacenter traffic (status/title suggests a bot challenge)."
        : "No media captured. The player may need a login or longer wait. If frames lists an embed host, try that URL directly with the page as referer.";
    } else if (errors.length) {
      debug.errors = errors;
    }
    result.debug = debug;
    return result;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
  }
}

const HTML = [
  "<!doctype html>",
  "<html lang='en'><head>",
  "<meta charset='utf-8'>",
  "<meta name='viewport' content='width=device-width,initial-scale=1'>",
  "<title>Stream Extractor</title>",
  "<style>",
  "body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:#111;color:#eee}",
  "h1{font-size:20px;margin:0 0 12px}",
  "h2{font-size:16px;margin:20px 0 8px}",
  "input{width:100%;box-sizing:border-box;padding:12px;font-size:16px;border-radius:8px;border:1px solid #444;background:#1c1c1c;color:#eee;margin-bottom:8px}",
  "button{padding:10px 14px;font-size:15px;border:0;border-radius:8px;background:#f6821f;color:#fff}",
  "button.full{width:100%;font-size:16px;padding:12px}",
  "button.small{background:#2d6cdf;margin:4px 6px 4px 0}",
  "button:disabled{opacity:.6}",
  "pre{white-space:pre-wrap;word-break:break-all;background:#1c1c1c;padding:12px;border-radius:8px;margin-top:10px;font-size:13px}",
  "video{width:100%;background:#000;border-radius:8px;max-height:60vh}",
  ".row{margin:6px 0;word-break:break-all;font-size:13px}",
  "#perr{color:#ff8a8a;font-size:13px;margin-top:6px;min-height:16px}",
  "</style></head><body>",
  "<h1>Stream Extractor</h1>",
  "<input id='u' type='url' placeholder='https://example.com/video-page' autocomplete='off'>",
  "<input id='ref' type='url' placeholder='Optional referer (parent page URL)' autocomplete='off'>",
  "<button id='b' class='full'>Extract</button>",
  "<div id='links'></div>",
  "<pre id='o'>Ready.</pre>",
  "<h2>Player / stream tester</h2>",
  "<input id='su' type='url' placeholder='Direct .mp4 or .m3u8 URL' autocomplete='off'>",
  "<button id='pb' class='full'>Play</button>",
  "<video id='v' controls playsinline></video>",
  "<div id='perr'></div>",
  "<script>",
  "var b=document.getElementById('b');",
  "var o=document.getElementById('o');",
  "var u=document.getElementById('u');",
  "var ref=document.getElementById('ref');",
  "var links=document.getElementById('links');",
  "var su=document.getElementById('su');",
  "var pb=document.getElementById('pb');",
  "var v=document.getElementById('v');",
  "var perr=document.getElementById('perr');",
  "var hlsInst=null;",
  "var hlsLoading=null;",
  "function setErr(m){perr.textContent=m||'';}",
  "function loadHls(){",
  "  if(window.Hls) return Promise.resolve();",
  "  if(hlsLoading) return hlsLoading;",
  "  hlsLoading=new Promise(function(res,rej){",
  "    var s=document.createElement('script');",
  "    s.src='https://cdn.jsdelivr.net/npm/hls.js@1';",
  "    s.onload=function(){res();};",
  "    s.onerror=function(){rej(new Error('Could not load hls.js'));};",
  "    document.head.appendChild(s);",
  "  });",
  "  return hlsLoading;",
  "}",
  "function kind(url){",
  "  var p=url.toLowerCase().split('?')[0].split('#')[0];",
  "  if(p.endsWith('.m3u8')) return 'hls';",
  "  if(p.endsWith('.mpd')) return 'dash';",
  "  return 'file';",
  "}",
  "function playUrl(url){",
  "  setErr('');",
  "  if(!/^https?:/i.test(url)){setErr('Enter an http(s) URL.');return;}",
  "  if(location.protocol==='https:'&&url.indexOf('http:')===0){setErr('Blocked: http stream on an https page (mixed content).');return;}",
  "  su.value=url;",
  "  if(hlsInst){hlsInst.destroy();hlsInst=null;}",
  "  v.removeAttribute('src');v.load();",
  "  var k=kind(url);",
  "  if(k==='dash'){setErr('DASH (.mpd) is not supported by this tester.');return;}",
  "  if(k==='hls'){",
  "    if(v.canPlayType('application/vnd.apple.mpegurl')){v.src=url;v.play().catch(function(){});return;}",
  "    loadHls().then(function(){",
  "      if(!window.Hls||!window.Hls.isSupported()){setErr('HLS is not supported in this browser.');return;}",
  "      hlsInst=new window.Hls();",
  "      hlsInst.on(window.Hls.Events.ERROR,function(ev,d){",
  "        if(d&&d.fatal){setErr('HLS error: '+d.type+' / '+d.details+' (often CORS or Referer required by the source)');}",
  "      });",
  "      hlsInst.loadSource(url);",
  "      hlsInst.attachMedia(v);",
  "      v.play().catch(function(){});",
  "    }).catch(function(e){setErr(String(e));});",
  "    return;",
  "  }",
  "  v.src=url;",
  "  v.play().catch(function(){});",
  "}",
  "v.addEventListener('error',function(){setErr('Playback error. The source may need a Referer, block hotlinking, or use an unsupported codec.');});",
  "pb.addEventListener('click',function(){playUrl(su.value.trim());});",
  "function renderLinks(urls){",
  "  links.textContent='';",
  "  urls.forEach(function(x){",
  "    var row=document.createElement('div');row.className='row';",
  "    var btn=document.createElement('button');btn.className='small';btn.textContent='Play';",
  "    btn.addEventListener('click',function(){playUrl(x);v.scrollIntoView({behavior:'smooth'});});",
  "    var t=document.createElement('span');t.textContent=x;",
  "    row.appendChild(btn);row.appendChild(t);links.appendChild(row);",
  "  });",
  "}",
  "b.addEventListener('click',function(){",
  "  var val=u.value.trim();",
  "  if(!val){o.textContent='Enter a URL first.';return;}",
  "  b.disabled=true;o.textContent='Working (can take up to ~40s)...';links.textContent='';",
  "  var payload={url:val};",
  "  if(ref.value.trim()) payload.referer=ref.value.trim();",
  "  fetch('/extract',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})",
  "    .then(function(r){return r.text();})",
  "    .then(function(t){",
  "      o.textContent=t;",
  "      try{var j=JSON.parse(t);if(j&&j.media_urls&&j.media_urls.length) renderLinks(j.media_urls);}catch(e){}",
  "    })",
  "    .catch(function(e){o.textContent='Request failed: '+e;})",
  "    .then(function(){b.disabled=false;});",
  "});",
  "</script>",
  "</body></html>",
].join("\n");

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(HTML, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (request.method === "POST" && url.pathname === "/extract") {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json({ ok: false, error: "Body must be JSON: {\"url\":\"https://...\"}" }, 400);
      }
      const target = parseTarget(body && body.url);
      if (!target) {
        return json({ ok: false, error: "Invalid or disallowed URL. Use a public http(s) URL." }, 400);
      }
      let referer;
      if (body && body.referer) {
        referer = parseTarget(body.referer);
        if (!referer) {
          return json({ ok: false, error: "Invalid referer URL." }, 400);
        }
      }
      if (!env.BROWSER) {
        return json({ ok: false, error: "BROWSER binding is missing in wrangler.toml." }, 500);
      }
      try {
        const result = await extract(env, target, referer);
        return json(result, 200);
      } catch (e) {
        return json(
          { ok: false, input_url: target, error: String(e && e.message ? e.message : e).slice(0, 500) },
          500
        );
      }
    }

    return json({ ok: false, error: "Not found" }, 404);
  },
};
