import { useEffect, useMemo, useState } from 'react';
import { LEAGUES, fetchFixtures, type Fixture } from './gamma.ts';
import { COMBOS } from './combos.ts';
import { computeHedge, type LegOverride, type LegSource, type HedgeResult } from './hedge.ts';

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

// Hand-picked display order for the top combos. Listed ids float to the top in this
// exact order; everything else follows in combos.ts order. (Home/away = team 1/team 2.)
const PINNED_ORDER = [
  'btts+over1.5',    // 1 — very top
  'btts+over2.5',    // 2
  'homewin+over1.5', // 3 — Win + O1.5, team 1
  'awaywin+over1.5', // 4 — Win + O1.5, team 2
  'draw+btts',       // 5
];

export function App() {
  const [leagueKey, setLeagueKey] = useState('bulgaria');
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [fxIdx, setFxIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // coef per combo id, typed manually
  const [coefs, setCoefs] = useState<Record<string, string>>({});
  // per-combo, per-leg source override (for Poly-take/rest/manual)
  const [overrides, setOverrides] = useState<Record<string, Record<string, LegOverride>>>({});
  // which combo row is expanded to show per-leg detail
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(null);
    fetchFixtures(LEAGUES[leagueKey])
      .then((fx) => { if (alive) { setFixtures(fx); setFxIdx(0); } })
      .catch((e) => { if (alive) setErr(String(e?.message ?? e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [leagueKey]);

  const fx = fixtures[fxIdx] ?? null;

  // compute every combo's hedge for the selected match; a hand-picked order pins the
  // best combos to the top (independent of the ⭐ jewel flag). Anything not listed here
  // keeps its combos.ts order, after the pinned ones.
  const rows = useMemo(() => {
    const rank = (id: string) => { const i = PINNED_ORDER.indexOf(id); return i === -1 ? PINNED_ORDER.length : i; };
    return COMBOS
      // stable: pinned by their PINNED_ORDER index; unpinned keep original combos.ts order.
      .map((c, i) => ({ c, i }))
      .sort((a, b) => rank(a.c.id) - rank(b.c.id) || a.i - b.i)
      .map(({ c }) => c)
      .map((c) => {
      const coef = parseFloat(coefs[c.id] ?? '');
      const res: HedgeResult | null = fx && Number.isFinite(coef) && coef > 1
        ? computeHedge(c, fx, coef, overrides[c.id] ?? {})
        : null;
      return { combo: c, res };
    });
  }, [fx, coefs, overrides]);

  const setCoef = (id: string, v: string) => setCoefs((c) => ({ ...c, [id]: v }));
  const setSource = (comboId: string, legId: string, source: LegSource) =>
    setOverrides((o) => ({ ...o, [comboId]: { ...o[comboId], [legId]: { ...o[comboId]?.[legId], source } } }));
  const setManual = (comboId: string, legId: string, v: string) =>
    setOverrides((o) => ({ ...o, [comboId]: { ...o[comboId], [legId]: { source: 'manual', manualCoef: parseFloat(v) || undefined } } }));

  return (
    <div className="wrap">
      <h1>Mega Builder Hedge Finder</h1>
      <p className="sub">Pick a match, then type each bet-builder's boosted coefficient. The edge vs the
        Polymarket hedge is computed inline. Green = locks now, amber = maker-only, red = no edge.</p>

      <div className="card">
        <div className="row">
          <div>
            <label>League</label>
            <select value={leagueKey} onChange={(e) => setLeagueKey(e.target.value)}>
              {Object.entries(LEAGUES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div style={{ flex: 2 }}>
            <label>Match {loading ? '(loading…)' : `(${fixtures.length})`}</label>
            <select value={fxIdx} onChange={(e) => setFxIdx(Number(e.target.value))} disabled={!fixtures.length}>
              {fixtures.map((f, i) => <option key={i} value={i}>{f.title}  ·  {f.start.slice(5, 16).replace('T', ' ')}</option>)}
            </select>
          </div>
        </div>
        {err && <p className="err">Fetch failed: {err}</p>}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="builders">
          <thead>
            <tr><th>Bet builder</th><th>Legs</th><th className="num">Coef</th><th className="num">Edge</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map(({ combo, res }) => {
              const kind = res?.kind ?? 'idle';
              const open = openId === combo.id;
              return (
                <>
                  <tr key={combo.id} className={`brow ${kind} ${combo.jewel ? 'jewel' : ''}`}>
                    <td className="bname">{combo.jewel && <span className="star" title="redundant-leg / clean single-token hedge — best to hunt">★</span>}{combo.label ?? combo.legs.join(' + ')}</td>
                    <td className="blegs">{combo.legs.map(shortLeg).join(' + ')}{combo.legCount >= 3 && <span className="pill3">3-leg</span>}</td>
                    <td className="num">
                      <input className="coef" inputMode="decimal" placeholder="—"
                        value={coefs[combo.id] ?? ''} onChange={(e) => setCoef(combo.id, e.target.value)} />
                    </td>
                    <td className={`num edge ${kind}`}>
                      {res ? (res.kind === 'missing' ? '⚠︎' : pct(res.edgePct)) : ''}
                    </td>
                    <td className="num">
                      {res && <button className="chip" onClick={() => setOpenId(open ? null : combo.id)}>{open ? '▾' : '▸'}</button>}
                    </td>
                  </tr>
                  {open && res && (
                    <tr className="detail-row"><td colSpan={5}>
                      <div className="detail">
                        <div className="decomp"><b>{verdictText(res)}</b> — {combo.note}</div>
                        <table className="legtable">
                          <thead><tr><th>Buy (hedge leg)</th><th>Poly bid/ask</th><th>Source</th><th>Cost</th></tr></thead>
                          <tbody>
                            {res.legs.map((l) => {
                              const ov = overrides[combo.id]?.[l.token.id]?.source ?? 'poly-taker';
                              return (
                                <tr key={l.token.id}>
                                  <td>{l.token.label}</td>
                                  <td className="mono">
                                    {l.poly?.found ? `${l.poly.bid.toFixed(2)} / ${l.poly.ask.toFixed(2)}` : <span className="err">not on Poly</span>}
                                    {l.poly?.illiquid && <span className="illiq"> ⚠ wide</span>}
                                  </td>
                                  <td>
                                    <select value={ov} onChange={(e) => setSource(combo.id, l.token.id, e.target.value as LegSource)}>
                                      <option value="poly-taker">Poly take</option>
                                      <option value="poly-maker">Poly rest</option>
                                      <option value="manual">Bookie</option>
                                    </select>
                                    {ov === 'manual' && <input className="mcoef" placeholder="coef" inputMode="decimal"
                                      onChange={(e) => setManual(combo.id, l.token.id, e.target.value)} />}
                                  </td>
                                  <td className="mono">{l.cost > 0 ? l.cost.toFixed(3) : '—'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {res.coefWarning && <p className="warn">⚠️ {res.coefWarning}</p>}
                      </div>
                    </td></tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="sub">Combos are a hardcoded, machine-verified library (every scoreline checked). Browser-only —
        fetches Polymarket directly. Not financial advice.</p>
    </div>
  );
}

// compress a leg label for the list
function shortLeg(l: string): string {
  return l
    .replace('Total Goals: ', '').replace('Result: ', '').replace('Home Total: ', 'Home ')
    .replace('Away Total: ', 'Away ').replace('Double Chance: ', '').replace(/\s*\((1X|12|X2)\)/, ' ($1)');
}
function verdictText(r: HedgeResult): string {
  if (r.kind === 'taker-lock') return `LOCK ${pct(r.edgePct)} — take now`;
  if (r.kind === 'maker-only') return `Maker ${pct(r.edgePct)} — rest to fill`;
  if (r.kind === 'missing') return 'Missing a Poly market — set that leg to Bookie';
  return `No edge ${pct(r.edgePct)}`;
}
