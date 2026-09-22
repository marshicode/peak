/**
 * /api/feed — the live market feed, driven by the published CA.
 *
 * WHY THIS EXISTS
 *
 * feed-proxy.mjs reads its mint from PEAK_MINT at process start. That is fine
 * for local development and wrong for a deployed site: the operator pastes a CA
 * into the admin panel, and the feed would still be polling whatever mint the
 * environment was configured with — so "no redeploy" would be true of the label
 * and false of the data.
 *
 * This reads the mint and the upstream URL out of the peak_settings row instead,
 * so publishing a CA moves the feed with it. The env vars remain as a fallback
 * for a deployment that has not published anything yet.
 *
 *   GET /api/feed      the normalised frame the page expects
 *   GET /api/feed?health=1   mode, mint, upstream status, cache ages
 *
 * The frame contract is the same one feed-proxy.mjs serves:
 *   { marketCapUsd, priceUsd, buys, sells, holders, buySol?, sellSol?, ts }
 *
 * STATELESSNESS
 *
 * A serverless function has no background loop to poll into, so each request
 * pulls. Two module-scope caches keep that from becoming one upstream call per
 * browser per poll: the settings row is held for a few seconds and the frame for
 * one. Both survive only while the instance is warm, which is exactly what a
 * cache should assume.
 */

const SETTINGS_TTL_MS = 15_000;
const FRAME_TTL_MS = 1_000;
const UPSTREAM_TIMEOUT_MS = 6_000;

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(JSON.stringify(payload));
}

function num(v) {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Every provider names things differently. Normalise here.
 *
 * The optional chaining means a wrong path degrades to `undefined` rather than
 * throwing, so a provider that renames a field yields a frame with a missing
 * number instead of a 500. Adjust the paths to match your provider's docs.
 */
function mapUpstream(raw) {
  const t = raw?.data?.token ?? raw?.token ?? raw?.data ?? raw ?? {};
  /* Each chain ends with the frame's OWN field names.
     The frame contract documented in README/INTEGRATION is
     { marketCapUsd, priceUsd, buys, sells, holders, buySol?, sellSol? }, so an
     upstream that already speaks it — another instance of this proxy, a
     self-hosted feed-proxy.mjs, a hand-rolled endpoint — must map cleanly.
     Without these the proxy answered such an upstream with a frame full of
     holes, which is indistinguishable from a provider outage. Provider-native
     names stay first so they still win. */
  return {
    marketCapUsd: num(t.marketCap?.usd ?? t.market_cap ?? t.mcap ?? t.usdMarketCap ?? t.marketCapUsd),
    priceUsd: num(t.price?.usd ?? t.priceUsd ?? t.price),
    buys: num(t.txns?.buys ?? t.buys ?? t.buyCount) ?? 0,
    sells: num(t.txns?.sells ?? t.sells ?? t.sellCount) ?? 0,
    holders: num(t.holders ?? t.holderCount ?? t.holder_count) ?? 0,
    buySol: num(t.volume?.buySOL ?? t.volumeSol?.buy ?? t.buyVolumeSol ?? t.buy_volume_sol ?? t.buySOL ?? t.buySol),
    sellSol: num(t.volume?.sellSOL ?? t.volumeSol?.sell ?? t.sellVolumeSol ?? t.sell_volume_sol ?? t.sellSOL ?? t.sellSol),
    ts: Date.now(),
  };
}

/** Strip an API key out of a URL before it goes into a diagnostic. Keeps the
 *  `?`/`&` separator, so the redacted URL still parses as a URL. */
const redact = url => String(url ?? "").replace(/([?&])(api[-_]?key|apikey)=[^&]*/gi, "$1$2=…");

/* The fields the page cannot work without. buys/sells/holders default to 0 and
   buySol/sellSol are optional, so a missing one of those is a gap rather than a
   breakage — but a missing market cap means the mountain cannot move at all. */
const REQUIRED_FIELDS = ["marketCapUsd", "priceUsd"];

/**
 * What the upstream actually sent, for `?health=1`.
 *
 * A provider that names things differently yields a frame with holes in it, and
 * the page then shows dashes with nothing anywhere to explain why. Handing the
 * operator the upstream's own top-level keys is the difference between "the feed
 * is broken" and "mapUpstream needs another path" — which is the question they
 * will actually be asking, on launch day, with the site already live.
 */
function shapeOf(raw, frame) {
  const t = raw?.data?.token ?? raw?.token ?? raw?.data ?? raw ?? {};
  const keys = (t && typeof t === "object" && !Array.isArray(t))
    ? Object.keys(t).slice(0, 40) : [];
  const missing = REQUIRED_FIELDS.filter(k => frame[k] == null);
  return { upstreamKeys: keys, missing, mapped: missing.length === 0 };
}

/* -------------------------------------------------------------------------
   Caches
   ------------------------------------------------------------------------- */
let settingsCache = { at: 0, row: null };
let frameCache = { at: 0, frame: null };

function supabase() {
  return {
    url: (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, ""),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

/** The published settings row, cached briefly. */
async function readSettings() {
  const now = Date.now();
  if (now - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.row;

  const { url, key } = supabase();
  if (!url || !key) {
    settingsCache = { at: now, row: null };
    return null;
  }
  try {
    const upstream = await fetch(`${url}/rest/v1/peak_settings?id=eq.true&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    const rows = upstream.ok ? await upstream.json().catch(() => []) : [];
    const row = Array.isArray(rows) ? rows[0] || null : null;
    settingsCache = { at: now, row };
    return row;
  } catch {
    /* A settings read that fails must not take the feed down — fall back to env
       and let the next request try again. */
    settingsCache = { at: now, row: null };
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.end();
    return;
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    sendJson(res, 405, { error: "GET only" });
    return;
  }

  const row = await readSettings();

  /* The published CA wins. The env var is only a fallback for a deployment that
     has not published one, which keeps feed-proxy.mjs's configuration working. */
  const mint = (row?.ca || process.env.PEAK_MINT || "").trim();
  const upstreamTpl = (row?.feed_url || process.env.PEAK_UPSTREAM || "").trim();
  const apiKey = process.env.PEAK_API_KEY || "";

  const wantsHealth = /[?&]health=1\b/.test(req.url || "");

  if (!mint || !upstreamTpl) {
    sendJson(res, 200, {
      /* 200 with a zeroed frame rather than an error: the page treats a live
         feed that has nothing to say as "not launched yet", and a 502 there
         would light the feed indicator red on a site that is working. */
      marketCapUsd: 0, priceUsd: 0, buys: 0, sells: 0, holders: 0, ts: Date.now(),
      pending: true,
      reason: !mint ? "no CA published yet" : "no feed_url published yet",
      /* Health mode has to answer here too. "Nothing published yet" is the state
         an operator is most likely to be staring at, and a health endpoint that
         only replies once everything already works is not a diagnostic. */
      ...(wantsHealth ? {
        mode: "pending",
        hasMint: !!mint,
        hasUpstream: !!upstreamTpl,
        mint: mint || null,
        upstream: upstreamTpl ? redact(upstreamTpl) : null,
        settingsRowRead: !!row,
      } : {}),
    });
    return;
  }

  const now = Date.now();
  if (frameCache.frame && now - frameCache.at < FRAME_TTL_MS) {
    sendJson(res, 200, wantsHealth
      ? { ...frameCache.frame, mode: "live", cached: true, mint,
          upstream: redact(upstreamTpl.replaceAll("{mint}", encodeURIComponent(mint))) }
      : frameCache.frame);
    return;
  }

  try {
    const url = upstreamTpl.replaceAll("{mint}", encodeURIComponent(mint));
    const upstream = await fetch(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}`, "X-API-KEY": apiKey } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);

    const raw = await upstream.json();
    const frame = mapUpstream(raw);
    frameCache = { at: now, frame };

    sendJson(res, 200, wantsHealth
      ? { ...frame, mode: "live", mint, upstream: redact(url), ...shapeOf(raw, frame) }
      : frame);
  } catch (err) {
    const message = String(err?.message || err);
    /* Serve the last good frame if there is one. A provider hiccup should freeze
       the mountain, not blank it. */
    if (frameCache.frame) {
      sendJson(res, 200, {
        ...frameCache.frame, stale: true, error: message,
        /* Health mode must answer here too. "The upstream is failing and we are
           serving the last good frame" is exactly the state an operator needs to
           be able to see — and from the page it looks identical to a healthy
           feed, because the page is still showing numbers. */
        ...(wantsHealth ? {
          mode: "stale",
          mint,
          upstream: redact(upstreamTpl.replaceAll("{mint}", encodeURIComponent(mint))),
          hasApiKey: !!apiKey,
        } : {}),
      });
      return;
    }
    sendJson(res, 502, {
      error: message,
      marketCapUsd: 0, priceUsd: 0, buys: 0, sells: 0, holders: 0, ts: Date.now(),
      /* The configuration, so a 502 is actionable: "upstream 404" alongside the
         URL that was actually called is a different problem from "upstream 404"
         with no context at all. */
      ...(wantsHealth ? {
        mode: "error",
        mint,
        upstream: redact(upstreamTpl.replaceAll("{mint}", encodeURIComponent(mint))),
        hasApiKey: !!apiKey,
      } : {}),
    });
  }
}
