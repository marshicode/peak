# PEAK

A launchpad visualiser where the market cap **is** Mount Everest. The climb
follows the real Southeast Ridge, south side — Base Camp, the Khumbu Icefall,
the Western Cwm, the Lhotse Face, the South Col, the summit at 8,849 m. Buy
pressure moves you up the route. Every camp you reach plants a tent, drops
confetti, and names the next stop.

The name is PEAK. The product is the mountain.

---

## Start here

Open **`index.html`** in a browser. No build, no dependencies, no server. With
nothing connected it reads *awaiting launch* and shows dashes — it does not invent
a market cap.

To watch the whole climb without a provider, open it with **`?demo=1`** and drive
the climb from the console, or point it at a feed. Scrub the day/night slider in
the bottom-right corner to watch the scene change — alpenglow at sunrise, white
light at noon, blue shadow at night.

---

## The route

| Camp | Altitude | Market cap | Graphic position |
|---|---|---|---|
| Base Camp | 5,364 m / 17,598 ft | $15k | 0.16 |
| Camp 1 | 6,065 m / 19,900 ft | $30k | 0.30 |
| Camp 2 | 6,400 m / 21,000 ft | $100k | 0.44 |
| Camp 3 | 7,200 m / 23,600 ft | $250k | 0.60 |
| Camp 4 | 7,925 m / 26,000 ft | $500k | 0.79 |
| Summit | 8,849 m / 29,032 ft | $1M | 1.00 |

The trailhead (graphic position 0) is Lukla at 2,860 m — the real start of the
trek, where the Everest flights land.

**Market cap → position is piecewise linear through the camps.** Position →
displayed altitude uses the same segments. So the number on screen always
matches the position on the mountain — at $30k you are standing on Camp 1 at
6,065 m, not at some interpolated fiction.

Everything is editable in `CONFIG` at the top of the script.

---

## What's on screen

### Production posture, and `?demo=1`

The page ships in **production posture**. These are hidden:

| Hidden | Why |
|---|---|
| Feed setup | Holds the endpoint box and the Compliant / Hype banner toggle — see `INTEGRATION.md` §4. |
| Reset | Clears the counters; not a visitor's action. |

There is **no feed mode switch**, in either posture. The feed is live and only
live: a visitor cannot put the site into a local random walk, and the code for one
is gone rather than hidden. The status indicator beside the market cap is the only
thing that says whether the numbers are real — *awaiting launch*, *polling*, or
*feed unreachable*.

The feed runs in **Live** mode. With nothing connected it says *awaiting launch*,
and every market readout shows **—** — market cap, price, altitude, buys/sells and
holders. Nothing has been measured, so nothing is reported.

That last part matters more than it sounds. The page used to show a compiled-in
`$12,000` market cap and a `$0.000012` price for a token whose own feed said
*awaiting launch*. The price was not even a stored value: it was
`marketCap / CONFIG.token.supply`, computed from that placeholder and a
hardcoded supply of one billion that nobody has checked against the real mint. A
number carrying ten decimal places reads as measured, and that one was invented
twice over. The mountain still puts the climber partway up — the scene needs a
position — but the readouts no longer present that position as data.

What stays visible is what is true without a feed: the **route** (the ladder and
the next camp) and the **summit target** in the scene HUD, because those are
properties of the climb rather than readings from a market. The route button
stays available too, because the route is public.

Open **`?demo=1`** to get the console back — the endpoint box, the poll interval,
the day/night cycle length and the Hype toggle. That is the posture for demos and
screenshots; it is the same code path, so the two cannot drift apart. Note that
`?demo=1` does **not** turn on a simulated feed: there is no longer one to turn on.

This is a client-side gate. It stops the shipped page from *offering* these,
which is what matters: anyone in devtools can edit the page's text anyway, and no
client-side gate changes that. What it does fix is that the site cannot be
screenshotted shipping Hype copy.

**The massif.** A real Everest skyline: Nuptse's dark block on the left, the
Western Cwm dip, the main summit pyramid, the South Col saddle, and Lhotse to
the right at 8,516 m. The Yellow Band and Geneva Spur are drawn as rock bands.
The jet-stream snow plume streams off the summit as you get close.

**The climb.** The whole route is always visible as a faint dashed silhouette.
The solid, lit mountain grows out of the glacier as the market cap rises — the
clipped region below the frontier is what you've actually climbed. A glowing
edge marks the frontier, and Pepe the frog stands on the route line at your
current position — Solana-gradient skin, pick in hand, rope on.

All trade size is denominated in **SOL**: the top bar shows buys/sells counts
plus cumulative volume each way, and the live tape prints the size behind every
burst (`3 buys · 4.2 SOL · cap $15k`). Feeds that report real volumes
can send `buySol`/`sellSol` — otherwise the app estimates per-trade size.

**The glacier.** Procedurally generated seracs and crevasses across the Khumbu
Icefall, with a base camp tent village.

**The sky.** A full day/night cycle over 120 seconds by default. Ten keyframes
interpolate the sky gradient, the sun and moon (which arc left to right and set
behind the ridge), star opacity, the rock and snow colours, and the atmospheric
haze on the distant ranges. The mountain is lit warm at golden hour, white at
noon, and blue-shadowed at night.

**Controls.** Bottom-right: `AUTO`/`HOLD` toggle and a time-of-day scrubber.
Dragging the scrubber drops it into HOLD automatically. Cycle length is in
Feed setup.

---

## The feed

There is one feed: **live**. The page polls `/api/feed`, which reads the mint and
the upstream provider out of the published settings row — so publishing a CA and
an upstream URL is the whole launch, with no redeploy. Until both are published
the page says *awaiting launch*, shows dashes, and makes no request at all.

There is deliberately no simulated or manual mode in the shipped page. A mode
switch is what let a visitor watch a fabricated market cap climb, and hiding it
behind a flag was not enough — the code is gone.

For local development, run the mock upstream and point the endpoint box at it
(open the page with `?demo=1` to see that box):

```bash
node feed-proxy.mjs                    # mock, no key needed
```

Then point Feed setup at `http://localhost:8787/peak-feed`. See `INTEGRATION.md`
for the data contract and provider options, and `GET /api/feed?health=1` to see
what a real upstream is actually returning.

---

## Admin panel — changing the CA without a redeploy

The contract address used to be a constant in `index.html`, so putting the CA on
the site meant editing source, committing, deploying and waiting. It is now a row
in the database, written from a panel, and the page picks it up within ten
seconds. The same applies to the labels, both banner copy variants, the two
social links and the route note.

**The route is `/admin`** (or `admin.html`). It asks for a password before it
renders.

### Deploying it

PEAK shares a Supabase project with FundMeme and LOTTO — the same credentials,
the same database, a different table. `peak_settings` is namespaced so nothing
here can collide with theirs, and the migration is idempotent
(`create table if not exists`, `drop policy if exists`, `on conflict do nothing`)
so re-applying it after a deploy is safe. `ADMIN_SECRET` is deliberately *not*
shared: one leak would otherwise be two.

1. **Create the table.** Run `schema/001_settings.sql` against your Supabase
   project — the SQL editor is fine. It creates `peak_settings`, turns on RLS,
   and seeds the single empty row.

2. **Set the environment variables** on the deployment:

   | Variable | What it is |
   |---|---|
   | `ADMIN_SECRET` | The operator's passphrase. Also what you type into `/admin`. |
   | `SUPABASE_URL` | `https://<ref>.supabase.co` (or `VITE_SUPABASE_URL`). |
   | `SUPABASE_SERVICE_ROLE_KEY` | Bypasses RLS so the API can write. **Server-side only.** |
   | `RPC_URL` | Solana RPC for the chain check. Carries an API key — **never published**. |
   | `PEAK_API_KEY` | Optional. Your market-data provider's key, used by `/api/feed`. |
   | `PEAK_MINT`, `PEAK_UPSTREAM` | Optional. Fallbacks used only until a CA is published. |

   Without the first three, `/api/settings` answers `500 not_configured` and the
   panel says so instead of rejecting every password silently.

3. **Deploy.** Vercel picks up `api/` automatically. `vercel.json` turns on clean
   URLs so `/admin` resolves, and marks it `noindex`.

4. **Go live without a redeploy.** Open `/admin`, paste the CA, and fill in
   **Upstream feed URL** — the provider template with `{mint}` where the address
   goes, e.g. `https://provider.example/v1/token/{mint}`. Publishing those two
   *is* the launch: `/api/feed` reads the mint and the upstream out of the row,
   and the page starts polling its own `/api/feed` the moment a `feed_url` is
   published. `PEAK_MINT` / `PEAK_UPSTREAM` are only fallbacks for a deployment
   that has not published anything yet.

   Until both are set, the site says *awaiting launch*, the market readouts stay
   dashed, and **no request is made to `/api/feed` at all** — it does not poll for
   nothing and it does not invent a number. With only the CA published, the CA
   shows and the readouts stay dashed, because there is no upstream to read.
   `probe-live-wiring.mjs` asserts all four of those states.

   **If the feed stays dashed, ask it why.** `GET /api/feed?health=1` answers with
   the state (`pending` / `live` / `cached` / `stale` / `error`), the mint, the
   upstream URL it called (API key redacted), and — the useful part — the top-level
   keys the upstream actually sent plus any required field it could not find. A
   provider that calls market cap `fdv` answers:

   ```json
   { "mapped": false, "missing": ["marketCapUsd"],
     "upstreamKeys": ["fdv", "current_price", "holdersCount"] }
   ```

   which tells you exactly which path `mapUpstream` needs. Note `stale`: the page
   serves the last good frame and looks perfectly healthy while the upstream is
   failing, so a green-looking site is not proof the provider is up.

### The chain check

Pasting a contract address is the one action here that can cost someone money —
the CA is what people copy before they trade. The panel has a **Check on chain**
button that asks the RPC what the address actually is, and answers with more than
"valid":

- whether an account exists there at all
- whether it is an SPL mint, or a token **account** (the mistake people actually
  make, because it is the address a wallet shows you)
- decimals and exact supply
- **whether mint and freeze authority are still active** — an active mint
  authority can inflate the supply after launch, and an active freeze authority
  can freeze a holder's tokens. Both are ordinary rug mechanics and neither is
  visible from the address alone.

The verdict is advisory, not a gate: an RPC outage must not be able to stop you
publishing. It clears itself the moment the field no longer holds the address it
describes, because a green tick beside a different CA is worse than no tick.

Two things the check will not do. It does not prove the token is *safe* — it
reports what the chain says, and a revoked mint authority is not an endorsement.
And it cannot enumerate holders: the shared Helius key refuses
`getTokenLargestAccounts`, so concentration is reported as *unavailable* rather
than as zero. `holdersUnavailable` in the response is that distinction.

### What a public read does not return

`GET /api/settings` serves an allow-list of columns, not the whole row. `rpc_url`
is excluded because a Helius URL carries the paid API key in its query string,
and `index.html` never reads the column, so serving it would only ever leak it.
A read carrying `x-admin-secret` returns the full row so the panel can show what
is published.

The list is an allow-list on purpose: a column added later is private until
somebody writes it down as public. The other way round, every new column is
public the moment it is created.

### How the page stays current

`index.html` fetches `/api/settings` on load, every 10 seconds, and whenever the
tab regains focus. There is no build step and no deploy — the row *is* the
config. The polling interval is a deliberate choice over a WebSocket: it keeps
the app a single file with zero dependencies, and ten seconds is not a
meaningful delay for a contract address.

**Every value is an override.** A field the operator has not published is absent
from the row and the page falls back to the value compiled into `index.html`. So
adding this table changes nothing until somebody publishes something, and
clearing a field restores the default rather than blanking the page.

### Security posture

- **Reads are public** — the settings are on the page anyway.
- **Writes need the secret**, checked server-side on every request. A password
  compared in the browser would be theatre: the page's source is public.
- **The table has no anon write policy.** Supabase grants anon broad privileges
  by default, so the migration explicitly revokes them and grants only `select`.
  Rewriting the contract address is the most damaging thing anyone could do to
  this site — it is what people copy before they trade.
- **The CA is validated twice**, in the API and again by a CHECK constraint, as
  base58. Links must be `https://`, so a stored value can never be a
  `javascript:` URL. Operator text is rendered with `textContent`, so a stored
  string cannot become markup.

### Running it without a backend

Open `index.html` from disk and it still works — the settings fetch fails, the
page falls back to `localStorage`, and `/admin` says plainly that it has no
backend and that edits apply to that browser only. That mode changes nothing for
anyone else, which is exactly why the panel tells you so rather than pretending
to publish.

---

## Before this goes in front of real users

The banner has two copy modes. **Compliant** ships on. **Hype** — the version
that tells people to buy to unlock the next camp — is behind a toggle, and
`INTEGRATION.md` §4 explains why.

Short version: a reward that unlocks at a market cap can be pushed to that
market cap by anyone. Add copy instructing people to buy, and you've built a
machine that asks your community to manipulate your own chart. Wash trading to a
threshold is criminal in the US, EU, UK and Singapore — and the people who
designed the incentive are the first ones investigators look at.

The confetti is fine. It's the imperative sentence underneath it that's the
problem.

---

## Files

| File | What it is |
|---|---|
| **`index.html`** | The app. Single file, zero dependencies. |
| **`admin.html`** | The operator panel at `/admin`. Password-gated, publishes to the database. |
| **`api/settings.js`** | Public read, admin write. The only place the CA can be changed. |
| **`api/verify-ca.js`** | Admin-only. Asks the RPC what a contract address actually is before you publish it. |
| **`api/admin-auth.js`** | Checks the panel password, server-side and timing-safe. |
| **`api/feed.js`** | Serves the live market frame, driven by the published CA rather than an env var. |
| **`lib/base58.js`** | Decodes base58 to bytes. A length regex accepts addresses that are 32–44 characters and not 32 bytes. |
| **`schema/001_settings.sql`** | The `peak_settings` table, its constraints, and its RLS posture. |
| **`feed-proxy.mjs`** | Node proxy that normalises a pump.fun feed for the browser. Mock mode needs no API key. |
| **`logo/`** | Logo pack — 6 SVG masters (mark, lockup, app icon; light and dark) plus PNG builds. |
| **`INTEGRATION.md`** | Data contract, provider options, CONFIG reference, and the compliance analysis. |
| `vercel.json` | Clean URLs and no-store on `/api`. |
| `SummitPad-Strategic-Review.md` | Earlier strategic review of the concept. |
| `summitpad-concept-review.html` | Visual one-pager of that review. |

---

*Not legal advice. Have counsel review the ladder, the banner copy and the
promotion structure before launch.*
