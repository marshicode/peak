import { addressProblem } from "../lib/base58.js";

/**
 * /api/verify-ca — is this contract address real, and is it safe to publish?
 *
 * WHY THIS EXISTS
 *
 * The CA is the single most consequential string on the site: it is what people
 * copy before they trade. Everything else on the page can be wrong and cost
 * nothing, but a mistyped or malicious mint sends someone's money to the wrong
 * token. The CHECK constraint in schema/001_settings.sql catches a CA that is
 * not base58; it cannot catch one that is well-formed but belongs to a
 * different token, or one whose deployer still holds mint authority.
 *
 * So the panel asks the chain before it publishes. This endpoint takes a mint
 * and answers from the shared Helius endpoint:
 *
 *   - does the account exist at all
 *   - is it an SPL mint (and not, say, a wallet or a token ACCOUNT)
 *   - decimals and supply, so the operator can sanity-check the market cap
 *   - whether mint and freeze authority have been revoked
 *   - how concentrated the top holders are, when the endpoint will say
 *
 * The authority checks are the ones worth having. An active mint authority
 * means the deployer can inflate the supply after launch; an active freeze
 * authority means they can freeze a holder's tokens. Both are ordinary rug
 * mechanics and both are invisible from the address alone.
 *
 * The holder lookup is best-effort and frequently unavailable — the shared
 * Helius key refuses getTokenLargestAccounts. When that happens the response
 * says so explicitly (holdersUnavailable) rather than reporting zero holders,
 * because "we could not look" and "there are none" are different facts and
 * only one of them is reassuring.
 *
 * WHY IT IS NOT PUBLIC
 *
 * The RPC URL carries a paid API key, so this is behind the admin secret. An
 * open version would be a free proxy for anyone to spend the operator's Helius
 * quota.
 *
 *   POST /api/verify-ca     x-admin-secret required
 *        { "ca": "<base58 mint>" }
 *
 * Responses:
 *   200 { ok: true,  mint: {...}, holders: {...}|null, warnings: [...] }
 *   200 { ok: false, reason: "not_found" | "not_a_mint", ... }
 *   400 { error }               the body is not usable
 *   401 { error }               wrong or missing admin secret
 *   405 { error }               method not allowed
 *   500 { error: "not_configured", missing: [...] }
 *   502 { error }               the RPC refused or timed out
 */

/** The two token programs. A mint is owned by one of them. */
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** `res.status().json()` is a Vercel convenience, not Node — see api/settings.js. */
function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

/**
 * Shift a base-unit integer string by `decimals` without going through a float.
 *
 * `Number(supply) / 10**decimals` is fine for a human reading a number and wrong
 * for anything compared against another number: a supply of 8136055382940217 at
 * 6 decimals is 8136055382.940217, and a double cannot hold that. Since this
 * value is what the operator uses to judge whether the market cap makes sense,
 * it is computed on the string.
 */
function uiAmount(supply, decimals) {
  const s = String(supply ?? "0");
  const d = Number(decimals) || 0;
  if (d === 0) return s;
  const neg = s.startsWith("-");
  const digits = (neg ? s.slice(1) : s).padStart(d + 1, "0");
  const whole = digits.slice(0, digits.length - d);
  const frac = digits.slice(digits.length - d).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

/** A JSON-RPC call. One place, so the timeout and the error shape are shared. */
async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`rpc http ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message || `rpc error ${body.error.code}`);
  return body.result;
}

/**
 * The RPC to use: the environment first, then the published column.
 *
 * Environment wins so an operator can override without touching the database,
 * and the column is the fallback so the admin panel's field is not decorative.
 */
async function rpcUrl(config) {
  const fromEnv = (process.env.RPC_URL || process.env.VITE_RPC_URL || "").trim();
  if (fromEnv) return fromEnv;
  if (!config.url || !config.key) return "";
  try {
    const res = await fetch(`${config.url}/rest/v1/peak_settings?id=eq.true&select=rpc_url`, {
      headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return "";
    const rows = await res.json().catch(() => []);
    return (rows?.[0]?.rpc_url || "").trim();
  } catch {
    return "";
  }
}

function config() {
  return {
    secret: process.env.ADMIN_SECRET,
    url: (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, ""),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

async function readBody(req) {
  let body = req.body;
  if (body === undefined) {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    body = raw;
  }
  if (typeof body === "string") return body ? JSON.parse(body) : {};
  return body;
}

export default async function handler(req, res) {
  const cfg = config();

  if (!cfg.secret) {
    sendJson(res, 500, { error: "not_configured", missing: ["ADMIN_SECRET"] });
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { error: "POST only" });
    return;
  }

  if (req.headers["x-admin-secret"] !== cfg.secret) {
    sendJson(res, 401, { error: "wrong admin secret" });
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    sendJson(res, 400, { error: "Body was not valid JSON." });
    return;
  }

  const ca = String(body?.ca ?? "").trim().replace(/^\$/, "");
  if (!ca) { sendJson(res, 400, { error: "ca is required" }); return; }
  const problem = addressProblem(ca);
  if (problem) {
    /* The same rule the table enforces, but here we can say what is wrong with
       it. A mistyped character and a truncated paste need different fixes. */
    sendJson(res, 400, { error: `not a valid Solana address — ${problem}` });
    return;
  }

  const url = await rpcUrl(cfg);
  if (!url) {
    sendJson(res, 500, {
      error: "not_configured",
      missing: ["RPC_URL (or a published rpc_url)"],
      hint: "set RPC_URL in the environment, or publish one from the panel",
    });
    return;
  }

  try {
    /*
     * Both calls at once. The holder lookup is the expensive one and is allowed
     * to fail on its own — knowing the mint is real is the answer that matters,
     * and a mint with no holders yet is a normal state for a pre-launch token,
     * not an error worth failing the whole request over.
     *
     * It fails more often than you would expect: the shared Helius key answers
     * getTokenLargestAccounts with "Too many accounts requested (10000000
     * pubkeys)", which is the gateway refusing the METHOD rather than a real
     * complaint about this mint. The reason is carried through to the response
     * instead of being swallowed, so the panel can say "unavailable" rather
     * than implying the token has no holders.
     */
    const [account, largestResult] = await Promise.all([
      rpc(url, "getAccountInfo", [ca, { encoding: "jsonParsed" }]),
      rpc(url, "getTokenLargestAccounts", [ca]).then(
        (value) => ({ value }),
        (err) => ({ error: String(err?.message || err) }),
      ),
    ]);

    const value = account?.value;
    if (!value) {
      sendJson(res, 200, { ok: false, reason: "not_found", ca });
      return;
    }

    const isTokenProgram = value.owner === TOKEN_PROGRAM || value.owner === TOKEN_2022;
    const parsed = value.data?.parsed;
    if (!isTokenProgram || parsed?.type !== "mint") {
      sendJson(res, 200, {
        ok: false,
        reason: "not_a_mint",
        ca,
        /* Naming what it IS turns "wrong address" into a fixable message: a
           token ACCOUNT is the mistake people actually make, because that is
           what a wallet shows you. */
        ownerProgram: value.owner,
        looksLike: parsed?.type === "account" ? "a token account, not a mint" : "not an SPL token mint",
      });
      return;
    }

    const info = parsed.info || {};
    const decimals = Number(info.decimals) || 0;
    const supply = String(info.supply ?? "0");
    const uiSupply = uiAmount(supply, decimals);

    const warnings = [];
    if (info.mintAuthority) {
      warnings.push("mint authority is still active — the deployer can create more supply at any time");
    }
    if (info.freezeAuthority) {
      warnings.push("freeze authority is still active — the deployer can freeze a holder's tokens");
    }

    /* Holder concentration, when the endpoint will give it to us. */
    let holders = null;
    let holdersUnavailable = null;
    if (largestResult?.value?.length) {
      const top = largestResult.value.slice(0, 10).map((a) => ({
        address: a.address,
        uiAmount: a.uiAmount,
        share: Number(uiSupply) > 0 ? Number((a.uiAmount / Number(uiSupply)).toFixed(6)) : 0,
      }));
      const topShare = top.reduce((sum, h) => sum + (h.share || 0), 0);
      holders = { top, topShare: Number(topShare.toFixed(6)) };
      if (topShare > 0.5) {
        warnings.push(`top 10 accounts hold ${(topShare * 100).toFixed(1)}% of supply`);
      }
    } else {
      holdersUnavailable = largestResult?.error || "the endpoint returned no holder data";
    }

    sendJson(res, 200, {
      ok: true,
      ca,
      mint: {
        decimals,
        supply,
        uiSupply,
        mintAuthority: info.mintAuthority || null,
        freezeAuthority: info.freezeAuthority || null,
        ownerProgram: value.owner,
        program: value.owner === TOKEN_2022 ? "token-2022" : "spl-token",
        isInitialized: info.isInitialized !== false,
      },
      holders,
      /* Present only when the lookup could not be made. Absent means "we looked
         and it is genuinely empty", which is a different fact. */
      holdersUnavailable,
      warnings,
    });
  } catch (err) {
    const msg = String(err?.message || err);
    /* The node rejecting the ADDRESS is bad input, not a bad gateway. Reporting
       it as 502 would send the operator looking at the RPC when the fix is in
       the field they just typed into. */
    if (/invalid param|wrongsize|invalid base58/i.test(msg)) {
      sendJson(res, 400, { error: `the RPC rejected this address — ${msg}` });
      return;
    }
    sendJson(res, 502, { error: msg });
  }
}
