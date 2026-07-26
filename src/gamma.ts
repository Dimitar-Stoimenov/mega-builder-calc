// ─────────────────────────────────────────────────────────────────────────────
// BROWSER Polymarket Gamma client — no server. Gamma sends CORS `*`, so the page
// fetches it directly. Resolves a league's fixtures and each PolyMarketRef to a
// live bid/ask on the chosen match.
//
// ⚠️ If Polymarket ever drops the `*` CORS header, these fetches will fail from the
// browser and a thin proxy would be needed. (Verified `*` at build time.)
// ─────────────────────────────────────────────────────────────────────────────

import type { PolyMarketRef } from './combos.ts';

const GAMMA = 'https://gamma-api.polymarket.com';

/** A league selector: a tag id OR a series id (some leagues are series-only). */
export type LeagueRef = { tag: number } | { series: number };

/** Known leagues (mirrors poly-odds-board). Series-only ones use `series`. */
export const LEAGUES: Record<string, LeagueRef & { label: string }> = {
  ucl: { tag: 100977, label: 'Champions League' },
  uel: { tag: 101787, label: 'Europa League' },
  ecl: { tag: 102763, label: 'Conference League' },
  denmark: { tag: 102652, label: 'Denmark Superliga' },
  sweden: { tag: 104930, label: 'Sweden Allsvenskan' },
  norway: { tag: 102651, label: 'Norway Eliteserien' },
  bulgaria: { tag: 104936, label: 'Bulgaria First League' },
  serbia: { tag: 104932, label: 'Serbia SuperLiga' },
  romania: { series: 10971, label: 'Romania SuperLiga' },
  tennis: { tag: 864, label: 'Tennis' },
};

export interface RawMarket {
  question: string;
  outcomes: string[];
  bestBid: number | null;
  bestAsk: number | null;
  gameStartTime?: string | null;
}
export interface Fixture {
  title: string; // "Home vs. Away"
  start: string;
  markets: RawMarket[];
}

function jsonArray(x: unknown): string[] {
  if (Array.isArray(x)) return x as string[];
  if (typeof x === 'string') { try { const v = JSON.parse(x); return Array.isArray(v) ? v : []; } catch { return []; } }
  return [];
}
function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Fetch a league's near-term fixtures (grouped by match, deduped markets). */
export async function fetchFixtures(ref: LeagueRef, windowHours = 96): Promise<Fixture[]> {
  const selector = 'series' in ref ? `series_id=${ref.series}` : `tag_id=${ref.tag}`;
  const now = Date.now(), end = now + windowHours * 3600_000;
  const byMatch: Record<string, Fixture> = {};

  for (let page = 0; page < 20; page++) {
    const url = `${GAMMA}/events?${selector}&active=true&closed=false&limit=100&offset=${page * 100}&order=startDate&ascending=true`;
    // Gamma sends `cache-control: public, max-age=300`, so the browser would serve a
    // stale (up to 5-min-old) response when you switch league→back. `no-store` forces
    // a real network hit every time, so the odds are always live.
    const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) throw new Error(`Gamma ${res.status}`);
    const body = (await res.json()) as unknown;
    const events = (Array.isArray(body) ? body : (body as { data?: unknown[] }).data ?? []) as Array<{ title?: string; markets?: unknown[] }>;
    if (events.length === 0) break;

    for (const e of events) {
      const base = (e.title ?? '').replace(/\s*-\s*(More Markets|Halftime Result|Second Half Result|Exact Score|First Team to Score|.*Handicap|.*Total.*|.*Result|.*Corners?|.*Cards?)\s*$/i, '').trim();
      if (!/ vs\.? /i.test(base)) continue;
      for (const m of (e.markets ?? []) as Array<Record<string, unknown>>) {
        const gst = m.gameStartTime as string | undefined;
        if (!gst) continue;
        const ts = Date.parse(gst);
        if (Number.isNaN(ts) || ts < now || ts > end) continue;
        const g = (byMatch[base] ??= { title: base, start: gst, markets: [] });
        g.markets.push({
          question: (m.question as string) ?? '',
          outcomes: jsonArray(m.outcomes),
          bestBid: num(m.bestBid),
          bestAsk: num(m.bestAsk),
        });
      }
    }
    if (events.length < 100) break;
  }
  const out = Object.values(byMatch);
  for (const g of out) {
    const seen = new Set<string>();
    g.markets = g.markets.filter((m) => (seen.has(m.question) ? false : (seen.add(m.question), true)));
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

// ── resolve a PolyMarketRef on a fixture to {bid, ask} on the side we BUY ───────

export interface Quote { bid: number; ask: number; label: string; found: boolean; }

const deburr = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const teamName = (title: string, which: 'home' | 'away') => {
  const p = title.split(/\s+vs\.?\s+/i);
  return (which === 'home' ? p[0] : p[1] ?? '').trim();
};
/** distinctive tokens of a team name (drop club-type + short words). */
const teamTokens = (team: string): string[] =>
  deburr(team).replace(/\b(fc|fk|sk|pfc|pofc|cs|as|sc|bk|if|il)\b/g, '').split(/\s+/).filter((w) => w.length > 2);

/** how many of a team's tokens appear in a question. */
const teamScore = (q: string, team: string): number => {
  const dq = deburr(q);
  return teamTokens(team).filter((w) => dq.includes(w)).length;
};

/**
 * Pick the win-market for `want` over `other`. A win market names ONE team; when the
 * two teams share a city word, choose the market whose `want`-token count exceeds its
 * `other`-token count (the distinctive tokens decide, not the shared "Varna").
 */
function bestWinMarket(wins: RawMarket[], want: string, other: string): RawMarket | undefined {
  let best: RawMarket | undefined;
  let bestMargin = -Infinity;
  for (const m of wins) {
    const margin = teamScore(m.question, want) - teamScore(m.question, other);
    if (margin > bestMargin) { bestMargin = margin; best = m; }
  }
  return bestMargin > 0 ? best : undefined; // require a positive distinctive match
}

/**
 * Find the Poly market for a ref and return the bid/ask on the OUTCOME WE BUY.
 * Poly quotes the "Yes"/"Over"/"first-listed" token; complements are 1 - that side.
 */
export function resolveQuote(fx: Fixture, ref: PolyMarketRef): Quote {
  const miss = (label: string): Quote => ({ bid: 0, ask: 0, label, found: false });
  const M = fx.markets;

  const twoWay = (mk: RawMarket | undefined, buyComplement: boolean, label: string): Quote => {
    if (!mk || mk.bestBid == null || mk.bestAsk == null) return miss(label);
    // Poly quotes the primary token (Yes/Over). buying it: bid/ask as-is.
    // buying the complement: cost = 1 - primary; bid_c = 1 - ask, ask_c = 1 - bid.
    return buyComplement
      ? { bid: 1 - mk.bestAsk, ask: 1 - mk.bestBid, label, found: true }
      : { bid: mk.bestBid, ask: mk.bestAsk, label, found: true };
  };

  switch (ref.kind) {
    case 'btts': {
      const mk = M.find((m) => /:\s*both teams to score$/i.test(m.question));
      return twoWay(mk, ref.side === 'no', `BTTS ${ref.side}`);
    }
    case 'draw': {
      const mk = M.find((m) => /end in a draw/i.test(m.question));
      return twoWay(mk, ref.side === 'no', `Draw ${ref.side}`);
    }
    case 'win': {
      // Assign each "…win on <date>?" market to home/away by BEST distinctive-token
      // match — teams sharing a city word ("Cherno More Varna" vs "Spartak Varna")
      // otherwise mis-match on "Varna" and pick the wrong side (fake huge edges).
      const home = teamName(fx.title, 'home'), away = teamName(fx.title, 'away');
      const wins = M.filter((m) => /win on \d{4}/i.test(m.question));
      const mk = bestWinMarket(wins, ref.team === 'home' ? home : away, ref.team === 'home' ? away : home);
      const team = ref.team === 'home' ? home : away;
      return twoWay(mk, ref.side === 'no', `${team} win ${ref.side}`);
    }
    case 'ou': {
      const mk = M.find((m) => new RegExp(`:\\s*O/U ${ref.line}$`, 'i').test(m.question));
      return twoWay(mk, ref.side === 'under', `O/U ${ref.line} ${ref.side}`);
    }
    case 'exact': {
      const mk = M.find((m) => new RegExp(`exact score:.*\\b${ref.h}\\s*-\\s*${ref.a}\\b`, 'i').test(m.question));
      return twoWay(mk, false, `Exact ${ref.h}-${ref.a}`); // buy the YES token
    }
    case 'winToNil': {
      // Poly may not always list "win to nil" directly; try a couple of phrasings.
      const team = teamName(fx.title, ref.team);
      const other = teamName(fx.title, ref.team === 'home' ? 'away' : 'home');
      const wtn = M.filter((m) => /win to nil|to win to nil|clean sheet win/i.test(m.question));
      const mk = wtn.find((m) => teamScore(m.question, team) > teamScore(m.question, other));
      return twoWay(mk, false, `${team} win to nil`);
    }
  }
}
