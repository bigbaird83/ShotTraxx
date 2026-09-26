import { isPuttLengthId, type PuttLengthId } from './putts';
import { finishedHoleDisplayScore } from './holeScore';
import { haversineYards } from './haversine';
import { isValidLatLng, type LatLng } from './latLng';
import type { ShotLie } from './shotLie';

/**
 * Strokes gained (Broadie method) from saved rounds only.
 *
 * SG for one stroke = expected(start) − expected(end) − 1 − penalty strokes after it.
 * Expected strokes come from a tour-pro baseline, so an amateur's numbers read
 * negative; the useful part is which category loses the most.
 *
 * - Off the tee: first shot on par 4+.
 * - Approach: par 3 tee shots and any other shot starting over ARG_MAX_YARDS from the green.
 * - Around the green: shots starting within ARG_MAX_YARDS (never a putter — putts are not shots).
 * - Putting: expected putts for the first putt's length bucket − putts.
 *
 * Each later shot uses its lie (auto from mapped outlines, or the player's tap).
 * An unknown lie reads as the mean of the fairway and rough baselines. Distance to the hole is the straight line to the
 * saved green pin (the flag position is not known). No green pin, no start GPS,
 * or no first-putt length → that stroke has no SG. The hole total
 * (expected from the tee − score) still counts; the part that could not be
 * split shows as `unsplit`. Nothing is invented.
 */

/** Broadie's "around the green" band. */
export const ARG_MAX_YARDS = 30;

/**
 * Trends average ignores shorter rounds. Scaling a 2-hole round by 9
 * would let a couple of holes swing the chart. A round's own stats screen
 * still uses every finished hole.
 */
export const SG_TRENDS_MIN_HOLES = 9;

/** First shot on a hole with no par: this long or more counts as a drive. */
export const NO_PAR_DRIVE_YARDS = 250;

/** Sane tee lengths. Outside this the scorecard yardage is ignored. */
const MIN_HOLE_YARDS = 50;
const MAX_HOLE_YARDS = 700;

type Table = readonly (readonly [number, number])[];

/** PGA Tour baseline, tee shots, by hole length in yards (Broadie, Every Shot Counts). */
const TEE_TABLE: Table = [
  [100, 2.92], [120, 2.99], [140, 2.97], [160, 2.99], [180, 3.05], [200, 3.12],
  [220, 3.17], [240, 3.25], [260, 3.45], [280, 3.65], [300, 3.71], [320, 3.79],
  [340, 3.86], [360, 3.92], [380, 3.96], [400, 3.99], [420, 4.02], [440, 4.08],
  [460, 4.17], [480, 4.28], [500, 4.41], [520, 4.54], [540, 4.65], [560, 4.74],
  [580, 4.79], [600, 4.82],
];

/** PGA Tour baseline from the fairway, yards to the hole. Starts at 20 yd; closer reads as 20. */
const FAIRWAY_TABLE: Table = [
  [20, 2.4], [40, 2.6], [60, 2.7], [80, 2.75], [100, 2.8], [120, 2.85], [140, 2.91],
  [160, 2.98], [180, 3.08], [200, 3.19], [220, 3.32], [240, 3.45], [260, 3.58],
  [280, 3.69], [300, 3.78], [320, 3.84], [340, 3.88], [360, 3.95], [380, 4.03],
  [400, 4.11], [420, 4.15], [440, 4.2], [460, 4.29], [480, 4.4], [500, 4.53],
  [520, 4.66], [540, 4.78], [560, 4.86], [580, 4.91], [600, 4.94],
];

/** PGA Tour baseline from the rough, yards to the hole. Starts at 20 yd; closer reads as 20. */
const ROUGH_TABLE: Table = [
  [20, 2.59], [40, 2.78], [60, 2.91], [80, 2.96], [100, 3.02], [120, 3.08], [140, 3.15],
  [160, 3.23], [180, 3.31], [200, 3.42], [220, 3.53], [240, 3.64], [260, 3.74],
  [280, 3.83], [300, 3.9], [320, 3.95], [340, 4.02], [360, 4.11], [380, 4.21],
  [400, 4.3], [420, 4.34], [440, 4.39], [460, 4.48], [480, 4.59], [500, 4.72],
  [520, 4.85], [540, 4.97], [560, 5.05], [580, 5.1], [600, 5.13],
];

/**
 * PGA Tour baseline from a bunker, yards to the hole (Broadie, Every Shot Counts —
 * the bunker column of the same tour baseline as the fairway and rough tables).
 * Figures are the sand table from PR #195, unchanged. Starts at 20 yd; closer
 * reads as 20. The table ends at 400 yd; farther clamps to the last row.
 */
const SAND_TABLE: Table = [
  [20, 2.53], [40, 2.82], [60, 3.15], [80, 3.24], [100, 3.23], [120, 3.21], [140, 3.22],
  [160, 3.28], [180, 3.4], [200, 3.55], [220, 3.7], [240, 3.84], [260, 3.93], [280, 4.0],
  [300, 4.04], [320, 4.12], [340, 4.26], [360, 4.41], [380, 4.55], [400, 4.69],
];

/** PGA Tour baseline on the green, feet to the hole. */
const GREEN_TABLE: Table = [
  [1, 1.0], [2, 1.01], [3, 1.04], [4, 1.13], [5, 1.23], [6, 1.34], [7, 1.42], [8, 1.5],
  [9, 1.56], [10, 1.61], [15, 1.78], [20, 1.87], [30, 1.98], [40, 2.06], [50, 2.14],
  [60, 2.21], [90, 2.4],
];

/** Feet range each putt-length bucket averages over. "20+" is read as 20–40 ft. */
const PUTT_BUCKET_FEET: Record<PuttLengthId, readonly [number, number]> = {
  inside_3: [1, 3],
  '3_to_10': [3, 10],
  '10_to_20': [10, 20],
  over_20: [20, 40],
};

function lookup(table: Table, x: number): number {
  const first = table[0];
  const last = table[table.length - 1];
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < table.length; i += 1) {
    const [x1, y1] = table[i];
    if (x <= x1) {
      const [x0, y0] = table[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return last[1];
}

function validYards(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n) && n >= 0;
}

/** Expected strokes to hole out from the tee of a hole this long. */
export function expectedFromTee(holeYards: number): number | null {
  return validYards(holeYards) ? lookup(TEE_TABLE, holeYards) : null;
}

/** Lie unknown: mean of the fairway and rough baselines at this many yards. */
export function expectedOffGreen(yards: number): number | null {
  if (!validYards(yards)) return null;
  return (lookup(FAIRWAY_TABLE, yards) + lookup(ROUGH_TABLE, yards)) / 2;
}

/** Expected strokes from this many yards on a known lie; unknown lie → fairway/rough mean. */
export function expectedFromLie(lie: ShotLie | null | undefined, yards: number): number | null {
  if (!validYards(yards)) return null;
  switch (lie) {
    case 'tee':
      return lookup(TEE_TABLE, yards);
    case 'fairway':
      return lookup(FAIRWAY_TABLE, yards);
    case 'rough':
      return lookup(ROUGH_TABLE, yards);
    case 'sand':
      return lookup(SAND_TABLE, yards);
    default:
      return expectedOffGreen(yards);
  }
}

/** Expected putts from this many feet. */
export function expectedPuttsFromFeet(feet: number): number | null {
  return validYards(feet) ? lookup(GREEN_TABLE, feet) : null;
}

/** Expected putts for a first putt in this length bucket: the baseline averaged over its feet. */
export function expectedPuttsForBucket(id: string | null | undefined): number | null {
  if (!id || !isPuttLengthId(id)) return null;
  const [lo, hi] = PUTT_BUCKET_FEET[id];
  let sum = 0;
  let n = 0;
  for (let ft = lo; ft <= hi; ft += 1) {
    sum += lookup(GREEN_TABLE, ft);
    n += 1;
  }
  return sum / n;
}

export type SgCategory = 'offTee' | 'approach' | 'aroundGreen' | 'putting';

export const SG_CATEGORIES: readonly SgCategory[] = ['offTee', 'approach', 'aroundGreen', 'putting'];

export type SgShotIn = {
  id: string;
  seq: number;
  startLat: number | null;
  startLng: number | null;
  holeOut: boolean;
  /** Lie at the start. Ignored on the tee shot. Null / missing → unknown. */
  lie?: ShotLie | null;
};

export type SgPenaltyIn = {
  strokes: number;
  /** Seq of the shot this penalty follows. Null → not placed on a stroke. */
  afterShotSeq: number | null;
};

export type SgHoleIn = {
  number: number;
  par: number | null;
  /** Posted score. Null falls back to logged strokes. */
  score: number | null;
  /** Scorecard length of the played tee. */
  yards: number | null;
  greenLat: number | null;
  greenLng: number | null;
  putts: number;
  puttLengths: readonly string[];
  /** Made it / Hole Out ran. An open hole has no SG. */
  puttsDone: boolean;
  shots: readonly SgShotIn[];
  penalties: readonly SgPenaltyIn[];
};

export type SgShot = {
  shotId: string;
  category: SgCategory | null;
  /** Null when the start or end could not be read. */
  sg: number | null;
};

export type SgTotals = Record<SgCategory, number> & {
  total: number;
  /** Part of `total` no stroke could carry (missing GPS / green / putt length, or an edited score). */
  unsplit: number;
};

export type SgHole = SgTotals & {
  number: number;
  shots: SgShot[];
  /** Putting SG for the hole, or null when putted with no first-putt length. */
  puttingSg: number | null;
};

function emptyTotals(): SgTotals {
  return { offTee: 0, approach: 0, aroundGreen: 0, putting: 0, total: 0, unsplit: 0 };
}

function greenPin(hole: SgHoleIn): LatLng | null {
  const pin = { lat: hole.greenLat as number, lng: hole.greenLng as number };
  return hole.greenLat != null && hole.greenLng != null && isValidLatLng(pin) ? pin : null;
}

function shotStart(shot: SgShotIn): LatLng | null {
  const start = { lat: shot.startLat as number, lng: shot.startLng as number };
  return shot.startLat != null && shot.startLng != null && isValidLatLng(start) ? start : null;
}

function teeYards(hole: SgHoleIn, first: SgShotIn | undefined, pin: LatLng | null): number | null {
  if (hole.yards != null && Number.isFinite(hole.yards) && hole.yards >= MIN_HOLE_YARDS && hole.yards <= MAX_HOLE_YARDS) {
    return hole.yards;
  }
  const start = first ? shotStart(first) : null;
  if (!start || !pin) return null;
  const yards = haversineYards(start, pin);
  return yards >= MIN_HOLE_YARDS && yards <= MAX_HOLE_YARDS ? yards : null;
}

/** Strokes gained for one finished hole. Null when the hole is open or its tee length is unknown. */
export function holeStrokesGained(hole: SgHoleIn): SgHole | null {
  if (!hole.puttsDone) return null;
  const shots = [...hole.shots].sort((a, b) => a.seq - b.seq);
  const penaltyStrokes = hole.penalties.reduce((sum, p) => sum + Math.max(0, p.strokes), 0);
  const score = finishedHoleDisplayScore({
    score: hole.score,
    shotCount: shots.length,
    putts: hole.putts,
    penaltyStrokes,
  });
  if (score == null) return null;

  const pin = greenPin(hole);
  const tee = teeYards(hole, shots[0], pin);
  if (tee == null) return null;
  const teeExpected = expectedFromTee(tee) as number;

  const putts = Math.max(0, hole.putts);
  const firstPuttExpected = putts > 0 ? expectedPuttsForBucket(hole.puttLengths[0]) : null;
  const lastShot = shots[shots.length - 1];

  // Expected strokes where each shot was played from. Index 0 is the tee.
  const startYards = shots.map((shot, i) => {
    if (i === 0) return tee;
    const start = shotStart(shot);
    return start && pin ? haversineYards(start, pin) : null;
  });
  const startExpected = startYards.map((yards, i) =>
    i === 0 ? teeExpected : yards == null ? null : expectedFromLie(shots[i].lie, yards),
  );
  const penaltiesAfter = (seq: number) =>
    hole.penalties
      .filter((p) => p.afterShotSeq === seq)
      .reduce((sum, p) => sum + Math.max(0, p.strokes), 0);

  const result: SgHole = { ...emptyTotals(), number: hole.number, shots: [], puttingSg: null };
  result.total = teeExpected - score;

  shots.forEach((shot, i) => {
    const yards = startYards[i];
    let category: SgCategory | null;
    if (i === 0) {
      const drive = hole.par != null ? hole.par >= 4 : tee >= NO_PAR_DRIVE_YARDS;
      category = drive ? 'offTee' : 'approach';
    } else if (yards == null) {
      category = null;
    } else {
      category = yards > ARG_MAX_YARDS ? 'approach' : 'aroundGreen';
    }

    const start = startExpected[i];
    let end: number | null;
    if (i < shots.length - 1) end = startExpected[i + 1];
    else if (shot.holeOut && putts === 0) end = 0;
    else if (putts > 0) end = firstPuttExpected;
    else end = null;

    const sg = category != null && start != null && end != null ? start - end - 1 - penaltiesAfter(shot.seq) : null;
    result.shots.push({ shotId: shot.id, category, sg });
    if (sg != null && category != null) result[category] += sg;
  });

  if (putts > 0 && firstPuttExpected != null) {
    result.puttingSg = firstPuttExpected - putts;
    result.putting = result.puttingSg;
  }

  const split = result.offTee + result.approach + result.aroundGreen + result.putting;
  result.unsplit = result.total - split;
  if (Math.abs(result.unsplit) < 1e-9) result.unsplit = 0;
  return result;
}

export type SgRound = SgTotals & {
  holes: SgHole[];
  /** Finished holes with a known tee length. */
  holesCounted: number;
  /** Shots with an SG value / all shots on counted holes. */
  shotsSplit: number;
  shotsTotal: number;
};

/** Strokes gained for a round: the sum of its finished holes. Null when no hole counts. */
export function roundStrokesGained(holes: readonly SgHoleIn[]): SgRound | null {
  const rows = holes
    .map(holeStrokesGained)
    .filter((row): row is SgHole => row != null)
    .sort((a, b) => a.number - b.number);
  if (rows.length === 0) return null;
  const totals = emptyTotals();
  let shotsSplit = 0;
  let shotsTotal = 0;
  for (const row of rows) {
    for (const key of [...SG_CATEGORIES, 'total', 'unsplit'] as const) totals[key] += row[key];
    shotsTotal += row.shots.length;
    shotsSplit += row.shots.filter((s) => s.sg != null).length;
  }
  return { ...totals, holes: rows, holesCounted: rows.length, shotsSplit, shotsTotal };
}

/**
 * Average per round across several rounds, scaled to 18 holes.
 * Only rounds with at least `SG_TRENDS_MIN_HOLES` counted holes are included.
 * `rounds` is how many qualified. Null when none do.
 */
export function averageStrokesGainedPer18(rounds: readonly (SgRound | null)[]): (SgTotals & { rounds: number }) | null {
  const counted = rounds.filter((r): r is SgRound => r != null && r.holesCounted >= SG_TRENDS_MIN_HOLES);
  if (counted.length === 0) return null;
  const totals = emptyTotals();
  for (const round of counted) {
    const scale = 18 / round.holesCounted;
    for (const key of [...SG_CATEGORIES, 'total', 'unsplit'] as const) totals[key] += round[key] * scale;
  }
  for (const key of [...SG_CATEGORIES, 'total', 'unsplit'] as const) totals[key] /= counted.length;
  return { ...totals, rounds: counted.length };
}

/** "+1.2" / "−0.4" / "0.0". Always one decimal, with a real minus sign. */
export function formatStrokesGained(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return '0.0';
  return rounded > 0 ? `+${rounded.toFixed(1)}` : `−${Math.abs(rounded).toFixed(1)}`;
}

/** "SG +0.3" for a shot or putting row; null when that stroke has no SG. */
export function strokesGainedChip(value: number | null): string | null {
  return value == null || !Number.isFinite(value) ? null : `SG ${formatStrokesGained(value)}`;
}

export const SG_CATEGORY_LABELS: Record<SgCategory, string> = {
  offTee: 'Off the tee',
  approach: 'Approach',
  aroundGreen: 'Around the green',
  putting: 'Putting',
};

/** The category that lost the most strokes, when one lost any. */
export function weakestCategory(totals: SgTotals): SgCategory | null {
  let worst: SgCategory | null = null;
  for (const key of SG_CATEGORIES) {
    if (totals[key] < 0 && (worst == null || totals[key] < totals[worst])) worst = key;
  }
  return worst;
}
