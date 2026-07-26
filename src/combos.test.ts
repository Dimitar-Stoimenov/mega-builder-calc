import { describe, it, expect } from 'vitest';
import { COMBOS, MAX_GOALS, isPolyBuildable, type Combo, type Score } from './combos.ts';

/** Every scoreline 0-0 … MAX-MAX (covers 4-0, 5-7, and beyond Poly's 3-3 grid). */
function allScores(): Score[] {
  const out: Score[] = [];
  for (let h = 0; h <= MAX_GOALS; h++) for (let a = 0; a <= MAX_GOALS; a++) out.push({ h, a });
  return out;
}

/** For a combo, split every scoreline into WIN cells and LOSE cells. */
function partition(c: Combo) {
  const win: Score[] = [], lose: Score[] = [];
  for (const s of allScores()) (c.winPred(s) ? win : lose).push(s);
  return { win, lose };
}

describe('combo library — exhaustive per-scoreline verification', () => {
  for (const c of COMBOS) {
    describe(c.id, () => {
      const { win, lose } = partition(c);

      it('COMPLETE: the hedge pays on EVERY losing scoreline', () => {
        const uncovered = lose.filter((s) => !c.hedge.some((t) => t.pays(s)));
        expect(uncovered, `uncovered lose cells: ${uncovered.map((s) => `${s.h}-${s.a}`).join(', ')}`).toEqual([]);
      });

      it('CLEAN: the hedge pays on NO winning scoreline', () => {
        const leaks = win.filter((s) => c.hedge.some((t) => t.pays(s)));
        expect(leaks, `hedge leaks onto win cells: ${leaks.map((s) => `${s.h}-${s.a}`).join(', ')}`).toEqual([]);
      });

      it('BUILDABLE: every hedge token exists on Poly (exact ≤ 3-3, or a whole-market outcome)', () => {
        const unbuildable = c.hedge.filter((t) => !isPolyBuildable(t));
        expect(unbuildable.map((t) => t.id), 'tokens Poly does not offer').toEqual([]);
      });

      it('has at least one winning and one losing scoreline (sanity — not degenerate)', () => {
        expect(win.length).toBeGreaterThan(0);
        expect(lose.length).toBeGreaterThan(0);
      });

      it('DISJOINT: no scoreline is covered by more than one hedge token (clean sizing)', () => {
        // overlap muddies per-leg sizing (the away-Under-0.5 trap). We require a clean
        // partition: at most one token pays on any given score.
        const overlaps = allScores().filter((s) => c.hedge.filter((t) => t.pays(s)).length > 1);
        expect(overlaps.map((s) => `${s.h}-${s.a}`), 'scores covered by >1 token (overlap)').toEqual([]);
      });
    });
  }
});

describe('spot-check key scorelines against decompositions (human-readable)', () => {
  const byId = Object.fromEntries(COMBOS.map((c) => [c.id, c]));
  const pays = (c: Combo, h: number, a: number) => c.hedge.some((t) => t.pays({ h, a }));
  const wins = (c: Combo, h: number, a: number) => c.winPred({ h, a });

  it('BTTS+O2.5: 2-1 wins (hedge silent), 1-1 loses (hedge pays), 1-0 loses (hedge pays)', () => {
    const c = byId['btts+over2.5'];
    expect(wins(c, 2, 1)).toBe(true); expect(pays(c, 2, 1)).toBe(false); // win: both score + 3 goals
    expect(wins(c, 1, 1)).toBe(false); expect(pays(c, 1, 1)).toBe(true); // lose: both score, only 2 goals
    expect(wins(c, 1, 0)).toBe(false); expect(pays(c, 1, 0)).toBe(true); // lose: no BTTS
  });

  it('Draw+O3.5: 2-2 WINS (4 goals), 1-1 & 0-0 lose, 3-0 loses', () => {
    const c = byId['draw+over3.5'];
    expect(wins(c, 2, 2)).toBe(true); expect(pays(c, 2, 2)).toBe(false); // draw + 4 goals = win
    expect(wins(c, 1, 1)).toBe(false); expect(pays(c, 1, 1)).toBe(true);
    expect(wins(c, 0, 0)).toBe(false); expect(pays(c, 0, 0)).toBe(true);
    expect(wins(c, 3, 0)).toBe(false); expect(pays(c, 3, 0)).toBe(true); // not a draw
  });

  it('HomeWin+BTTS: 2-1 wins, 4-0 loses via Win-to-Nil (not an exact token)', () => {
    const c = byId['homewin+btts'];
    expect(wins(c, 2, 1)).toBe(true); expect(pays(c, 2, 1)).toBe(false);
    expect(wins(c, 4, 0)).toBe(false); expect(pays(c, 4, 0)).toBe(true); // covered by Home-Win-to-Nil, no 4-0 token needed
    expect(wins(c, 0, 1)).toBe(false); expect(pays(c, 0, 1)).toBe(true); // not home win
  });

  it('HomeWin+O2.5: 2-1 WINS (3 goals) so hedge must NOT pay on it (the leak we fixed)', () => {
    const c = byId['homewin+over2.5'];
    expect(wins(c, 2, 1)).toBe(true); expect(pays(c, 2, 1)).toBe(false);
    expect(wins(c, 2, 0)).toBe(false); expect(pays(c, 2, 0)).toBe(true);
  });
});
