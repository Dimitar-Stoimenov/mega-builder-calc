import { describe, it, expect } from 'vitest';
import { classify, parseLeg } from './classify.ts';
import { COMBOS } from './combos.ts';

describe('parseLeg', () => {
  it('reads the common leg phrasings', () => {
    expect(parseLeg('BTTS')).toEqual({ t: 'btts' });
    expect(parseLeg('both teams to score')).toEqual({ t: 'btts' });
    expect(parseLeg('Over 2.5')).toEqual({ t: 'over', line: 2.5 });
    expect(parseLeg('total goals over 1.5')).toEqual({ t: 'over', line: 1.5 });
    expect(parseLeg('Draw')).toEqual({ t: 'draw' });
    expect(parseLeg('Home Win')).toEqual({ t: 'win', team: 'home' });
    expect(parseLeg('away win')).toEqual({ t: 'win', team: 'away' });
    expect(parseLeg('1X')).toEqual({ t: 'dc', kind: '1x' });
    expect(parseLeg('home over 0.5')).toEqual({ t: 'teamOver', team: 'home', line: 0.5 });
  });
  it('returns null for gibberish', () => {
    expect(parseLeg('referee to book someone')).toBeNull();
    expect(parseLeg('')).toBeNull();
  });
});

describe('classify — free legs -> combo (order-independent)', () => {
  it('classifies BTTS + Over 2.5 (either order)', () => {
    const a = classify(['BTTS', 'Over 2.5']);
    const b = classify(['Over 2.5', 'both teams to score']);
    expect(a.ok && a.combo.id).toBe('btts+over2.5');
    expect(b.ok && b.combo.id).toBe('btts+over2.5');
  });

  it('classifies Draw + Over 3.5 and the win-to-nil combos', () => {
    expect((classify(['Draw', 'Over 3.5']) as any).combo?.id).toBe('draw+over3.5');
    expect((classify(['Home Win', 'BTTS']) as any).combo?.id).toBe('homewin+btts');
    expect((classify(['1X', 'Over 0.5']) as any).combo?.id).toBe('1x+over0.5');
  });

  it('classifies the 3-leg workarounds', () => {
    expect((classify(['Draw', 'BTTS', 'Over 1.5']) as any).combo?.id).toBe('draw+btts+over1.5');
    expect((classify(['Draw', 'home over 0.5', 'away over 0.5']) as any).combo?.id).toBe('draw+teamover0.5x2');
  });

  it('EVERY library combo classifies back to itself from its own legs', () => {
    // guards against the classifier and the library drifting apart
    for (const c of COMBOS) {
      const typed = c.legs.map((l: string) => l
        .replace(/both teams to score/i, 'BTTS')
        .replace(/result:\s*/i, '')
        .replace(/double chance:.*\((1x|12|x2)\)/i, '$1')
        .replace(/(home|away) total:/i, '$1'));
      const r = classify(typed);
      expect(r.ok, `combo ${c.id} did not classify from ${JSON.stringify(typed)}`).toBe(true);
      if (r.ok) expect(r.combo.id).toBe(c.id);
    }
  });

  it('rejects an unknown/unsupported combo cleanly (no guess)', () => {
    const r = classify(['BTTS', 'Over 4.5']); // valid legs, but this combo is not in the library
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not in the verified library/);
  });

  it('reports which leg it could not read', () => {
    const r = classify(['BTTS', 'referee to watch VAR']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/couldn't read/);
  });
});
