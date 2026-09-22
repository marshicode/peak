# PEAK

A launchpad visualiser where the market cap **is** Mount Everest. The climb
follows the real Southeast Ridge, south side — Base Camp, the Khumbu Icefall,
the Western Cwm, the Lhotse Face, the South Col, the summit at 8,849 m. Buy
pressure moves you up the route. Every camp you reach plants a tent, drops
confetti, and names the next stop.

The name is PEAK. The product is the mountain.

---

## Start here

Open **`index.html`** in a browser. No build, no dependencies, no server.
It runs on a simulated feed immediately.

Try this: **Feed setup → Manual**, then drag the market cap slider and watch the
massif emerge from the glacier, the snowline rise, and the camps light up one by
one. Then scrub the day/night slider in the bottom-right corner and watch the
whole scene change — alpenglow at sunrise, white light at noon, blue shadow at
night.

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

## Feed modes

| Mode | Use |
|---|---|
| **Sim** | Local random walk. Default. Good for development. |
| **Manual** | Slider-driven market cap. Best for demos and screenshots. |
| **Live** | Polls your JSON endpoint or subscribes to a WebSocket. |

```bash
node feed-proxy.mjs                    # mock, no key needed
```

Then point Feed setup at `http://localhost:8787/peak-feed`. See
`INTEGRATION.md` for the data contract and provider options.

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
| **`feed-proxy.mjs`** | Node proxy that normalises a pump.fun feed for the browser. Mock mode needs no API key. |
| **`INTEGRATION.md`** | Data contract, provider options, CONFIG reference, and the compliance analysis. |
| `SummitPad-Strategic-Review.md` | Earlier strategic review of the concept. |
| `summitpad-concept-review.html` | Visual one-pager of that review. |

---

*Not legal advice. Have counsel review the ladder, the banner copy and the
promotion structure before launch.*
