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
  return {
    marketCapUsd: num(t.marketCap?.usd ?? t.market_cap ?? t.mcap ?? t.usdMarketCap),
    priceUsd: num(t.price?.usd ?? t.priceUsd ?? t.price),
    buys: num(t.txns?.buys ?? t.buys ?? t.buyCount) ?? 0,
    sells: num(t.txns?.sells ?? t.sells ?? t.sellCount) ?? 0,
    holders: num(t.holders ?? t.holderCount ?? t.holder_count) ?? 0,
    buySol: num(t.volume?.buySOL ?? t.volumeSol?.buy ?? t.buyVolumeSol ?? t.buy_volume_sol ?? t.buySOL),
    sellSol: num(t.volume?.sellSOL ?? t.volumeSol?.sell ?? t.sellVolumeSol ?? t.sell_volume_sol ?? t.sellSOL),
    ts: Date.now(),
  };
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
    });
    return;
  }

  const now = Date.now();
  if (frameCache.frame && now - frameCache.at < FRAME_TTL_MS) {
    sendJson(res, 200, wantsHealth ? { ...frameCache.frame, cached: true } : frameCache.frame);
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

    const frame = mapUpstream(await upstream.json());
    frameCache = { at: now, frame };

    sendJson(res, 200, wantsHealth
      ? { ...frame, mint, upstream: url.replace(/[?&](api[-_]?key|apikey)=[^&]*/gi, "$1=…") }
      : frame);
  } catch (err) {
    const message = String(err?.message || err);
    /* Serve the last good frame if there is one. A provider hiccup should freeze
       the mountain, not blank it. */
    if (frameCache.frame) {
      sendJson(res, 200, { ...frameCache.frame, stale: true, error: message });
      return;
    }
    sendJson(res, 502, {
      error: message,
      marketCapUsd: 0, priceUsd: 0, buys: 0, sells: 0, holders: 0, ts: Date.now(),
    });
  }
}
