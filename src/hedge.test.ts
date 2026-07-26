import { describe, it, expect } from 'vitest';
import { computeHedge, pEff } from './hedge.ts';
import { COMBOS } from './combos.ts';
import type { Fixture } from './gamma.ts';

const byId = Object.fromEntries(COMBOS.map((c) => [c.id, c]));

// Synthetic fixture with the markets BTTS+O2.5 needs: BTTS Yes 0.55/0.58, 1-1 ask 0.12.
const FX: Fixture = {
  title: 'Home FC vs. Away FC', start: '2026-08-01T16:00:00Z',
  markets: [
    { question: 'Home FC vs. Away FC: Both Teams to Score', outcomes: ['Yes', 'No'], bestBid: 0.55, bestAsk: 0.58 },
    { question: 'Exact Score: Home FC 1 - 1 Away FC?', outcomes: ['Yes', 'No'], bestBid: 0.1, bestAsk: 0.12 },
  ],
};

describe('computeHedge — BTTS + O2.5', () => {
  const combo = byId['btts+over2.5'];

  it('prices BTTS-No as the complement (1 - Yes) and 1-1 as its ask', () => {
    const r = computeHedge(combo, FX, 3.0);
    const bttsLeg = r.legs.find((l) => l.token.id === 'no-btts')!;
    const oneLeg = r.legs.find((l) => l.token.id === '1-1')!;
    // BTTS-No taker = 1 - Yes_bid = 1 - 0.55 = 0.45
    expect(bttsLeg.cost).toBeCloseTo(0.45, 5);
    // 1-1 taker = ask = 0.12
    expect(oneLeg.cost).toBeCloseTo(0.12, 5);
  });

  it('locks when the coef is fat enough, dead when thin', () => {
    // total pEff ≈ pEff(0.45)+pEff(0.12) ≈ 0.462 + 0.125 = 0.587. test = coef*(1-0.587)=coef*0.413
    const fat = computeHedge(combo, FX, 3.0);   // 3.0*0.413 ≈ 1.24 -> lock
    const thin = computeHedge(combo, FX, 2.0);  // 2.0*0.413 ≈ 0.83 -> dead
    expect(fat.kind).toBe('taker-lock');
    expect(fat.edgePct).toBeGreaterThan(0);
    expect(thin.kind).toBe('dead');
  });

  it('uses a MANUAL bookie coef for the 1-1 leg when overridden', () => {
    // if a bookie offers 1-1 at 10.0 (cost 0.10 < poly 0.12), the total cost drops
    const r = computeHedge(combo, FX, 3.0, { '1-1': { source: 'manual', manualCoef: 10 } });
    const oneLeg = r.legs.find((l) => l.token.id === '1-1')!;
    expect(oneLeg.source).toBe('manual');
    expect(oneLeg.cost).toBeCloseTo(0.1, 5);
  });

  it('flags a missing Poly market (needs manual)', () => {
    const noOneOne: Fixture = { ...FX, markets: [FX.markets[0]] }; // drop the 1-1 market
    const r = computeHedge(combo, noOneOne, 3.0);
    expect(r.kind).toBe('missing');
    expect(r.missing).toContain('Exact 1-1');
  });

  it('warns when a 3-leg boosted coef is under 3.00', () => {
    const three = byId['draw+btts+over1.5'];
    const r = computeHedge(three, null, 2.5); // no fixture -> missing, but the warning still computes
    expect(r.coefWarning).toMatch(/3-leg/);
  });
});

describe('pEff', () => {
  it('adds the fee curve', () => {
    expect(pEff(0)).toBe(0);
    expect(pEff(0.5)).toBeCloseTo(0.5 + 0.05 * 0.25, 6);
  });
});

describe('shared-city team win resolution (the +306% bug)', () => {
  // Cherno More Varna (home) vs Spartak Varna (away) — both "Varna".
  const FX2: Fixture = {
    title: 'PFC Cherno More Varna vs. FK Spartak 1918 Varna', start: '',
    markets: [
      { question: 'Will PFC Cherno More Varna win on 2026-07-26?', outcomes: ['Yes', 'No'], bestBid: 0.53, bestAsk: 0.55 },
      { question: 'Will FK Spartak 1918 Varna win on 2026-07-26?', outcomes: ['Yes', 'No'], bestBid: 0.17, bestAsk: 0.18 },
      { question: 'Exact Score: PFC Cherno More Varna 0 - 1 FK Spartak 1918 Varna?', outcomes: ['Yes', 'No'], bestBid: 0.05, bestAsk: 0.08 },
    ],
  };
  it('backs the AWAY (Spartak) win-No at ~0.83, not the home market at 0.47', () => {
    const combo = byId['awaywin+over1.5'];
    const r = computeHedge(combo, FX2, 9.37);
    const noAway = r.legs.find((l) => l.token.id === 'no-away')!;
    expect(noAway.cost).toBeCloseTo(0.83, 2); // 1 - Spartak_bid(0.17), NOT 1 - Cherno_bid
    expect(r.kind).toBe('dead');              // underdog combo @9.37 does NOT lock
    expect(r.edgePct).toBeLessThan(0);
  });
});
