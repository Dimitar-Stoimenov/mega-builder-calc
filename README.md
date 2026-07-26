# Mega Builder Hedge Finder

A **browser-only** React app that finds Polymarket hedges for bookie **bet-builder boosts**.

Type a bet-builder's legs (e.g. `BTTS` + `Over 2.5`) and its boosted coefficient. If the
combo is in the verified library, the app finds the exact **Polymarket tokens that cover
every losing outcome**, prices them live, and tells you whether it **locks** (guaranteed
profit) and by how much.

No server — the page fetches Polymarket's Gamma API directly (CORS is `*`). Deploys static.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 90 tests (combo grid-verification, classify, hedge math)
npm run build    # type-check + static build to dist/
```

## How it works

A bet-builder ANDs N legs at a boosted coef. It **wins** only in the intersection of all
legs; you **lock** it by buying, on Poly, every outcome where it **loses**. If those tokens'
fee-adjusted cost < `1/coef`, it's guaranteed profit.

- **`combos.ts`** — the hardcoded, machine-verified combo library. Each entry carries its
  human legs, a `winPred` over scorelines, and the `hedge` tokens (each mapped to a Poly
  market). **`combos.test.ts` checks every combo over every scoreline 0-0 … 10-10**: the
  hedge must pay on *every* losing score (complete), *no* winning score (clean), and use only
  Poly-buildable tokens (exact scores ≤ 3-3, or whole-market outcomes like BTTS-No / Win-to-Nil).
- **`classify.ts`** — turns free-typed legs into a known combo (order-independent). Unknown
  combos fail explicitly — never a guess.
- **`gamma.ts`** — browser Gamma client. Fetches a league (by tag *or* series — some leagues
  like Romania are series-only) and resolves each hedge token to a live bid/ask.
- **`hedge.ts`** — the lock/edge math (fee-adjusted), the **liquidity guard** (wide-spread
  markets flagged), and the **min-coef gate** (2-leg ≥2.00 / 3-leg ≥3.00 sanity check).

### Per-leg source override
Poly's exact-score atoms (1-1, 0-0, …) are often thin or mispriced. Each hedge leg can be
priced from **Poly (take / rest)** *or* a **manually-typed bookie coef** — pick the cheaper,
available source per leg.

### Verified combos (excerpt)
`BTTS+O2.5 → BTTS-No + 1-1` · `Draw+O3.5 → Draw-No + 0-0 + 1-1` · `Draw+BTTS → Draw-No + 0-0` ·
`HomeWin+O1.5 → HomeWin-No + 1-0` · `HomeWin+BTTS → HomeWin-No + Home-Win-to-Nil` ·
`1X+O0.5 → Away-Win + 0-0` · plus the 3-leg coef-rule workarounds. See `combos.ts`.

## Caveats
- **CORS-dependent:** if Polymarket drops the `*` header, the browser fetch breaks (would need
  a thin proxy).
- **Poly 3-3 ceiling:** combos needing a >3-3 exact token aren't lockable via a single Poly
  token and are excluded (or use a win-to-nil-style whole-market token instead).
- Not financial advice.
