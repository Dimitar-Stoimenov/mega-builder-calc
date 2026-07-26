// ─────────────────────────────────────────────────────────────────────────────
// HEDGE MATH — given a classified combo + the boosted coef + a price for each hedge
// leg, compute the lock/edge. Each leg's price can come from POLY (resolved bid/ask)
// or a MANUAL bookie coef you type (Poly exact-score atoms are often thin/mispriced).
//
// Lock logic (mirrors hedge-calc / poly-odds-board): you back the boost at the coef,
// and buy every hedge token. Locked profit exists when
//     coef * (1 - Σ pEff(legCost)) > 1
// where pEff(c) = c + FEE*c*(1-c) is the fee-adjusted taker cost of one leg, and the
// legs are mutually exclusive (a Σ of disjoint outcomes ≤ 1). Edge% = (test-1)*100.
// ─────────────────────────────────────────────────────────────────────────────

import type { Combo, HedgeToken } from './combos.ts';
import { resolveQuote, type Fixture } from './gamma.ts';

export const FEE = 0.05; // Poly sports taker fee
export const LOCK = 1.005; // 0.5% edge threshold
export const MAX_SPREAD = 0.12; // wider ⇒ maker unreliable / illiquid

export function pEff(c: number): number {
  return c + FEE * c * (1 - c);
}

/** Where a leg's price came from. */
export type LegSource = 'poly-taker' | 'poly-maker' | 'manual';

export interface LegPrice {
  token: HedgeToken;
  source: LegSource;
  /** the cost (0..1) to OWN this token via the chosen source. */
  cost: number;
  /** Poly quote (if resolvable), for display + the toggle. */
  poly?: { bid: number; ask: number; found: boolean; spread: number; illiquid: boolean };
  /** manual bookie decimal coef the user typed for this leg, if any. */
  manualCoef?: number;
}

export interface HedgeResult {
  coef: number;
  legCount: number;
  /** total fee-adjusted cost across legs. */
  totalPEff: number;
  /** coef * (1 - totalPEff). >1 ⇒ locked. */
  test: number;
  edgePct: number;
  kind: 'taker-lock' | 'maker-only' | 'dead' | 'missing';
  legs: LegPrice[];
  /** min-coef gate warning (2-leg<2.00 / 3-leg<3.00), or null. */
  coefWarning: string | null;
  /** any leg's Poly market not found (needs manual). */
  missing: string[];
}

export interface LegOverride {
  /** 'poly-taker' (cross), 'poly-maker' (rest at near side), or 'manual'. */
  source: LegSource;
  /** manual bookie decimal coef (used when source==='manual'). */
  manualCoef?: number;
}

/** cost to own a token via each source. manual: 1/coef. poly-taker: ask. poly-maker: bid. */
function costFor(poly: { bid: number; ask: number; found: boolean }, ov: LegOverride): number | null {
  if (ov.source === 'manual') {
    if (!ov.manualCoef || ov.manualCoef <= 1) return null;
    return 1 / ov.manualCoef;
  }
  if (!poly.found) return null;
  return ov.source === 'poly-maker' ? poly.bid : poly.ask;
}

/**
 * Compute the hedge for a combo on a fixture.
 * @param overrides per-token source choice (indexed by token id); defaults to poly-taker.
 */
export function computeHedge(
  combo: Combo,
  fx: Fixture | null,
  coef: number,
  overrides: Record<string, LegOverride> = {},
): HedgeResult {
  const legs: LegPrice[] = [];
  const missing: string[] = [];

  for (const token of combo.hedge) {
    const q = fx ? resolveQuote(fx, token.market) : { bid: 0, ask: 0, label: token.label, found: false };
    const spread = q.found ? q.ask - q.bid : 0;
    const illiquid = q.found && spread > MAX_SPREAD;
    const ov: LegOverride = overrides[token.id] ?? { source: 'poly-taker' };
    const cost = costFor(q, ov);
    if (cost == null) missing.push(token.label);
    legs.push({
      token,
      source: ov.source,
      cost: cost ?? 0,
      poly: fx ? { bid: q.bid, ask: q.ask, found: q.found, spread, illiquid } : undefined,
      manualCoef: ov.manualCoef,
    });
  }

  const totalPEff = legs.reduce((s, l) => s + pEff(l.cost), 0);
  const test = coef * (1 - totalPEff);
  const edgePct = (test - 1) * 100;

  // min-coef gate: 2-leg needs ≥2.00 base (pre-boost) typically; 3-leg ≥3.00. We only
  // have the BOOSTED coef here, so warn if even the boosted coef is under the gate.
  const gate = combo.legCount >= 3 ? 3.0 : 2.0;
  const coefWarning = coef < gate
    ? `boosted coef ${coef} is under the usual ${combo.legCount}-leg minimum (${gate}) — double-check the bookie allows this build`
    : null;

  // an illiquid leg makes a MAKER unreliable; treat only the taker as trustworthy there.
  const anyIlliquidMaker = legs.some((l) => l.source === 'poly-maker' && l.poly?.illiquid);

  let kind: HedgeResult['kind'];
  if (missing.length) kind = 'missing';
  else if (test > LOCK && legs.every((l) => l.source !== 'poly-maker' || !l.poly?.illiquid)) {
    // a lock stands if it holds on the chosen sources and no leg relies on an illiquid maker
    kind = legs.some((l) => l.source === 'poly-maker') ? 'maker-only' : 'taker-lock';
  } else if (test > LOCK && anyIlliquidMaker) kind = 'dead';
  else kind = 'dead';

  return { coef, legCount: combo.legCount, totalPEff, test, edgePct, kind, legs, coefWarning, missing };
}
