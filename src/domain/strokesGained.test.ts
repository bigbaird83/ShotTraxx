import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  averageStrokesGainedPer18,
  expectedFromLie,
  expectedFromTee,
  SG_TRENDS_MIN_HOLES,
  expectedOffGreen,
  expectedPuttsForBucket,
  formatStrokesGained,
  strokesGainedChip,
  holeStrokesGained,
  roundStrokesGained,
  weakestCategory,
  type SgHoleIn,
  type SgRound,
  type SgShotIn,
} from './strokesGained';

const GREEN = { lat: 35.0, lng: -92.0 };
const METERS_PER_DEG_LAT = (6_371_000 * Math.PI) / 180;

/** A point this many yards due south of the green. */
function south(yards: number): { startLat: number; startLng: number } {
  return { startLat: GREEN.lat - (yards * 0.9144) / METERS_PER_DEG_LAT, startLng: GREEN.lng };
}

function shot(seq: number, yards: number | null, extra: Partial<SgShotIn> = {}): SgShotIn {
  const start = yards == null ? { startLat: null, startLng: null } : south(yards);
  return { id: `s${seq}`, seq, holeOut: false, ...start, ...extra };
}

function hole(extra: Partial<SgHoleIn> = {}): SgHoleIn {
  return {
    number: 1,
    par: 4,
    score: null,
    yards: 400,
    greenLat: GREEN.lat,
    greenLng: GREEN.lng,
    putts: 2,
    puttLengths: ['10_to_20', 'inside_3'],
    puttsDone: true,
    shots: [shot(1, 400), shot(2, 150)],
    penalties: [],
    ...extra,
  };
}

const close = (a: number | null, b: number, eps = 0.011) => {
  assert.ok(a != null, 'expected a value');
  assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
};

test('baseline tables interpolate and clamp', () => {
  close(expectedFromTee(400), 3.99);
  close(expectedFromTee(410), 4.005);
  close(expectedFromTee(40), 2.92);
  close(expectedFromTee(900), 4.82);
  close(expectedOffGreen(150), (2.945 + 3.19) / 2);
  close(expectedOffGreen(5), (2.4 + 2.59) / 2);
  assert.equal(expectedFromTee(Number.NaN), null);
});

test('putt buckets average the green baseline over their feet', () => {
  close(expectedPuttsForBucket('inside_3'), (1.0 + 1.01 + 1.04) / 3);
  close(expectedPuttsForBucket('3_to_10'), 1.354);
  assert.ok((expectedPuttsForBucket('10_to_20') as number) > 1.7);
  assert.ok((expectedPuttsForBucket('over_20') as number) > 1.9);
  assert.equal(expectedPuttsForBucket(''), null);
  assert.equal(expectedPuttsForBucket('nope'), null);
});

test('par 4 in four: categories add up to the hole total', () => {
  const sg = holeStrokesGained(hole());
  assert.ok(sg);
  // Tee 400 yd → 3.99. Score 4 (2 shots + 2 putts).
  close(sg.total, 3.99 - 4);
  const approachStart = expectedOffGreen(150) as number;
  close(sg.offTee, 3.99 - approachStart - 1);
  const firstPutt = expectedPuttsForBucket('10_to_20') as number;
  close(sg.approach, approachStart - firstPutt - 1);
  close(sg.putting, firstPutt - 2);
  close(sg.aroundGreen, 0);
  close(sg.unsplit, 0);
  assert.deepEqual(
    sg.shots.map((s) => s.category),
    ['offTee', 'approach'],
  );
});

test('par 3 tee shot is an approach', () => {
  const sg = holeStrokesGained(hole({ par: 3, yards: 160, shots: [shot(1, 160)] }));
  assert.equal(sg?.shots[0].category, 'approach');
  close(sg?.offTee ?? null, 0);
});

test('a short shot is around the green', () => {
  const sg = holeStrokesGained(
    hole({ shots: [shot(1, 400), shot(2, 150), shot(3, 20)], puttLengths: ['3_to_10', 'inside_3'] }),
  );
  assert.equal(sg?.shots[2].category, 'aroundGreen');
  close(sg?.unsplit ?? null, 0);
});

test('chip-in with no putts ends at zero', () => {
  const sg = holeStrokesGained(
    hole({ shots: [shot(1, 400), shot(2, 150), shot(3, 15, { holeOut: true })], putts: 0, puttLengths: [] }),
  );
  assert.ok(sg);
  close(sg.shots[2].sg, (expectedOffGreen(15) as number) - 1);
  close(sg.putting, 0);
  close(sg.unsplit, 0);
});

test('penalty strokes are charged to the shot they follow', () => {
  const sg = holeStrokesGained(
    hole({
      shots: [shot(1, 400), shot(2, 180)],
      penalties: [{ strokes: 1, afterShotSeq: 1 }],
    }),
  );
  assert.ok(sg);
  close(sg.total, 3.99 - 5);
  close(sg.offTee, 3.99 - (expectedOffGreen(180) as number) - 2);
  close(sg.unsplit, 0);
});

test('missing GPS, green, or putt length leaves the gap unsplit, never invented', () => {
  const noGps = holeStrokesGained(hole({ shots: [shot(1, 400), shot(2, null)] }));
  assert.ok(noGps);
  assert.equal(noGps.shots[0].sg, null);
  assert.equal(noGps.shots[1].sg, null);
  close(noGps.total, 3.99 - 4);
  close(noGps.unsplit, noGps.total - noGps.putting);

  const noLength = holeStrokesGained(hole({ puttLengths: [] }));
  assert.equal(noLength?.puttingSg, null);
  assert.equal(noLength?.shots[1].sg, null);

  const noGreen = holeStrokesGained(hole({ greenLat: null, greenLng: null }));
  assert.equal(noGreen?.shots[1].sg, null);
  close(noGreen?.total ?? null, 3.99 - 4);
});

test('open hole, or no tee length, has no SG', () => {
  assert.equal(holeStrokesGained(hole({ puttsDone: false })), null);
  assert.equal(holeStrokesGained(hole({ yards: null, shots: [shot(1, null)] })), null);
});

test('tee length falls back to the first shot start when the card has none', () => {
  const sg = holeStrokesGained(hole({ yards: null }));
  close(sg?.total ?? null, 3.99 - 4, 0.02);
});

test('a posted score that disagrees with the log lands in unsplit', () => {
  const sg = holeStrokesGained(hole({ score: 5 }));
  close(sg?.total ?? null, 3.99 - 5);
  close(sg?.unsplit ?? null, -1);
});

test('round totals sum finished holes', () => {
  const round = roundStrokesGained([hole(), hole({ number: 2, puttsDone: false })]);
  assert.ok(round);
  assert.equal(round.holesCounted, 1);
  assert.equal(round.shotsTotal, 2);
  assert.equal(round.shotsSplit, 2);
  close(round.total, 3.99 - 4);
  assert.equal(roundStrokesGained([hole({ puttsDone: false })]), null);
  assert.equal(averageStrokesGainedPer18([round, null]), null);
});

function trendRound(holesCounted: number, total: number, offTee = 0): SgRound {
  return {
    offTee,
    approach: 0,
    aroundGreen: 0,
    putting: 0,
    total,
    unsplit: 0,
    holes: [],
    holesCounted,
    shotsSplit: 0,
    shotsTotal: 0,
  };
}

test('trends average skips rounds under 9 holes', () => {
  assert.equal(SG_TRENDS_MIN_HOLES, 9);
  const fullA = trendRound(18, -2, 1);
  const fullB = trendRound(18, -4, 3);
  const short = trendRound(2, -20, 50);
  const withShort = averageStrokesGainedPer18([fullA, short, fullB]);
  const without = averageStrokesGainedPer18([fullA, fullB]);
  assert.equal(withShort?.rounds, 2);
  assert.deepEqual(withShort, without);
  close(withShort?.total ?? null, -3);
  close(withShort?.offTee ?? null, 2);
});

test('a 9-hole round is counted and scaled by 2', () => {
  const nine = trendRound(9, -1.5, 0.4);
  const avg = averageStrokesGainedPer18([nine, trendRound(8, 100, 100), null]);
  assert.equal(avg?.rounds, 1);
  close(avg?.total ?? null, -3);
  close(avg?.offTee ?? null, 0.8);
});

test('a window of only short rounds has no strokes-gained average', () => {
  assert.equal(averageStrokesGainedPer18([trendRound(2, -1), trendRound(8, -4), null]), null);
});

test('a 2-hole round stays out of the trends average', () => {
  assert.equal(SG_TRENDS_MIN_HOLES, 9);
  assert.equal(averageStrokesGainedPer18([trendRound(2, -20, 50)]), null);
});

test('a known lie uses its own baseline; unknown averages fairway and rough', () => {
  close(expectedFromLie('fairway', 150), 2.945);
  close(expectedFromLie('rough', 150), 3.19);
  close(expectedFromLie('sand', 100), 3.23);
  close(expectedFromLie('tee', 400), 3.99);
  close(expectedFromLie(null, 150), (2.945 + 3.19) / 2);

  const fromSand = holeStrokesGained(hole({ shots: [shot(1, 400), shot(2, 100, { lie: 'sand' })] }));
  const fromFairway = holeStrokesGained(hole({ shots: [shot(1, 400), shot(2, 100, { lie: 'fairway' })] }));
  assert.ok(fromSand && fromFairway);
  // Same result from a harder lie: the drive loses more, the approach gains more.
  assert.ok(fromSand.offTee < fromFairway.offTee);
  assert.ok(fromSand.approach > fromFairway.approach);
  close(fromSand.total, fromFairway.total);
});

test('the tee shot ignores any lie', () => {
  const sg = holeStrokesGained(hole({ shots: [shot(1, 400, { lie: 'sand' }), shot(2, 150)] }));
  close(sg?.total ?? null, 3.99 - 4);
  close(sg?.offTee ?? null, 3.99 - (expectedOffGreen(150) as number) - 1);
});

test('a shot with no lie matches the fairway/rough mean strokes gained uses today', () => {
  const omitted = holeStrokesGained(hole());
  const explicitNull = holeStrokesGained(hole({ shots: [shot(1, 400), shot(2, 150, { lie: null })] }));
  assert.ok(omitted && explicitNull);
  assert.deepEqual(explicitNull, omitted);
  const approachStart = expectedOffGreen(150) as number;
  close(expectedFromLie(undefined, 150), approachStart);
  close(expectedFromLie(null, 150), approachStart);
  const firstPutt = expectedPuttsForBucket('10_to_20') as number;
  close(omitted.offTee, 3.99 - approachStart - 1);
  close(omitted.approach, approachStart - firstPutt - 1);
  close(omitted.unsplit, 0);
});

test('format and weakest category', () => {
  assert.equal(strokesGainedChip(0.34), 'SG +0.3');
  assert.equal(strokesGainedChip(-1.26), 'SG −1.3');
  assert.equal(strokesGainedChip(null), null);
  assert.equal(formatStrokesGained(1.24), '+1.2');
  assert.equal(formatStrokesGained(-0.46), '−0.5');
  assert.equal(formatStrokesGained(0.02), '0.0');
  assert.equal(formatStrokesGained(null), '—');
  assert.equal(
    weakestCategory({ offTee: -1, approach: -2.5, aroundGreen: 0.3, putting: -0.4, total: -3.6, unsplit: 0 }),
    'approach',
  );
  assert.equal(
    weakestCategory({ offTee: 1, approach: 0, aroundGreen: 0, putting: 0, total: 1, unsplit: 0 }),
    null,
  );
});
