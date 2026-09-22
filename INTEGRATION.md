# PEAK — integration & compliance notes

Two things live here: how to wire real pump.fun data into the app, and the one
design decision in this build that carries legal exposure.

---

## 1. Running it

Open `index.html` in a browser — no build step, no dependencies, no server.

**There is one feed, and it is live.** The page polls `/api/feed`, which reads the
mint and the upstream provider out of the published settings row (§5). With
nothing published it says *awaiting launch*, shows dashes for every market
readout, and makes no request at all.

Earlier versions had three modes — a local random walk (**Sim**), a
slider-driven market cap (**Manual**), and **Live**. Sim and Manual are **gone**,
not hidden. The reason is in §4: a mode a visitor can select is a mode the site
can be screenshotted in, and "a fabricated market cap climbing" is exactly what a
visitor must never see. Deleting the code is the only version of that which stays
true after a stylesheet change.

For development, `node feed-proxy.mjs` serves a mock on
`http://localhost:8787/peak-feed`, and `?demo=1` reveals the endpoint box.

---

## 2. Wiring real data

### Why you need a proxy

The browser cannot talk to pump.fun or to an indexer directly:

1. **CORS** — the upstream APIs do not send `Access-Control-Allow-Origin`.
2. **Secrets** — provider API keys must never ship in front-end code.
3. **Shape** — upstream payloads are large and shaped differently per provider.

`feed-proxy.mjs` solves all three. No dependencies, Node 18+.

```bash
# mock mode — no key needed, proves the plumbing
node feed-proxy.mjs

# live mode
PEAK_MINT=<token mint> \
PEAK_UPSTREAM=https://your-provider.example/v1/token/{mint} \
PEAK_API_KEY=<your key> \
node feed-proxy.mjs
```

Then in the app: **Feed setup → endpoint `http://localhost:8787/peak-feed` → Live**.

### The contract

The app expects exactly this shape. Anything else, normalise it in
`mapUpstream()` in the proxy.

```json
{
  "marketCapUsd": 148230,
  "priceUsd": 0.00014823,
  "buys": 412,
  "sells": 97,
  "holders": 380,
  "buySol": 213.4,
  "sellSol": 41.7
}
```

`buys` and `sells` must be **cumulative** counters, not per-interval deltas —
the app diffs them to fire the buy-pulse animation and the live tape.

`buySol` and `sellSol` are optional cumulative SOL volumes matching the
counters; when present, the tape shows real size per burst (`3 buys · 4.2
SOL · cap $15k`). If the feed omits them, the app estimates size per trade
and the top bar shows the estimate. All trade size is denominated in SOL.

### Where to get the data

pump.fun has **no official public data API**. Two routes:

- **A commercial indexer — recommended.** Stable, documented, WebSocket stream,
  someone to call when it breaks. SolanaTracker and Bitquery both publish
  pump.fun endpoints including bonding-curve progress and market cap.
- **Reverse-engineered endpoints.** Public repos document pump.fun's internal
  HTTP API. They work until they don't, break without notice, and may conflict
  with the platform's terms. Acceptable for a hackathon, wrong for a product.

### Latency notes

- The mountain is eased toward the target value, so polling at 1–2s looks
  smooth. You do not need sub-second data for this.
- For a genuinely live feel, point the endpoint at a `wss://` URL instead —
  `startLive()` detects the scheme and subscribes instead of polling.
- Cache upstream responses. Most indexers rate-limit, and this app only needs
  one poll per interval regardless of how many browsers are open.

---

## 3. Customising

Everything you'd want to change is in the `CONFIG` object at the top of the
script in `index.html`:

```js
CONFIG.token          // symbol, name, supply (used to derive price)
CONFIG.trailheadAlt   // altitude at graphic position 0 (Lukla, 2,860 m)
CONFIG.summitAlt      // altitude at graphic position 1 (8,849 m)
CONFIG.camps[]        // the route: id, name, alt, mc threshold, f, x, unlock text
CONFIG.copy           // banner strings for both copy modes
```

Each camp carries four numbers that must stay consistent:

| Field | Meaning |
|---|---|
| `mc` | Market-cap threshold that reaches this camp |
| `f` | Graphic position up the mountain, 0 = trailhead, 1 = summit |
| `alt` | Real altitude in metres |
| `x` | Horizontal position in the 760-wide scene, for the route line |

**Market cap → `f` is piecewise linear through the camps**, and `f` → displayed
altitude uses the same segments. That means the readout always matches the
position: at $30k you are on Camp 1 at 6,065 m, exactly.

If you add a camp, give it an `f` between its neighbours' and an `x` that sits
under the skyline at that height. There is a quick way to check — the skyline is
the `RIDGE` array further down, and a marker is valid when its `y`
(`470 - f × 382`) is greater than the skyline's `y` at its `x`.

**Why not a simple log scale?** The earlier build used one, and it worked, but
it decoupled the altitude readout from the real mountain. Anchoring on the camps
means the numbers are true — 6,065 m is Camp 1's real altitude, not a
reinterpretation of a market cap.

---

## 4. The part you should read

### The "buy more" banner

You asked for a banner that encourages buying to reach the next peak. It's in
the build — open the page with **`?demo=1`** and switch **Banner copy mode →
Hype** in Feed setup to see it. It ships **off** by default, and here's why.

**And it is not reachable without that flag.** The page ships in production
posture: the Feed setup drawer and Reset are hidden, and the banner is locked to
the compliant copy. `?demo=1` restores the console for a demo. (There is no feed
mode switch to hide any more — the feed is live-only and the code for a simulated
climb has been deleted, which is a stronger guarantee than hiding a button.)

That distinction turned out to matter more than the default did. "Ships off by
default" was true of the *setting* and false of the *page*: the toggle was in the
visitor's hands, so anyone could flip the site into Hype mode and screenshot it,
with the warning box below sitting inside the drawer the screenshot would crop.
The site publishing the copy is the exposure; a visitor being able to switch it
on is the site publishing it. A client-side flag stops the shipped page offering
it, which is the standard that matters — anyone in devtools can rewrite the
page's text regardless, and no client-side gate changes that.

**Under MiCA** (in full force since 30 Dec 2024; the transitional window closed
1 July 2026), marketing must be fair, clear, not misleading, and consistent with
the white paper — and incentive-based promotions that could distort retail
decision-making are restricted. A banner instructing users to buy in order to
unlock a benefit is close to the definition of the thing that rule targets.

**In the US**, a published ladder where benefits materialise on price
appreciation, combined with a call to buy, is a solicitation tied to an
expectation of profit from the team's efforts. That is the Howey fact pattern.

**The worst part is mechanical, not legal.** If a reward unlocks at a market cap,
anyone can push the price to that market cap. Pair that with copy telling people
to buy, and you have built a machine that asks your own community to manipulate
your own chart. Wash trading to a threshold is a criminal offence in the US, EU,
UK and Singapore — and the people who designed the incentive are the first ones
investigators look at.

### Copy that keeps the energy

The compliant mode already in the build does this:

> **Peak reached — Ridge**
> The climb has reached Ridge. The next peak stands at $30k market cap.
> *Market cap milestones only. No return is promised or implied.*

Same celebration, same momentum, no imperative. Things that work:

- **Name the next peak, don't instruct the buy.** "Next peak: $30k" creates the
  pull on its own.
- **Celebrate participation, not price.** Buy count, holder count, missions
  funded — those are things people genuinely cause.
- **Never render a reward as a function of price.** A reward that appears
  *because* the price rose is the securities-shaped part. A reward funded from
  accrued fees that unlocks at a budget threshold is not.
- **Keep the disclaimer on screen.** The ladder panel and the banner both carry
  one. Don't remove them for aesthetics.

### Other things to keep in mind

- **Don't run this on a token you or your team hold** without securities counsel
  in every target jurisdiction. The promoter-liability exposure is personal.
- **Don't publish a ladder you can't fund.** If the reward pool isn't already in
  escrow, you've written a promise you may not keep — which is a
  misrepresentation regardless of how the token performs.
- **Geo-gate.** If you can't comply in a jurisdiction, don't serve it.
- **Don't let the milestone be reachable by a single wallet.** A threshold one
  actor can push is a bounty, not a milestone.
- **Keep the confetti.** It's genuinely good product design and it's not the
  problem. The problem is the imperative sentence underneath it.

---

## 5. What's in the build

| Feature | Where |
|---|---|
| Everest skyline — Nuptse, Western Cwm, summit, South Col, Lhotse | `RIDGE` array, `RIDGE_PATH` |
| Mountain grows out of the glacier as market cap rises | `clipRect`, `Scene.update()` |
| Faint full silhouette showing the route ahead | `ghost` path |
| Rock bands (Yellow Band, Geneva Spur) | `bands` group |
| Jet-stream summit plume, fades in near the top | `plume`, opacity tied to `f` |
| Khumbu Icefall — procedural seracs and crevasses | `seracs`, `crev` groups |
| Base camp tent village | `village` group |
| Route line and camp markers with altitudes | `route`, `campG` |
| Climber standing at your position on the route | `climber`, `routeX()` |
| Day/night skybox — 10 interpolated keyframes | `SKY` array, `skyAt()`, `applySky()` |
| Sun and moon arc, setting behind the ridge | `bodyG` in `applySky()` |
| Star field, opacity driven by the cycle | `starG` |
| Atmospheric haze on distant ranges | `g-haze` gradient |
| Confetti burst at the camp on each milestone | `Confetti.burst()` |
| Buy pulse + ripple on the icefall | `Confetti.puff()`, `Scene.ripple()` |
| Camp ladder with per-rung progress bars | `Ladder` module |
| Banner with Compliant / Hype copy modes | `Banner`, `CONFIG.copy` |
| Live tape of buys, sells and camps | `Tape` module |
| Live feed | `startLive()` — the only one there is |
| Feed proxy with mock + live modes | `feed-proxy.mjs` |

---

*Not legal advice. Have counsel review the ladder, the banner copy, and the
promotion structure before this goes in front of real users.*
