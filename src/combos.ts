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
const yesHomeWin: HedgeToken = { id: 'home-win', label: 'Home Win = Yes', market: { kind: 'win', team: 'home', side: 'yes' }, pays: homeWin };
// Win-to-nil = a team wins with a clean sheet. This is the ONLY clean way to cover the
// "home wins, opponent scores 0" region: it partitions DISJOINTLY from Win-No (one is
// "home doesn't win", the other is "home wins to nil" — no overlap). We deliberately do
// NOT use "opponent Under 0.5" — that overlaps Win-No on 0-0, which muddies leg sizing
// (a trap: easy to mis-size and think you're locked when you're not).
const homeWTN: HedgeToken = { id: 'home-wtn', label: 'Home Win to Nil', market: { kind: 'winToNil', team: 'home' }, pays: ({ h, a }) => h > a && a === 0 };
const awayWTN: HedgeToken = { id: 'away-wtn', label: 'Away Win to Nil', market: { kind: 'winToNil', team: 'away' }, pays: ({ h, a }) => a > h && h === 0 };
const exact = (H: number, A: number): HedgeToken => ({ id: `${H}-${A}`, label: `Exact ${H}-${A}`, market: { kind: 'exact', h: H, a: A }, pays: exactP(H, A) });
// Whole-market O/U and BTTS-Yes tokens (2026-10-11 additions — the deepest Poly soccer books, no thin exact scores).
const ouTok = (line: string, side: 'over' | 'under'): HedgeToken => ({
  id: `${side}-${line}`, label: `${side === 'over' ? 'Over' : 'Under'} ${line}`, market: { kind: 'ou', line, side },
  pays: side === 'over' ? over(parseFloat(line)) : (s) => !over(parseFloat(line))(s),
});
const yesBtts: HedgeToken = { id: 'btts', label: 'BTTS = Yes', market: { kind: 'btts', side: 'yes' }, pays: btts };
const under = (line: number): ScorePred => (s) => !over(line)(s);

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
    id: 'draw+over3.5+btts',
    label: 'Draw + O3.5 + BTTS',
    legs: ['Result: Draw', 'Total Goals: Over 3.5', 'BTTS: Yes'],
    legCount: 3,
    // A draw with ≥4 goals is 2-2 or higher, so BOTH teams have scored ≥2 — BTTS can never
    // fail here. That makes BTTS (~0.5 on a typical game) a FREE leg, roughly doubling the
    // coef over plain Draw+O3.5 for an identical hedge. The best free leg in the library.
    winPred: (s) => draw(s) && over(3.5)(s) && btts(s),
    hedge: [noDraw, exact(0, 0), exact(1, 1)],
    note: 'BTTS is implied (a 4+ goal draw is 2-2 or bigger) — a free ~2.0 leg. Same hedge as Draw+O3.5: Draw-No + 0-0 + 1-1.',
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
    jewel: true,
    legs: ['Home Win', 'Total Goals: Over 1.5'],
    legCount: 2,
    // home win with ≥2 goals. Loses on: not-home-win ∪ 1-0 (only home win under 2 goals).
    winPred: (s) => homeWin(s) && over(1.5)(s),
    hedge: [noHomeWin, exact(1, 0)],
    note: 'Loses on Not-Home-Win or 1-0. Buy Home-Win-No + 1-0.',
  },
  {
    id: 'awaywin+over1.5',
    jewel: true,
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
    id: 'awaywin+over2.5',
    legs: ['Away Win', 'Total Goals: Over 2.5'],
    legCount: 2,
    // Mirror of HomeWin+O2.5. Away wins under 3 goals = 0-1, 0-2. (1-2 = 3 goals = win.)
    winPred: (s) => awayWin(s) && over(2.5)(s),
    hedge: [noAwayWin, exact(0, 1), exact(0, 2)],
    note: 'Loses on Not-Away-Win, 0-1, or 0-2 (1-2 is a win — 3 goals). Buy Away-Win-No + 0-1 + 0-2.',
  },
  {
    id: 'homewin+btts+over2.5',
    label: 'Home Win + BTTS + O2.5',
    legs: ['Home Win', 'BTTS: Yes', 'Total Goals: Over 2.5'],
    legCount: 3,
    // STRICTLY BETTER than the +O1.5 version: a home win where both score is at minimum
    // 2-1 = 3 goals, so Over *2.5* is just as implied as Over 1.5 — and it's the fatter
    // price (~0.5 vs ~0.75). Identical hedge, bigger coef. Prefer this over +O1.5.
    winPred: (s) => homeWin(s) && btts(s) && over(2.5)(s),
    hedge: [noHomeWin, homeWTN],
    note: 'Over 2.5 is implied (win+BTTS ⇒ ≥3 goals) and is a FATTER free leg than O1.5 — prefer this. Same hedge: Home-Win-No + Home-Win-to-Nil.',
  },
  {
    id: 'awaywin+btts+over2.5',
    label: 'Away Win + BTTS + O2.5',
    legs: ['Away Win', 'BTTS: Yes', 'Total Goals: Over 2.5'],
    legCount: 3,
    winPred: (s) => awayWin(s) && btts(s) && over(2.5)(s),
    hedge: [noAwayWin, awayWTN],
    note: 'Over 2.5 is implied (win+BTTS ⇒ ≥3 goals) and is a FATTER free leg than O1.5 — prefer this. Same hedge: Away-Win-No + Away-Win-to-Nil.',
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
    id: 'x2+over0.5',
    legs: ['Double Chance: Draw or Away (X2)', 'Total Goals: Over 0.5'],
    legCount: 2,
    // Mirror of 1X+O0.5. X2 = away doesn't lose (a ≥ h). With ≥1 goal. Loses on: home-win ∪ 0-0.
    winPred: (s) => s.a >= s.h && over(0.5)(s),
    hedge: [yesHomeWin, exact(0, 0)],
    note: 'Loses on Home-Win or 0-0. Buy Home-Win (Yes) + 0-0.',
  },
  {
    id: '1x+over0.5+homeover0.5',
    label: '1X + O0.5 + Home O0.5',
    legs: ['Double Chance: Home or Draw (1X)', 'Total Goals: Over 0.5', 'Home Total: Over 0.5'],
    legCount: 3,
    // If home doesn't lose (h ≥ a) and someone scored, then HOME scored (h ≥ 1) — the
    // third leg is implied. 3-leg coef-rule workaround, identical hedge to 1X+O0.5.
    winPred: (s) => s.h >= s.a && over(0.5)(s) && teamOver('home', 0.5)(s),
    hedge: [yesAwayWin, exact(0, 0)],
    note: '3-leg version of 1X+O0.5 (h ≥ a plus a goal ⇒ home scored). Same hedge: Away-Win (Yes) + 0-0.',
  },
  {
    id: 'x2+over0.5+awayover0.5',
    label: 'X2 + O0.5 + Away O0.5',
    legs: ['Double Chance: Draw or Away (X2)', 'Total Goals: Over 0.5', 'Away Total: Over 0.5'],
    legCount: 3,
    winPred: (s) => s.a >= s.h && over(0.5)(s) && teamOver('away', 0.5)(s),
    hedge: [yesHomeWin, exact(0, 0)],
    note: '3-leg version of X2+O0.5 (a ≥ h plus a goal ⇒ away scored). Same hedge: Home-Win (Yes) + 0-0.',
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
    id: 'homewin+over2.5+homeover0.5',
    legs: ['Home Win', 'Total Goals: Over 2.5', 'Home Total: Over 0.5'],
    legCount: 3,
    winPred: (s) => homeWin(s) && over(2.5)(s) && teamOver('home', 0.5)(s),
    hedge: [noHomeWin, exact(1, 0), exact(2, 0)],
    note: '3-leg version of HomeWin+O2.5 (Home-O0.5 implied). Same hedge: Home-Win-No + 1-0 + 2-0.',
  },
  {
    id: 'awaywin+over2.5+awayover0.5',
    legs: ['Away Win', 'Total Goals: Over 2.5', 'Away Total: Over 0.5'],
    legCount: 3,
    winPred: (s) => awayWin(s) && over(2.5)(s) && teamOver('away', 0.5)(s),
    hedge: [noAwayWin, exact(0, 1), exact(0, 2)],
    note: '3-leg version of AwayWin+O2.5 (Away-O0.5 implied). Same hedge: Away-Win-No + 0-1 + 0-2.',
  },

  // ── 2026-10-11 additions — every hedge is a DISJOINT partition of the lose-region (the library's rule: an overlap is
  // paid twice; e.g. Home-Win-No + Over 2.5 for HomeWin+U2.5 costs > $1 and can never lock). Where whole markets cannot
  // partition alone, exact scores ≤ 3-3 or Win-to-Nil fill the gap (both can be overridden per leg with a bookie coef).
  {
    id: 'homewin+under2.5',
    legs: ['Home Win', 'Total Goals: Under 2.5'],
    legCount: 2,
    winPred: (s) => homeWin(s) && under(2.5)(s),
    hedge: [ouTok('2.5', 'over'), exact(0, 0), exact(1, 1), exact(0, 1), exact(0, 2)],
    note: 'Wins on 1-0 / 2-0. Lose-region = 3+ goals ∪ {0-0, 1-1, 0-1, 0-2}. Buy Over 2.5 + those four exact scores.',
  },
  {
    id: 'awaywin+under2.5',
    legs: ['Away Win', 'Total Goals: Under 2.5'],
    legCount: 2,
    winPred: (s) => awayWin(s) && under(2.5)(s),
    hedge: [ouTok('2.5', 'over'), exact(0, 0), exact(1, 1), exact(1, 0), exact(2, 0)],
    note: 'Wins on 0-1 / 0-2. Buy Over 2.5 + 0-0, 1-1, 1-0, 2-0.',
  },
  {
    id: 'draw+under2.5',
    legs: ['Result: Draw', 'Total Goals: Under 2.5'],
    legCount: 2,
    winPred: (s) => draw(s) && under(2.5)(s),
    hedge: [ouTok('2.5', 'over'), exact(1, 0), exact(0, 1), exact(2, 0), exact(0, 2)],
    note: 'Wins on 0-0 / 1-1. Buy Over 2.5 + 1-0, 0-1, 2-0, 0-2.',
  },
  {
    id: '1x+under2.5',
    legs: ['Double Chance: Home or Draw (1X)', 'Total Goals: Under 2.5'],
    legCount: 2,
    winPred: (s) => !awayWin(s) && under(2.5)(s),
    hedge: [ouTok('2.5', 'over'), exact(0, 1), exact(0, 2)],
    note: 'Loses on 3+ goals or an away win under 3 goals. Buy Over 2.5 + 0-1 + 0-2.',
  },
  {
    id: 'x2+under2.5',
    legs: ['Double Chance: Draw or Away (X2)', 'Total Goals: Under 2.5'],
    legCount: 2,
    winPred: (s) => !homeWin(s) && under(2.5)(s),
    hedge: [ouTok('2.5', 'over'), exact(1, 0), exact(2, 0)],
    note: 'Loses on 3+ goals or a home win under 3 goals. Buy Over 2.5 + 1-0 + 2-0.',
  },
  {
    id: '12+btts',
    legs: ['Double Chance: Home or Away (12, no draw)', 'BTTS: Yes'],
    legCount: 2,
    winPred: (s) => !draw(s) && btts(s),
    hedge: [yesDraw, homeWTN, awayWTN],
    note: 'Loses on a draw or a win to nil. Buy Draw (Yes) + Home Win-to-Nil + Away Win-to-Nil (Poly often omits WTN — check it is listed).',
  },
  {
    id: '12+over2.5',
    legs: ['Double Chance: Home or Away (12, no draw)', 'Total Goals: Over 2.5'],
    legCount: 2,
    winPred: (s) => !draw(s) && over(2.5)(s),
    hedge: [yesDraw, exact(1, 0), exact(0, 1), exact(2, 0), exact(0, 2)],
    note: 'Loses on a draw or a win under 3 goals. Buy Draw (Yes) + 1-0, 0-1, 2-0, 0-2.',
  },
  {
    id: '1x+btts',
    legs: ['Double Chance: Home or Draw (1X)', 'BTTS: Yes'],
    legCount: 2,
    winPred: (s) => !awayWin(s) && btts(s),
    hedge: [yesAwayWin, exact(0, 0), homeWTN],
    note: 'Loses on an away win, 0-0, or a home win to nil. Buy Away-Win (Yes) + 0-0 + Home Win-to-Nil.',
  },
  {
    id: 'x2+btts',
    legs: ['Double Chance: Draw or Away (X2)', 'BTTS: Yes'],
    legCount: 2,
    winPred: (s) => !homeWin(s) && btts(s),
    hedge: [yesHomeWin, exact(0, 0), awayWTN],
    note: 'Loses on a home win, 0-0, or an away win to nil. Buy Home-Win (Yes) + 0-0 + Away Win-to-Nil.',
  },
  {
    id: 'over2.5+bttsno',
    legs: ['Total Goals: Over 2.5', 'BTTS: No'],
    legCount: 2,
    winPred: (s) => over(2.5)(s) && !btts(s),
    hedge: [yesBtts, exact(0, 0), exact(1, 0), exact(0, 1), exact(2, 0), exact(0, 2)],
    note: 'Wins on 3+ goals with one side blank. Buy BTTS (Yes) + 0-0, 1-0, 0-1, 2-0, 0-2.',
  },

  // ── 3-leg BTTS variants (user 2026-10-11): one team Over 0.5 is IMPLIED by BTTS → identical hedge at a ≥3.00 coef ──
  ...(['home', 'away'] as const).flatMap((team) => ([
    { dc: '12', legLabel: 'Double Chance: Home or Away (12, no draw)', hedge: [yesDraw, homeWTN, awayWTN], pred: (s: Score) => !draw(s) },
    { dc: '1x', legLabel: 'Double Chance: Home or Draw (1X)', hedge: [yesAwayWin, exact(0, 0), homeWTN], pred: (s: Score) => !awayWin(s) },
    { dc: 'x2', legLabel: 'Double Chance: Draw or Away (X2)', hedge: [yesHomeWin, exact(0, 0), awayWTN], pred: (s: Score) => !homeWin(s) },
  ]).map((v): Combo => ({
    id: `${v.dc}+btts+${team}over0.5`,
    label: `${v.dc.toUpperCase()} + BTTS + ${team === 'home' ? 'Home' : 'Away'} O0.5`,
    legs: [v.legLabel, 'BTTS: Yes', `${team === 'home' ? 'Home' : 'Away'} Total: Over 0.5`],
    legCount: 3,
    winPred: (s) => v.pred(s) && btts(s) && teamOver(team, 0.5)(s),
    hedge: v.hedge,
    note: `3-leg version of ${v.dc.toUpperCase()}+BTTS (${team} O0.5 is implied by BTTS) — same hedge, fatter 3-leg coef.`,
  }))),
];

/** Grid bound for verification — well beyond Poly's 3-3, to catch high-score leaks. */
export const MAX_GOALS = 10;
/** True if an exact-score token is actually offered on Poly (≤ 3-3). */
export const isPolyBuildable = (t: HedgeToken): boolean =>
  t.market.kind !== 'exact' || (t.market.h <= 3 && t.market.a <= 3);
