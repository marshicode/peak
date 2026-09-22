import { addressProblem } from "../lib/base58.js";

/**
 * /api/settings — the settings that change what a VISITOR sees.
 *
 * WHY THIS EXISTS
 *
 * The contract address used to be a constant inside index.html, so putting the
 * CA on the site meant editing source, committing, deploying and waiting — on a
 * site that is already live. Every label, both banner copy variants and the two
 * social links had the same problem.
 *
 * They now live in the database and are written here, where the two secrets are:
 *
 *   ADMIN_SECRET                 the operator's passphrase, sent as a header
 *   SUPABASE_SERVICE_ROLE_KEY    bypasses RLS on peak_settings
 *
 * The table has no anon INSERT or UPDATE policy (see schema/001_settings.sql),
 * so a direct browser write fails even for someone who reads the anon key out of
 * the page. Rewriting the contract address is the most damaging thing anyone
 * could do to this site — it is what people copy before they trade — so it is
 * the last thing that should be reachable from a public bundle.
 *
 *   GET   /api/settings          public. Returns the row, or null.
 *                                Only PUBLIC_COLUMNS — see the note there on
 *                                why `rpc_url` is not among them. A GET that
 *                                carries x-admin-secret returns the full row.
 *   POST  /api/settings          x-admin-secret required.
 *         { "settings": { ca?, tokenSymbol?, ... } }
 *
 * Only the keys present are written — this is a PATCH, not a replace. A partial
 * body must not zero the settings it did not mention, which is exactly what a
 * naive full-row upsert would do. An empty STRING is different from an absent
 * key: it means "clear this override", and is written as NULL.
 *
 * Responses:
 *   200 { ok: true, settings }   written (POST) / read (GET)
 *   400 { error }                the body is not usable
 *   401 { error }                wrong or missing admin secret
 *   405 { error }                method not allowed
 *   500 { error: "not_configured", missing: [...] }
 *   502 { error }                Supabase refused the write
 */

/**
 * The CA is the one field where "roughly right" is not good enough — see
 * lib/base58.js for why a length regex accepts addresses that do not exist.
 */
function isMint(v) {
  return addressProblem(v) === null;
}

/**
 * `res.status(400).json(...)` is a Vercel convenience and NOT part of Node's API.
 * Vite's dev and preview servers mount this as connect middleware and hand it a
 * bare ServerResponse, where `res.status` is undefined and the call throws —
 * which takes the whole preview server down, not just the request.
 */
function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

/** Trim, drop empties. A blank field means "clear it", not "leave it". */
const str = (v) => (v == null ? "" : String(v).trim());

/**
 * Everything the operator may publish, and how to check it.
 *
 * Table-driven so that adding a field is one line here plus one column in the
 * schema, rather than another copy of the same six lines of validation.
 *
 * `max` mirrors the CHECK constraint in schema/001_settings.sql. Both are
 * enforced: the API gives the operator a useful message, the table makes the
 * limit true even if this file has a bug.
 */
const FIELDS = {
  ca:           { col: "ca",             kind: "mint" },
  tokenSymbol:  { col: "token_symbol",   kind: "symbol" },
  tokenName:    { col: "token_name",     kind: "name",   max: 24 },
  pumpUrl:      { col: "pump_url",       kind: "url" },
  xUrl:         { col: "x_url",          kind: "url" },
  feedUrl:      { col: "feed_url",       kind: "feed" },
  rpcUrl:       { col: "rpc_url",        kind: "url" },
  copySafeHead: { col: "copy_safe_head", kind: "text",   max: 40 },
  copySafeBody: { col: "copy_safe_body", kind: "text",   max: 240 },
  copySafeSub:  { col: "copy_safe_sub",  kind: "text",   max: 160 },
  copyHypeHead: { col: "copy_hype_head", kind: "text",   max: 40 },
  copyHypeBody: { col: "copy_hype_body", kind: "text",   max: 240 },
  copyHypeSub:  { col: "copy_hype_sub",  kind: "text",   max: 160 },
  ladderNote:   { col: "ladder_note",    kind: "text",   max: 300 },
};

/**
 * The columns a VISITOR may see.
 *
 * This is an allow-list, not a deny-list, and that direction is deliberate: a
 * new column added to the table is private until somebody writes it down here.
 * The other way round, a new column is public the moment it is created — which
 * is how a secret ends up on a public endpoint.
 *
 * `rpc_url` is excluded because the shared endpoint is Helius and the URL
 * carries the paid API key in its query string. The page never reads this
 * column, so serving it would only ever leak it. The operator still sees it:
 * a GET carrying the admin secret returns the full row.
 *
 * `updated_by` is excluded because it is an internal note ("who published
 * this"), not something a visitor has any use for.
 */
const PUBLIC_COLUMNS = [
  "id",
  "ca", "token_symbol", "token_name",
  "pump_url", "x_url", "feed_url",
  "copy_safe_head", "copy_safe_body", "copy_safe_sub",
  "copy_hype_head", "copy_hype_body", "copy_hype_sub",
  "ladder_note",
  "updated_at",
];

/**
 * Validate one field and return the column value (or null to clear).
 *
 * Hard validation because these values are rendered to the public and the CA is
 * pasted into a link. A mint that is not base58 becomes a dead pump.fun button;
 * a `javascript:` URL in a social link is a script the operator did not mean to
 * publish. The page renders every one of these with textContent, so a stored
 * string cannot become markup — but a URL is followed by the browser whatever
 * the page does, which is why the scheme is checked here.
 */
function coerce(key, spec, raw) {
  const s = str(raw);
  const label = key;

  /* Absent-but-present-as-empty clears the override. */
  if (!s) return { col: spec.col, value: null };

  switch (spec.kind) {
    case "mint": {
      const v = s.replace(/^\$/, "");
      const problem = addressProblem(v);
      if (problem) throw new Error(`${label} is not a valid Solana mint address — ${problem}`);
      return { col: spec.col, value: v };
    }
    case "symbol": {
      /* Accept "$PEAK" and "PEAK" — the page adds the dollar sign itself, so
         storing it would render "$$PEAK". */
      const v = s.replace(/^\$/, "");
      if (!/^[A-Za-z0-9]{1,10}$/.test(v)) {
        throw new Error(`${label} must be 1-10 letters or digits (the $ is added for you)`);
      }
      return { col: spec.col, value: v };
    }
    case "name": {
      if (s.length > spec.max) throw new Error(`${label} must be at most ${spec.max} characters`);
      /* Rendered with textContent, so this is belt-and-braces rather than the
         thing that stops an injection. Cheap, and it keeps the data clean. */
      if (s.includes("<") || s.includes(">")) throw new Error(`${label} cannot contain < or >`);
      return { col: spec.col, value: s };
    }
    case "url": {
      if (s.length > 300) throw new Error(`${label} is too long`);
      let u;
      try { u = new URL(s); } catch { throw new Error(`${label} is not a URL`); }
      if (u.protocol !== "https:") throw new Error(`${label} must start with https://`);
      return { col: spec.col, value: u.toString() };
    }
    case "feed": {
      if (s.length > 300) throw new Error(`${label} is too long`);
      let u;
      try { u = new URL(s); } catch { throw new Error(`${label} is not a URL`); }
      if (!["https:", "http:", "wss:", "ws:"].includes(u.protocol)) {
        throw new Error(`${label} must be http(s) or ws(s)`);
      }
      /* Store the OPERATOR'S string, not `u.toString()`.
         `new URL().toString()` percent-encodes the braces in `{mint}` to
         `%7Bmint%7D`, and api/feed.js substitutes on the literal token — so the
         placeholder was destroyed at publish time and the proxy called an
         upstream URL containing `%7Bmint%7D`, which no provider understands.
         The parsed URL is used for VALIDATION only; the scheme is checked above
         and the column's CHECK constraint re-checks it. */
      return { col: spec.col, value: s };
    }
    case "text": {
      if (s.length > spec.max) {
        throw new Error(`${label} must be at most ${spec.max} characters (got ${s.length})`);
      }
      /* Control characters would let a stored value break the page's layout in
         ways the operator cannot see in the preview. */
      const v = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
      return { col: spec.col, value: v };
    }
    default:
      throw new Error(`unknown field type for ${label}`);
  }
}

/**
 * Returns a row containing ONLY the columns present in the input.
 */
function parseSettings(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("settings must be an object");
  }
  const row = {};
  let touched = 0;

  for (const [key, spec] of Object.entries(FIELDS)) {
    if (!(key in raw)) continue;
    const { col, value } = coerce(key, spec, raw[key]);
    row[col] = value;
    touched++;
  }

  if (!touched) throw new Error("no settings to write");
  return row;
}

/** The env this endpoint needs, or the list of what is missing. */
function config() {
  return {
    secret: process.env.ADMIN_SECRET,
    url: (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, ""),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

/** Read the raw body, whether Vercel parsed it already or this is plain Node. */
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
  const { secret, url, key } = config();

  if (!secret || !url || !key) {
    const missing = [
      !secret && "ADMIN_SECRET",
      !url && "SUPABASE_URL (or VITE_SUPABASE_URL)",
      !key && "SUPABASE_SERVICE_ROLE_KEY",
    ].filter(Boolean);
    sendJson(res, 500, { error: "not_configured", missing });
    return;
  }

  const auth = { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" };
  const table = `${url}/rest/v1/peak_settings`;

  /* ---- read. Public by default, but the COLUMNS depend on who is asking:
     without the secret, only the columns the page renders; with it, the whole
     row so the panel can show what is currently published. ---- */
  if (req.method === "GET") {
    const isOperator = req.headers["x-admin-secret"] === secret;
    const select = isOperator ? "*" : PUBLIC_COLUMNS.join(",");
    try {
      const upstream = await fetch(`${table}?id=eq.true&limit=1&select=${select}`, { headers: auth });
      if (!upstream.ok) {
        sendJson(res, 502, { error: `supabase responded ${upstream.status}` });
        return;
      }
      const rows = await upstream.json().catch(() => []);
      sendJson(res, 200, { ok: true, settings: Array.isArray(rows) ? rows[0] || null : null });
    } catch (err) {
      sendJson(res, 502, { error: String(err?.message || err) });
    }
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    sendJson(res, 405, { error: "GET or POST only" });
    return;
  }

  if (req.headers["x-admin-secret"] !== secret) {
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

  let row;
  try {
    row = parseSettings(body?.settings);
  } catch (err) {
    sendJson(res, 400, { error: String(err?.message || err) });
    return;
  }

  row.id = true;
  row.updated_at = new Date().toISOString();
  row.updated_by = String(req.headers["x-admin-note"] || "operator").slice(0, 60);

  try {
    /*
     * UPSERT rather than PATCH, and the difference matters: a PATCH against a row
     * that is not there affects zero rows and returns 200 with an empty body, so a
     * missing seed would look like a successful publish that changed nothing.
     * merge-duplicates inserts when the row is absent and merges when it is not,
     * keyed on the primary key.
     */
    const upstream = await fetch(`${table}?on_conflict=id`, {
      method: "POST",
      headers: {
        ...auth,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(row),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      sendJson(res, 502, { error: `supabase responded ${upstream.status}`, detail: detail.slice(0, 300) });
      return;
    }

    const saved = await upstream.json().catch(() => []);
    sendJson(res, 200, { ok: true, settings: Array.isArray(saved) ? saved[0] || null : null });
  } catch (err) {
    sendJson(res, 502, { error: String(err?.message || err) });
  }
}
