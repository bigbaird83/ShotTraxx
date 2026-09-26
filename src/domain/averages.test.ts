import assert from 'node:assert/strict';
import { test } from 'node:test';
import { includeInDistanceAverages } from './shotSource';
import { PUTTER_CLUB_ID } from './defaultBag';
import {
  averageWithBadges,
  bagClubYardageLabel,
  clubAverageFromShots,
  DISABLED_CLUB_YARDAGE,
  enabledClubAverageRows,
  shotMovesClubAverage,
  shotsForClubAverage,
} from './averages';
import { MIN_CLOSED_SHOTS_FOR_RANK, rankDistanceYards } from './rankClubs';

test('empty set has zero average and no badges', () => {
  const a = averageWithBadges([]);
  assert.equal(a.count, 0);
  assert.equal(a.includesSoft, false);
  assert.equal(a.includesForced, false);
});

test('good, soft, and forced shots all stay in the average', () => {
  const a = averageWithBadges([
    { yards: 150, fixQuality: 'good' },
    { yards: 170, fixQuality: 'soft' },
    { yards: 160, fixQuality: 'forced' },
  ]);
  assert.equal(a.count, 3);
  assert.equal(a.avgYards, 160);
  assert.equal(a.includesSoft, true);
  assert.equal(a.includesForced, true);
});

test('placed samples count with no GPS quality badges', () => {
  const a = averageWithBadges([
    { yards: 150, fixQuality: 'good' },
    { yards: 170, fixQuality: null },
  ]);
  assert.equal(a.count, 2);
  assert.equal(a.avgYards, 160);
  assert.equal(a.includesSoft, false);
  assert.equal(a.includesForced, false);
});

test('soft-only set still averages and badges soft, not forced', () => {
  const a = averageWithBadges([
    { yards: 100, fixQuality: 'soft' },
    { yards: 120, fixQuality: 'soft' },
  ]);
  assert.equal(a.avgYards, 110);
  assert.equal(a.includesSoft, true);
  assert.equal(a.includesForced, false);
});

test('a shot 20% off is stored on the hole and excluded from the average', () => {
  const holeShot = {
    source: 'gps' as const,
    distanceYards: 180,
    fixQuality: 'good' as const,
    clubId: 'club_7i',
  };
  assert.equal(includeInDistanceAverages(holeShot), true);
  assert.equal(shotMovesClubAverage({ yards: 180, baselineYards: 150 }), false);
  const kept = shotsForClubAverage([{ yards: 180, fixQuality: 'good' }], {
    typedCarryYards: 150,
    estimatedCarryYards: null,
  });
  assert.deepEqual(kept, []);
  assert.equal(averageWithBadges(kept).count, 0);
  assert.equal(shotMovesClubAverage({ yards: 179, baselineYards: 150 }), true);
});

test('a shot with no baseline still starts the average', () => {
  const kept = shotsForClubAverage([{ yards: 190, fixQuality: 'good' }], {
    typedCarryYards: null,
    estimatedCarryYards: null,
  });
  assert.equal(kept.length, 1);
  assert.equal(averageWithBadges(kept).avgYards, 190);
});

test('putter stays out of averages', () => {
  assert.equal(
    includeInDistanceAverages({
      source: 'gps',
      distanceYards: 12,
      fixQuality: 'good',
      clubId: PUTTER_CLUB_ID,
    }),
    false,
  );
});

test('an outlier does not advance the five-shot seed replacement', () => {
  const inBand = { yards: 150, fixQuality: 'good' as const };
  const outlier = { yards: 200, fixQuality: 'good' as const };
  const avg = clubAverageFromShots([inBand, inBand, inBand, inBand, outlier], {
    typedCarryYards: 150,
    estimatedCarryYards: null,
  });
  assert.equal(avg.count, 4);
  assert.ok(avg.count < MIN_CLOSED_SHOTS_FOR_RANK);
  assert.equal(
    rankDistanceYards({
      id: 'club_7i',
      name: '7 Iron',
      shortName: '7i',
      loftRank: 9,
      avgYards: avg.avgYards,
      count: avg.count,
      typicalCarryYards: 150,
    }),
    150,
  );

  const inBandLive = { yards: 160, fixQuality: 'good' as const };
  const five = clubAverageFromShots(
    [inBandLive, inBandLive, inBandLive, inBandLive, inBandLive],
    { typedCarryYards: 150, estimatedCarryYards: null },
  );
  assert.equal(five.count, 5);
  assert.equal(
    rankDistanceYards({
      id: 'club_7i',
      name: '7 Iron',
      shortName: '7i',
      loftRank: 9,
      avgYards: five.avgYards,
      count: five.count,
      typicalCarryYards: 150,
    }),
    160,
  );
});

test('a Placed outlier is excluded the same way as live and soft', () => {
  const placed = {
    source: 'placed' as const,
    distanceYards: 180,
    fixQuality: null,
    clubId: 'club_7i',
  };
  assert.equal(includeInDistanceAverages(placed), true);
  const placedKept = shotsForClubAverage([{ yards: 180, fixQuality: null }], {
    typedCarryYards: 150,
    estimatedCarryYards: null,
  });
  const softKept = shotsForClubAverage([{ yards: 180, fixQuality: 'soft' }], {
    typedCarryYards: 150,
    estimatedCarryYards: null,
  });
  const liveKept = shotsForClubAverage([{ yards: 180, fixQuality: 'good' }], {
    typedCarryYards: 150,
    estimatedCarryYards: null,
  });
  assert.deepEqual(placedKept, []);
  assert.deepEqual(softKept, []);
  assert.deepEqual(liveKept, []);
  assert.equal(clubAverageFromShots([{ yards: 180, fixQuality: null }], {
    typedCarryYards: 150,
    estimatedCarryYards: null,
  }).count, 0);
});

test('disabled clubs are left off the averages list', () => {
  const fiveIronShots = [{ id: 'shot-5i', clubId: 'club_5i', yards: 168 }];
  const sevenIronShots = [{ id: 'shot-7i', clubId: 'club_7i', yards: 151 }];
  const rows = [
    { club: { id: 'club_5i', enabled: false }, avgYards: 168, shots: fiveIronShots },
    { club: { id: 'club_7i', enabled: true }, avgYards: 151, shots: sevenIronShots },
    { club: { id: 'club_8i', enabled: true }, avgYards: null, shots: [] as { id: string; clubId: string; yards: number }[] },
  ];
  const visible = enabledClubAverageRows(rows);
  assert.deepEqual(
    visible.map((row) => row.club.id),
    ['club_7i', 'club_8i'],
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[0].shots, fiveIronShots);
  assert.equal(rows[0].shots[0].clubId, 'club_5i');
  assert.equal(rows[0].shots[0].yards, 168);
  assert.equal(rows[1].shots, sevenIronShots);
});

test('a re-enabled club is included again with the same average', () => {
  const shots = [{ id: 'shot-5i', clubId: 'club_5i', yards: 168 }];
  const before = shots.map((shot) => ({ ...shot }));
  const hidden = enabledClubAverageRows([
    { club: { id: 'club_5i', enabled: false }, avgYards: 168, shots },
  ]);
  assert.equal(hidden.length, 0);
  const shown = enabledClubAverageRows([
    { club: { id: 'club_5i', enabled: true }, avgYards: 168, shots },
  ]);
  assert.equal(shown.length, 1);
  assert.equal(shown[0]?.club.id, 'club_5i');
  assert.equal(shown[0]?.avgYards, 168);
  assert.equal(shown[0]?.shots, shots);
  assert.deepEqual(shots, before);
});

test('a disabled bag club shows a dash, not a typical carry', () => {
  assert.equal(bagClubYardageLabel({ enabled: false, yards: 230 }), DISABLED_CLUB_YARDAGE);
  assert.equal(bagClubYardageLabel({ enabled: false, yards: null }), DISABLED_CLUB_YARDAGE);
  assert.equal(DISABLED_CLUB_YARDAGE, '—');
  assert.equal(bagClubYardageLabel({ enabled: true, yards: 168 }), 168);
  assert.equal(bagClubYardageLabel({ enabled: true, yards: null }), null);
});

test('inside 20% still updates; live average beats the seed', () => {
  const kept = shotsForClubAverage(
    [
      { yards: 150, fixQuality: 'good' },
      { yards: 160, fixQuality: 'good' },
      { yards: 200, fixQuality: 'soft' },
    ],
    { typedCarryYards: 150, estimatedCarryYards: 140 },
  );
  assert.deepEqual(
    kept.map((shot) => shot.yards),
    [150, 160],
  );
  assert.equal(averageWithBadges(kept).avgYards, 155);
  const fromEstimated = shotsForClubAverage([{ yards: 200, fixQuality: 'good' }], {
    typedCarryYards: null,
    estimatedCarryYards: 160,
  });
  assert.deepEqual(fromEstimated, []);
});
