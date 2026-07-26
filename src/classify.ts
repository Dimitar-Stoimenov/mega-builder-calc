// ─────────────────────────────────────────────────────────────────────────────
// LEG CLASSIFIER — free-typed legs -> a known combo from the library.
//
// You type each leg loosely ("BTTS", "over 2.5", "draw", "home win", "1X", ...).
// We normalize each to a canonical token, build an order-independent SIGNATURE, and
// match it to a COMBOS entry by its own signature. If nothing matches, we return a
// clear "unsupported" result — never a guess (that was the bug-class in boost-check).
// ─────────────────────────────────────────────────────────────────────────────

import { COMBOS, type Combo, type Score } from './combos.ts';

/** A canonical leg token. */
export type Leg =
  | { t: 'btts' }
  | { t: 'draw' }
  | { t: 'win'; team: 'home' | 'away' }
  | { t: 'dc'; kind: '1x' | '12' | 'x2' } // double chance
  | { t: 'over'; line: number }
  | { t: 'teamOver'; team: 'home' | 'away'; line: number };

/** Parse one free-typed leg string to a canonical Leg, or null if unrecognised. */
export function parseLeg(raw: string): Leg | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;

  // BTTS / both teams to score / gg
  if (/\bbtts\b|both teams? to score|\bgg\b/.test(s) && !/no|\bng\b/.test(s)) return { t: 'btts' };

  // double chance
  if (/\b1x\b|home or draw|draw or home/.test(s)) return { t: 'dc', kind: '1x' };
  if (/\b12\b|home or away|away or home|no draw/.test(s)) return { t: 'dc', kind: '12' };
  if (/\bx2\b|draw or away|away or draw/.test(s)) return { t: 'dc', kind: 'x2' };

  // draw / result
  if (/^draw$|result.*draw|\bdraw\b(?!.*or)/.test(s)) return { t: 'draw' };

  // win (team)
  if (/home.*win|win.*home|\b1\b(?!\.\d)|host.*win/.test(s) && /win|^1$/.test(s)) return { t: 'win', team: 'home' };
  if (/away.*win|win.*away|\b2\b(?!\.\d)|guest.*win/.test(s) && /win|^2$/.test(s)) return { t: 'win', team: 'away' };

  // team total over N ("home over 0.5", "away total over 1.5")
  let m = /(home|away)\b.*over\s*(\d+(?:\.\d)?)/.exec(s);
  if (m) return { t: 'teamOver', team: m[1] as 'home' | 'away', line: parseFloat(m[2]) };

  // total goals over N
  m = /over\s*(\d+(?:\.\d)?)/.exec(s);
  if (m) return { t: 'over', line: parseFloat(m[1]) };

  return null;
}

/** Order-independent signature for a set of legs (so leg order never matters). */
export function signature(legs: Leg[]): string {
  return legs
    .map((l) => {
      switch (l.t) {
        case 'btts': return 'btts';
        case 'draw': return 'draw';
        case 'win': return `win:${l.team}`;
        case 'dc': return `dc:${l.kind}`;
        case 'over': return `over:${l.line}`;
        case 'teamOver': return `tover:${l.team}:${l.line}`;
      }
    })
    .sort()
    .join('|');
}

/** Signature of a library combo, derived from its own legs via the same parser. */
function comboSignature(c: Combo): string {
  const legs = c.legs.map((l) => parseLeg(comboLegToTypable(l))).filter((x): x is Leg => x !== null);
  return signature(legs);
}

/** COMBOS[].legs are human labels ("Double Chance: Home or Draw (1X)"); map to a
 *  string parseLeg understands, so a combo's signature is computed the same way as
 *  user input. Kept tiny + explicit. */
function comboLegToTypable(label: string): string {
  const s = label.toLowerCase();
  if (/both teams to score/.test(s)) return 'btts';
  if (/1x|home or draw/.test(s)) return '1x';
  if (/12|home or away/.test(s)) return '12';
  if (/x2|draw or away/.test(s)) return 'x2';
  if (/result:\s*draw|^draw$/.test(s)) return 'draw';
  if (/home win/.test(s)) return 'home win';
  if (/away win/.test(s)) return 'away win';
  let m = /(home|away) total:\s*over\s*(\d+(?:\.\d)?)/.exec(s);
  if (m) return `${m[1]} over ${m[2]}`;
  m = /over\s*(\d+(?:\.\d)?)/.exec(s);
  if (m) return `over ${m[1]}`;
  return label;
}

// precompute the signature -> combo map once
const BY_SIG = new Map<string, Combo>();
for (const c of COMBOS) BY_SIG.set(comboSignature(c), c);

export type ClassifyResult =
  | { ok: true; combo: Combo; legs: Leg[] }
  | { ok: false; reason: string; legs: (Leg | null)[] };

/** Classify free-typed leg strings to a known combo, or explain why not. */
export function classify(rawLegs: string[]): ClassifyResult {
  const parsed = rawLegs.map(parseLeg);
  const bad = rawLegs.filter((_, i) => parsed[i] === null);
  if (bad.length) return { ok: false, reason: `couldn't read leg(s): ${bad.map((b) => `"${b}"`).join(', ')}`, legs: parsed };

  const legs = parsed as Leg[];
  const sig = signature(legs);
  const combo = BY_SIG.get(sig);
  if (!combo) return { ok: false, reason: `no hedgeable combo for legs [${sig}] — not in the verified library`, legs };
  return { ok: true, combo, legs };
}

/** Re-exported for the UI. */
export type { Combo, Score };
