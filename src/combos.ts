// ─────────────────────────────────────────────────────────────────────────────
// THE COMBO LIBRARY  ← review this together
//
// A "mega bet-builder" boost = N legs the bookie ANDs at a boosted coefficient.
// You LOCK it by BUYING, on Polymarket, every outcome where the boost LOSES
// (the complement of the AND). If those tokens cost (fee-adjusted) < 1/coef, profit.
//
// Every entry is AUDITABLE and MACHINE-CHECKED (see combos.test.ts):
//   • `legs`    — the human bookie legs
//   • `winPred` — given a final score (h,a), does the boost WIN? (= AND of the legs)
//   • `hedge`   — the Poly tokens to BUY; each has a `pays` predicate + a `market` ref
//                 (which Poly market/outcome, so the gamma layer can price it).
//
// The test iterates EVERY scoreline 0-0 … 10-10 and asserts the hedge:
//   (1) pays on EVERY losing score          (complete — you always get covered)
//   (2) pays on NO winning score            (clean   — no wasted outlay / broken lock)
//   (3) uses only Poly-BUILDABLE tokens      (exact scores ≤ 3-3, or a whole-market
//                                             outcome like BTTS-No / Draw-No / Win-to-Nil)
//
// ⚠️ POLY 3-3 CEILING: Polymarket lists exact-score tokens only up to 3-3; higher
// scores collapse into "Any Other Score" (unusable as a hedge — it also pays on
// high-scoring WINS). So a combo whose lose-region needs a 4-0 / 5-4 exact token is
// NOT lockable and is excluded — unless a whole-market token (e.g. "Win to Nil")
// captures that region cleanly. Bookies DO list 4-0 etc.; we just can't hedge it 1:1.
// ─────────────────────────────────────────────────────────────────────────────

export type Score = { h: number; a: number };
export type ScorePred = (s: Score) => boolean;

/**
 * Which Poly market + side each hedge token is. The gamma layer resolves these to a
 * concrete bid/ask on the chosen fixture; the UI lets you override any leg with a
 * manually-typed bookie coef (Poly exact-score atoms are often thin/mispriced).
 *
 *   btts   -> "…: Both Teams to Score"   (buy 'no')
 *   draw   -> "Will … end in a draw?"    (buy 'no' or 'yes')
 *   win    -> "Will {team} win …?"        (buy 'no' or 'yes'); side which=home|away
 *   winToNil -> "{team} to win to nil"    (buy 'yes')  — home/away
 *   ou     -> "…: O/U <line>" goals       (buy 'under' = complement of the Over)
 *   exact  -> "Exact Score: … h-a?"       (buy 'yes')  — only h,a ≤ 3
 */
export type PolyMarketRef =
  | { kind: 'btts'; side: 'yes' | 'no' }
  | { kind: 'draw'; side: 'yes' | 'no' }
  | { kind: 'win'; team: 'home' | 'away'; side: 'yes' | 'no' }
  | { kind: 'winToNil'; team: 'home' | 'away' }
  | { kind: 'ou'; line: string; side: 'over' | 'under' }
  | { kind: 'exact'; h: number; a: number };

export interface HedgeToken {
  id: string;
  label: string;
  market: PolyMarketRef;
  /** does this token RESOLVE YES on scoreline (h,a)? (for verification) */
  pays: ScorePred;
}

export interface Combo {
  id: string;
  /** optional short display name for the list (falls back to legs joined) */
  label?: string;
  /**
   * A "jewel": the boost inflates a LOGICALLY REDUNDANT leg (no real added risk) AND
   * the hedge uses only markets Poly ALWAYS lists (BTTS/Draw/exact-score/O-U). These
   * are the best to hunt and are pinned to the top. NOTE: combos needing "win to nil"
   * are NOT jewels — Poly frequently doesn't list that market, so they're unreliable.
   */
  jewel?: boolean;
  /** human bookie legs */
  legs: string[];
  /** number of bookie selections (for the min-coef gate: 2-leg≥2.00, 3-leg≥3.00) */
  legCount: number;
  /** boost WINS iff this holds for the final score */
  winPred: ScorePred;
  /** tokens to BUY on Poly covering the whole lose-region */
  hedge: HedgeToken[];
  /** one-liner shown in the UI */
  note: string;
}

// ── leg predicates ───────────────────────────────────────────────────────────
const btts: ScorePred = ({ h, a }) => h >= 1 && a >= 1;
const over = (line: number): ScorePred => ({ h, a }) => h + a > line;
const draw: ScorePred = ({ h, a }) => h === a;
const homeWin: ScorePred = ({ h, a }) => h > a;
const awayWin: ScorePred = ({ h, a }) => a > h;
const teamOver = (team: 'home' | 'away', line: number): ScorePred =>
  ({ h, a }) => (team === 'home' ? h : a) > line;

// ── token predicates ─────────────────────────────────────────────────────────
const exactP = (H: number, A: number): ScorePred => ({ h, a }) => h === H && a === A;

// token builders
const noBtts: HedgeToken = { id: 'no-btts', label: 'BTTS = No', market: { kind: 'btts', side: 'no' }, pays: (s) => !btts(s) };
const noDraw: HedgeToken = { id: 'no-draw', label: 'Draw = No', market: { kind: 'draw', side: 'no' }, pays: (s) => !draw(s) };
const yesDraw: HedgeToken = { id: 'draw', label: 'Draw = Yes', market: { kind: 'draw', side: 'yes' }, pays: draw };
const noHomeWin: HedgeToken = { id: 'no-home', label: 'Home Win = No', market: { kind: 'win', team: 'home', side: 'no' }, pays: (s) => !homeWin(s) };
const noAwayWin: HedgeToken = { id: 'no-away', label: 'Away Win = No', market: { kind: 'win', team: 'away', side: 'no' }, pays: (s) => !awayWin(s) };
const yesAwayWin: HedgeToken = { id: 'away-win', label: 'Away Win = Yes', market: { kind: 'win', team: 'away', side: 'yes' }, pays: awayWin };
// Win-to-nil = a team wins with a clean sheet. This is the ONLY clean way to cover the
// "home wins, opponent scores 0" region: it partitions DISJOINTLY from Win-No (one is
// "home doesn't win", the other is "home wins to nil" — no overlap). We deliberately do
// NOT use "opponent Under 0.5" — that overlaps Win-No on 0-0, which muddies leg sizing
// (a trap: easy to mis-size and think you're locked when you're not).
const homeWTN: HedgeToken = { id: 'home-wtn', label: 'Home Win to Nil', market: { kind: 'winToNil', team: 'home' }, pays: ({ h, a }) => h > a && a === 0 };
const awayWTN: HedgeToken = { id: 'away-wtn', label: 'Away Win to Nil', market: { kind: 'winToNil', team: 'away' }, pays: ({ h, a }) => a > h && h === 0 };
const under = (line: string): HedgeToken => ({ id: `under-${line}`, label: `Under ${line}`, market: { kind: 'ou', line, side: 'under' }, pays: (s) => !over(parseFloat(line))(s) });
const exact = (H: number, A: number): HedgeToken => ({ id: `${H}-${A}`, label: `Exact ${H}-${A}`, market: { kind: 'exact', h: H, a: A }, pays: exactP(H, A) });

// ─────────────────────────────────────────────────────────────────────────────
// THE LIBRARY — all entries verified LOCKABLE (sound + Poly-buildable). Review!
// ─────────────────────────────────────────────────────────────────────────────
export const COMBOS: Combo[] = [
  {
    id: 'btts+over2.5',
    jewel: true,
    legs: ['BTTS: Yes', 'Total Goals: Over 2.5'],
    legCount: 2,
    winPred: (s) => btts(s) && over(2.5)(s),
    hedge: [noBtts, exact(1, 1)],
    note: 'Loses on No-BTTS or 1-1 (the only both-score score under 3 goals).',
  },
  {
    id: 'btts+over1.5',
    label: 'BTTS + O1.5',
    legs: ['BTTS: Yes', 'Total Goals: Over 1.5'],
    legCount: 2,
    // THE cleanest jewel: BTTS ⇒ ≥2 goals, so Over 1.5 can NEVER fail — it's a pure
    // boost-freebie leg. Collapses to just BTTS. Single-token hedge (BTTS-No), a deep
    // liquid market on every game. The bookie boosts it as a 2-leg but the real risk is 1.
    winPred: (s) => btts(s) && over(1.5)(s),
    hedge: [noBtts],
    note: 'Over 1.5 is implied by BTTS — a free boosted leg. Single-token hedge: buy BTTS-No.',
  },
  {
    id: 'draw+over3.5',
    legs: ['Result: Draw', 'Total Goals: Over 3.5'],
    legCount: 2,
    // Draws with ≥4 goals win (2-2, 3-3, …). Under-draws (0-0, 1-1) lose. 2-2 = 4 goals = Over 3.5 = win.
    // SAME hedge as Draw+Over2.5 but a FATTER coef (Over 3.5 is a longer shot). Preferred.
    winPred: (s) => draw(s) && over(3.5)(s),
    hedge: [noDraw, exact(0, 0), exact(1, 1)],
    note: 'Same hedge as Draw+O2.5 (0-0, 1-1 are the only sub-4-goal draws) but a bigger coef. Buy Draw-No + 0-0 + 1-1.',
  },
  {
    id: 'draw+over2.5',
    legs: ['Result: Draw', 'Total Goals: Over 2.5'],
    legCount: 2,
    winPred: (s) => draw(s) && over(2.5)(s),
    hedge: [noDraw, exact(0, 0), exact(1, 1)],
    note: 'Loses on No-Draw, 0-0, or 1-1. (Prefer Draw+O3.5 — identical hedge, fatter coef.)',
  },
  {
    id: 'draw+btts',
    jewel: true,
    legs: ['Result: Draw', 'BTTS: Yes'],
    legCount: 2,
    // draw & both score = 1-1, 2-2, 3-3, … Loses on: No-Draw ∪ 0-0 (only draw with no BTTS).
    winPred: (s) => draw(s) && btts(s),
    hedge: [noDraw, exact(0, 0)],
    note: 'A draw where both score can only be 1-1/2-2/… Loses on No-Draw or 0-0. Buy Draw-No + 0-0.',
  },
  {
    id: 'draw+btts+over1.5',
    label: 'Draw + BTTS + O1.5',
    legs: ['Result: Draw', 'BTTS: Yes', 'Total Goals: Over 1.5'],
    legCount: 3,
    // Draw+BTTS already ⇒ ≥2 goals, so Over 1.5 is redundant. A 3-leg workaround for the
    // ≥3.00 coef rule that hedges identically to Draw+BTTS.
    winPred: (s) => draw(s) && btts(s) && over(1.5)(s),
    hedge: [noDraw, exact(0, 0)],
    note: '3-leg version of Draw+BTTS (Over 1.5 is implied). Same hedge: Draw-No + 0-0.',
  },
  {
    id: 'draw+teamover0.5x2',
    legs: ['Result: Draw', 'Home Total: Over 0.5', 'Away Total: Over 0.5'],
    legCount: 3,
    // "both teams over 0.5" = both score = BTTS. So this ≡ Draw+BTTS as a 3-leg. Same hedge.
    winPred: (s) => draw(s) && teamOver('home', 0.5)(s) && teamOver('away', 0.5)(s),
    hedge: [noDraw, exact(0, 0)],
    note: '3-leg Draw+BTTS workaround (team O0.5 ×2 = both score). Same hedge: Draw-No + 0-0.',
  },
  {
    id: 'homewin+over1.5',
    legs: ['Home Win', 'Total Goals: Over 1.5'],
    legCount: 2,
    // home win with ≥2 goals. Loses on: not-home-win ∪ 1-0 (only home win under 2 goals).
    winPred: (s) => homeWin(s) && over(1.5)(s),
    hedge: [noHomeWin, exact(1, 0)],
    note: 'Loses on Not-Home-Win or 1-0. Buy Home-Win-No + 1-0.',
  },
  {
    id: 'awaywin+over1.5',
    legs: ['Away Win', 'Total Goals: Over 1.5'],
    legCount: 2,
    winPred: (s) => awayWin(s) && over(1.5)(s),
    hedge: [noAwayWin, exact(0, 1)],
    note: 'Loses on Not-Away-Win or 0-1. Buy Away-Win-No + 0-1.',
  },
  {
    id: 'homewin+over2.5',
    legs: ['Home Win', 'Total Goals: Over 2.5'],
    legCount: 2,
    // home win with ≥3 goals. Home wins under 3 goals = 1-0, 2-0. (2-1 = 3 goals = win.)
    winPred: (s) => homeWin(s) && over(2.5)(s),
    hedge: [noHomeWin, exact(1, 0), exact(2, 0)],
    note: 'Loses on Not-Home-Win, 1-0, or 2-0 (2-1 is a win — 3 goals). Buy Home-Win-No + 1-0 + 2-0.',
  },
  {
    id: 'homewin+btts+over1.5',
    label: 'Home Win + BTTS + O1.5',
    legs: ['Home Win', 'BTTS: Yes', 'Total Goals: Over 1.5'],
    legCount: 3,
    // A home win where both teams score is ALWAYS ≥3 goals (min 2-1), so BOTH Over 1.5
    // and Over 2.5 are redundant boost-freebie legs → collapses to Home Win + BTTS.
    // Loses on the DISJOINT union: Not-Home-Win ∪ Home-Win-to-Nil. Requires the Poly
    // "win to nil" market; if it's missing this combo shows as not-hedgeable (we do NOT
    // fall back to team-Under-0.5, which overlaps 0-0 and muddies sizing).
    winPred: (s) => homeWin(s) && btts(s) && over(1.5)(s),
    hedge: [noHomeWin, homeWTN],
    note: 'Over 1.5 is implied (win+BTTS ⇒ ≥3 goals) — a free boosted leg. Loses on Not-Home-Win or Home Win-to-Nil (disjoint). Buy Home-Win-No + Home-Win-to-Nil.',
  },
  {
    id: 'awaywin+btts+over1.5',
    label: 'Away Win + BTTS + O1.5',
    legs: ['Away Win', 'BTTS: Yes', 'Total Goals: Over 1.5'],
    legCount: 3,
    winPred: (s) => awayWin(s) && btts(s) && over(1.5)(s),
    hedge: [noAwayWin, awayWTN],
    note: 'Over 1.5 is implied (win+BTTS ⇒ ≥3 goals) — a free boosted leg. Loses on Not-Away-Win or Away Win-to-Nil (disjoint). Buy Away-Win-No + Away-Win-to-Nil.',
  },
  {
    id: 'homewin+btts',
    label: 'Home Win + BTTS',
    legs: ['Home Win', 'BTTS: Yes'],
    legCount: 2,
    winPred: (s) => homeWin(s) && btts(s),
    hedge: [noHomeWin, homeWTN],
    note: 'Loses on Not-Home-Win or Home Win-to-Nil (disjoint). Buy Home-Win-No + Home-Win-to-Nil.',
  },
  {
    id: 'awaywin+btts',
    label: 'Away Win + BTTS',
    legs: ['Away Win', 'BTTS: Yes'],
    legCount: 2,
    winPred: (s) => awayWin(s) && btts(s),
    hedge: [noAwayWin, awayWTN],
    note: 'Loses on Not-Away-Win or Away Win-to-Nil (disjoint). Buy Away-Win-No + Away-Win-to-Nil.',
  },
  {
    id: '1x+over0.5',
    legs: ['Double Chance: Home or Draw (1X)', 'Total Goals: Over 0.5'],
    legCount: 2,
    // 1X = home doesn't lose (h ≥ a). With ≥1 goal. Loses on: away-win ∪ 0-0.
    winPred: (s) => s.h >= s.a && over(0.5)(s),
    hedge: [yesAwayWin, exact(0, 0)],
    note: 'Loses on Away-Win or 0-0. Buy Away-Win (Yes) + 0-0.',
  },
  {
    id: '12+over1.5',
    legs: ['Double Chance: Home or Away (12, no draw)', 'Total Goals: Over 1.5'],
    legCount: 2,
    // 12 = not a draw, with ≥2 goals. Loses on: draw ∪ (not-draw under 2 goals = 1-0, 0-1).
    winPred: (s) => !draw(s) && over(1.5)(s),
    hedge: [yesDraw, exact(1, 0), exact(0, 1)],
    note: 'Loses on Draw, 1-0, or 0-1. Buy Draw (Yes) + 1-0 + 0-1.',
  },
  {
    id: 'homewin+over1.5+homeover0.5',
    legs: ['Home Win', 'Total Goals: Over 1.5', 'Home Total: Over 0.5'],
    legCount: 3,
    // "Home over 0.5" is implied by a home win (h > a ⇒ h ≥ 1). 3-leg coef-rule
    // workaround that hedges IDENTICALLY to HomeWin+O1.5 but at a fatter ≥3.00 coef.
    winPred: (s) => homeWin(s) && over(1.5)(s) && teamOver('home', 0.5)(s),
    hedge: [noHomeWin, exact(1, 0)],
    note: '3-leg version of HomeWin+O1.5 (Home-O0.5 is implied by the win). Same hedge: Home-Win-No + 1-0.',
  },
  {
    id: 'awaywin+over1.5+awayover0.5',
    legs: ['Away Win', 'Total Goals: Over 1.5', 'Away Total: Over 0.5'],
    legCount: 3,
    winPred: (s) => awayWin(s) && over(1.5)(s) && teamOver('away', 0.5)(s),
    hedge: [noAwayWin, exact(0, 1)],
    note: '3-leg version of AwayWin+O1.5 (Away-O0.5 implied). Same hedge: Away-Win-No + 0-1.',
  },
  {
    id: 'homewin+over2.5+homeover0.5',
    legs: ['Home Win', 'Total Goals: Over 2.5', 'Home Total: Over 0.5'],
    legCount: 3,
    winPred: (s) => homeWin(s) && over(2.5)(s) && teamOver('home', 0.5)(s),
    hedge: [noHomeWin, exact(1, 0), exact(2, 0)],
    note: '3-leg version of HomeWin+O2.5 (Home-O0.5 implied). Same hedge: Home-Win-No + 1-0 + 2-0.',
  },
  {
    id: 'over1.5+over2.5',
    label: 'Over 1.5 + Over 2.5',
    legs: ['Total Goals: Over 1.5', 'Total Goals: Over 2.5'],
    legCount: 2,
    // Over 2.5 ⊂ Over 1.5 → collapses to Over 2.5. Legal nested-totals trick for a fat 2/3-leg coef.
    winPred: (s) => over(1.5)(s) && over(2.5)(s),
    hedge: [under('2.5')],
    note: 'Over 1.5 is implied by Over 2.5 → just Over 2.5. Buy Under 2.5.',
  },
];

/** Grid bound for verification — well beyond Poly's 3-3, to catch high-score leaks. */
export const MAX_GOALS = 10;
/** True if an exact-score token is actually offered on Poly (≤ 3-3). */
export const isPolyBuildable = (t: HedgeToken): boolean =>
  t.market.kind !== 'exact' || (t.market.h <= 3 && t.market.a <= 3);
