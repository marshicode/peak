/**
 * /api/admin-auth — check the operator's password.
 *
 * WHY THIS EXISTS, AND WHAT IT DOES NOT DO
 *
 * The admin panel is reachable by anyone who knows the URL, and the site is
 * live. So the panel asks for the password before it renders, and the check
 * happens HERE rather than in the browser. A password compared in JavaScript is
 * theatre: the page's source is public, so anyone can read the expected value
 * out of it and skip the gate. The only place a secret can be checked is the
 * server.
 *
 * WHAT IT PROTECTS, EXACTLY
 *
 * The panel's UI, not the data. Everything the panel renders is client-side, so
 * a determined person could still assemble the interface by hand — but every
 * CONSEQUENTIAL action already requires this same secret: publishing goes
 * through /api/settings, which verifies `x-admin-secret` independently. This
 * gate keeps the console out of casual view; that one keeps the database write
 * out of unauthorised hands. Neither is redundant.
 *
 * Configure with one environment variable:
 *
 *   ADMIN_SECRET   the operator's passphrase, also pasted into the panel
 *
 * A GET reports whether a secret is configured, so the lock screen can say
 * "not set up yet" rather than rejecting every password with no explanation.
 */
import crypto from "node:crypto";

/**
 * Compare two strings without leaking their contents through timing.
 *
 * `===` on a secret short-circuits at the first differing byte, so how long it
 * takes to say no depends on how much of the guess was right. Over a network
 * that is mostly noise, but the fix is three lines and this is the one place it
 * matters. Lengths are compared first because timingSafeEqual throws on a
 * mismatch, and a length difference is not itself a secret.
 */
function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ""), "utf8");
  const y = Buffer.from(String(b ?? ""), "utf8");
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/**
 * Vercel parses an `application/json` body and hands it over as `req.body`. A
 * plain Node server — which is what Vite's dev and preview middleware are — does
 * not, so the stream is read when nothing has been parsed.
 */
async function readBody(req) {
  if (req.body !== undefined) return req.body;
  let raw = "";
  try {
    for await (const chunk of req) raw += chunk;
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function sendJson(res, status, payload) {
  // `res.status()` is Express, not Node. Vite mounts this as connect middleware
  // and hands over a bare ServerResponse, so calling it takes the whole server
  // down rather than just failing the request.
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  const secret = process.env.ADMIN_SECRET;

  /* A GET says only whether a password exists, so the lock screen can explain an
     unconfigured deployment instead of rejecting every attempt silently. */
  if (req.method === "GET") {
    return sendJson(res, 200, { configured: Boolean(secret) });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  if (!secret) {
    return sendJson(res, 503, {
      error: "The admin panel is not set up: ADMIN_SECRET is unset on the server.",
      code: "admin_secret_missing",
    });
  }

  const body = await readBody(req);
  const given = (body && body.secret) || req.headers["x-admin-secret"] || "";

  if (!safeEqual(given, secret)) {
    // Deliberately the same answer for a wrong password and a missing one.
    // Saying which would tell a guesser that their guess was structurally right.
    return sendJson(res, 401, { error: "Wrong password." });
  }

  return sendJson(res, 200, { ok: true });
}
