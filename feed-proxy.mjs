/**
 * PEAK — feed proxy
 * ---------------------------------------------------------------------------
 * The browser cannot talk to pump.fun directly:
 *   1. CORS — the upstream APIs do not send Access-Control-Allow-Origin.
 *   2. Secrets — provider API keys must never ship in front-end code.
 *   3. Shape — upstream payloads are large and differently shaped per provider.
 *
 * This tiny server sits in between. It polls your chosen upstream, normalises
 * the response to the contract the PEAK front end expects, and serves it with
 * CORS enabled.
 *
 *   Contract served at GET /peak-feed
 *   {
 *     "marketCapUsd": 148230,
 *     "priceUsd":     0.00014823,
 *     "buys":         412,
 *     "sells":        97,
 *     "holders":      380,
 *     "ts":           1758554400000
 *   }
 *
 * ---------------------------------------------------------------------------
 * WHICH UPSTREAM?
 * ---------------------------------------------------------------------------
 * pump.fun has no official public data API. Two legitimate routes:
 *
 *   A) A commercial indexer — recommended. Stable, documented, has a WebSocket
 *      stream and an SLA. Examples: SolanaTracker (solana-tracker.io/pumpfun-api),
 *      Bitquery (docs.bitquery.io/docs/blockchain/Solana/Pumpfun/).
 *
 *   B) Reverse-engineered endpoints. There are public repos documenting
 *      pump.fun's internal HTTP API. They work until they don't — they break
 *      without notice and may conflict with the platform's terms. Fine for a
 *      hackathon, wrong for a product.
 *
 * Set PEAK_UPSTREAM to whichever you pick, then implement `mapUpstream()` for
 * its response shape. A worked example for a generic indexer is included below.
 *
 * ---------------------------------------------------------------------------
 * RUN
 * ---------------------------------------------------------------------------
 *   node feed-proxy.mjs                       # mock mode, no key needed
 *   PEAK_MINT=<mint> PEAK_UPSTREAM=<url> PEAK_API_KEY=<key> node feed-proxy.mjs
 *
 * Then in the PEAK UI: Feed setup -> endpoint http://localhost:8787/peak-feed
 *                      -> click "Live".
 *
 * No dependencies. Node 18+ (uses global fetch).
 */

import http from 'node:http';

const PORT      = Number(process.env.PORT || 8787);
const MINT      = process.env.PEAK_MINT || '';
const UPSTREAM  = process.env.PEAK_UPSTREAM || '';
const API_KEY   = process.env.PEAK_API_KEY || '';
const POLL_MS   = Number(process.env.PEAK_POLL_MS || 2000);
const MODE      = UPSTREAM && MINT ? 'live' : 'mock';

/* -------------------------------------------------------------------------
   Upstream mapping
   -------------------------------------------------------------------------
   Every provider names things differently. Normalise here.
   Adjust the field paths to match your provider's response.
   ------------------------------------------------------------------------- */
function mapUpstream(raw){
  /* Example shape for a generic Solana indexer. Replace the paths below with
     the real ones from your provider's docs. The optional-chaining means a
     wrong path degrades to `undefined` rather than throwing. */
  const t = raw?.data?.token ?? raw?.token ?? raw?.data ?? raw ?? {};

  return {
    marketCapUsd: num(
      t.marketCap?.usd ??
      t.market_cap ??
      t.mcap ??
      t.usdMarketCap
    ),
    priceUsd: num(
      t.price?.usd ??
      t.priceUsd ??
      t.price
    ),
    buys: num(t.txns?.buys ?? t.buys ?? t.buyCount) ?? 0,
    sells: num(t.txns?.sells ?? t.sells ?? t.sellCount) ?? 0,
    holders: num(t.holders ?? t.holderCount ?? t.holder_count) ?? 0,
    /* SOL volume, if the provider exposes it */
    buySol: num(
      t.volume?.buySOL ??
      t.volumeSol?.buy ??
      t.buyVolumeSol ??
      t.buy_volume_sol ??
      t.buySOL
    ),
    sellSol: num(
      t.volume?.sellSOL ??
      t.volumeSol?.sell ??
      t.sellVolumeSol ??
      t.sell_volume_sol ??
      t.sellSOL
    ),
    ts: Date.now()
  };
}

function num(v){
  if (v == null) return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/* -------------------------------------------------------------------------
   Mock upstream — lets you run the proxy with no key at all
   ------------------------------------------------------------------------- */
const mock = {
  mc: 12000,
  buys: 0,
  sells: 0,
  holders: 42,
  buySol: 0,
  sellSol: 0
};

function mockFrame(){
  const vol = 0.008 + Math.random() * 0.02;
  const dir = Math.random() < 0.56 ? 1 : -1;
  mock.mc = Math.max(2500, mock.mc * (1 + vol * dir));
  const dbuys  = Math.random() < 0.72 ? 1 + ((Math.random() * 3) | 0) : 0;
  const dsells = Math.random() < 0.4  ? 1 + ((Math.random() * 2) | 0) : 0;
  mock.buys  += dbuys;
  mock.sells += dsells;
  /* trade sizes in SOL, occasional whale on the buy side */
  mock.buySol  += dbuys  * (0.05 + Math.random() * 0.6) + (Math.random() < 0.06 ? 1.5 + Math.random() * 4 : 0);
  mock.sellSol += dsells * (0.05 + Math.random() * 0.5);
  mock.holders += Math.random() < 0.25 ? 1 + ((Math.random() * 4) | 0) : 0;

  return {
    marketCapUsd: Math.round(mock.mc),
    priceUsd: mock.mc / 1e9,
    buys: mock.buys,
    sells: mock.sells,
    holders: mock.holders,
    buySol: +mock.buySol.toFixed(3),
    sellSol: +mock.sellSol.toFixed(3),
    ts: Date.now()
  };
}

/* -------------------------------------------------------------------------
   Latest frame cache
   ------------------------------------------------------------------------- */
let latest = { marketCapUsd: 0, priceUsd: 0, buys: 0, sells: 0, holders: 0, buySol: 0, sellSol: 0, ts: 0 };
let upstreamOk = false;
let upstreamErr = null;

async function pull(){
  if (MODE === 'mock'){
    latest = mockFrame();
    upstreamOk = true;
    return;
  }
  try {
    const url = UPSTREAM.replaceAll('{mint}', encodeURIComponent(MINT));
    const res = await fetch(url, {
      headers: API_KEY ? { Authorization: `Bearer ${API_KEY}`, 'X-API-KEY': API_KEY } : {},
      cache: 'no-store'
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    latest = mapUpstream(await res.json());
    upstreamOk = true;
    upstreamErr = null;
  } catch (err){
    upstreamOk = false;
    upstreamErr = String(err.message || err);
    console.error('[peak] upstream error:', upstreamErr);
  }
}

pull();
setInterval(pull, POLL_MS);

/* -------------------------------------------------------------------------
   HTTP server
   ------------------------------------------------------------------------- */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'no-store'
};

http.createServer((req, res) => {
  /* A malformed Host header ("Host: a:b:c") or an absolute-form request line
     makes `new URL` throw. An uncaught throw inside a request handler is not
     caught by Node — it terminates the process, so a single bad request would
     take the feed down for every connected browser. Answer 400 and stay up. */
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    res.writeHead(400, CORS);
    return res.end('bad request');
  }

  if (req.method === 'OPTIONS'){
    res.writeHead(204, CORS);
    return res.end();
  }

  if (url.pathname === '/peak-feed'){
    res.writeHead(upstreamOk ? 200 : 502, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(
      upstreamOk ? latest : { error: upstreamErr || 'upstream unavailable', ...latest }
    ));
  }

  if (url.pathname === '/health'){
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      mode: MODE, mint: MINT || null, upstreamOk, upstreamErr, pollMs: POLL_MS, latest
    }));
  }

  res.writeHead(404, CORS);
  res.end('not found');
}).listen(PORT, () => {
  console.log(`PEAK feed proxy on http://localhost:${PORT}/peak-feed`);
  console.log(`  mode:     ${MODE}`);
  if (MODE === 'live'){
    console.log(`  mint:     ${MINT}\n  upstream: ${UPSTREAM}`);
    if (!UPSTREAM.includes('{mint}'))
      console.warn('  warning:  PEAK_UPSTREAM has no {mint} placeholder — the mint will not be sent upstream');
  } else {
    console.log('  no PEAK_MINT/PEAK_UPSTREAM set — serving mock data');
    if (MINT || UPSTREAM)
      console.warn(`  warning:  live mode needs BOTH PEAK_MINT and PEAK_UPSTREAM ` +
                   `(got mint=${MINT ? 'yes' : 'no'}, upstream=${UPSTREAM ? 'yes' : 'no'}) — serving mock`);
  }
});
