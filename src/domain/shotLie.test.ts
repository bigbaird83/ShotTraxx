import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { OsmFeature } from '../course/types';
import {
  collectRoundHistoryExport,
  fillAutoShotLies,
  getHole,
  listShotsForHole,
  listStrokesGainedHoles,
  listStrokesGainedHolesBatched,
  restoreRoundHistory,
  setShotLie,
  startRound,
} from '../db/repo';
import { migrate } from '../db/schema';
import { acceptTransferShot, serializeRoundHistory } from './roundTransfer';
import { classifyShotLie, parseShotLie, planAutoShotLies } from './shotLie';

const ORIGIN = { lat: 35.0, lng: -92.0 };
const YARDS_PER_DEG_LAT = (6_371_000 * Math.PI) / 180 / 0.9144;
const YARDS_PER_DEG_LNG = YARDS_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

/** Point at (x east, y north) yards from ORIGIN. */
function at(x: number, y: number) {
  return { lat: ORIGIN.lat + y / YARDS_PER_DEG_LAT, lng: ORIGIN.lng + x / YARDS_PER_DEG_LNG };
}

function box(kind: OsmFeature['kind'], x0: number, y0: number, x1: number, y1: number): OsmFeature {
  return { kind, holeNumber: 1, coordinates: [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)] };
}

// Fairway 40 yd wide from y=0 to 300, green at the top, a bunker inside the fairway, a tee below.
const HOLE: OsmFeature[] = [
  box('tee', -10, -30, 10, -10),
  box('fairway', -20, 0, 20, 300),
  box('bunker', 5, 150, 15, 160),
  box('green', -15, 320, 15, 350),
  { kind: 'cartpath', holeNumber: 1, coordinates: [at(40, 0), at(40, 300)] },
];

test('auto lie reads mapped outlines', () => {
  assert.equal(classifyShotLie(at(0, 100), HOLE), 'fairway');
  assert.equal(classifyShotLie(at(10, 155), HOLE), 'sand');
  assert.equal(classifyShotLie(at(0, 335), HOLE), 'fairway');
  assert.equal(classifyShotLie(at(0, -20), HOLE), 'tee');
  assert.equal(classifyShotLie(at(35, 100), HOLE), 'rough');
});

test('unmapped, far from any fairway, or no start stays unknown', () => {
  assert.equal(classifyShotLie(at(200, 100), HOLE), null);
  assert.equal(classifyShotLie(null, HOLE), null);
  assert.equal(classifyShotLie(at(0, 100), []), null);
  assert.equal(classifyShotLie(at(0, 100), null), null);
});

test('greenside rough only counts near a green', () => {
  const greenOnly = [box('green', -15, 320, 15, 350)];
  assert.equal(classifyShotLie(at(0, 300), greenOnly), 'rough');
  assert.equal(classifyShotLie(at(0, 250), greenOnly), null);
});

test('auto plan skips player taps and only writes changes', () => {
  const start = at(0, 100);
  const shots = [
    { id: 'a', startLat: start.lat, startLng: start.lng, lie: null, lieSource: null },
    { id: 'b', startLat: start.lat, startLng: start.lng, lie: 'rough' as const, lieSource: 'player' as const },
    { id: 'c', startLat: start.lat, startLng: start.lng, lie: 'fairway' as const, lieSource: 'auto' as const },
    { id: 'd', startLat: at(200, 100).lat, startLng: at(200, 100).lng, lie: 'rough' as const, lieSource: 'auto' as const },
    { id: 'e', startLat: null, startLng: null },
  ];
  assert.deepEqual(planAutoShotLies(shots, HOLE), [
    { id: 'a', lie: 'fairway' },
    { id: 'd', lie: null },
  ]);
  assert.deepEqual(planAutoShotLies(shots, null), []);
});

test('parse lie', () => {
  assert.equal(parseShotLie('sand'), 'sand');
  assert.equal(parseShotLie('green'), null);
  assert.equal(parseShotLie(null), null);
});

test('a player lie survives the round history file; older files add no key', () => {
  const base = {
    source: 'gps',
    seq: 2,
    start: at(0, 100),
    end: at(0, 250),
    startedAt: '2026-09-01T15:00:00.000Z',
  };
  assert.equal(acceptTransferShot({ ...base, playerLie: 'sand' })?.playerLie, 'sand');
  const legacy = acceptTransferShot(base);
  assert.ok(legacy);
  assert.equal('playerLie' in legacy, false);
  assert.equal(acceptTransferShot({ ...base, playerLie: 'lava' })?.playerLie, undefined);
});

const DatabaseSync = (() => {
  try {
    return (require('node:sqlite') as typeof import('node:sqlite')).DatabaseSync;
  } catch {
    return null;
  }
})();

function memoryDb(): SQLiteDatabase {
  if (!DatabaseSync) throw new Error('node:sqlite unavailable');
  const raw = new DatabaseSync(':memory:');
  const args = (params?: unknown[]) => (params ?? []) as (string | number | null)[];
  const db = {
    execSync: (sql: string) => raw.exec(sql),
    runSync: (sql: string, params?: unknown[]) => raw.prepare(sql).run(...args(params)),
    getAllSync: (sql: string, params?: unknown[]) => raw.prepare(sql).all(...args(params)),
    getFirstSync: (sql: string, params?: unknown[]) => raw.prepare(sql).get(...args(params)) ?? null,
    prepareSync: (sql: string) => {
      const statement = raw.prepare(sql);
      return { executeSync: (params?: unknown[]) => statement.run(...args(params)), finalizeSync: () => {} };
    },
    withTransactionSync: (run: () => void) => {
      raw.exec('BEGIN');
      try {
        run();
        raw.exec('COMMIT');
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },
  };
  const wrapped = db as unknown as SQLiteDatabase;
  migrate(wrapped);
  return wrapped;
}

function insertShot(db: SQLiteDatabase, id: string, holeId: string, seq: number, from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  db.runSync(
    `INSERT INTO shots (
      id, hole_id, club_id, seq, start_lat, start_lng, start_accuracy_m, start_fix_quality,
      end_lat, end_lng, end_accuracy_m, end_fix_quality, distance_yards, fix_quality,
      impossible_jump, started_at, ended_at, source
    ) VALUES (?, ?, 'club_7i', ?, ?, ?, 5, 'good', ?, ?, 5, 'good', 150, 'good', 0, ?, ?, 'gps')`,
    [id, holeId, seq, from.lat, from.lng, to.lat, to.lng, '2026-06-01T18:00:00.000Z', '2026-06-01T18:01:00.000Z'],
  );
}

test('auto lie fills, a tap overrides and survives auto and Export / Restore', {
  skip: DatabaseSync ? false : 'node:sqlite needs Node 22.5+',
}, () => {
  const db = memoryDb();
  const round = startRound(db, 18, 'Lie Test');
  const hole = getHole(db, round.id, 1);
  assert.ok(hole);
  if (!hole) return;
  insertShot(db, 's1', hole.id, 1, at(0, -20), at(0, 100));
  insertShot(db, 's2', hole.id, 2, at(0, 100), at(0, 250));

  assert.equal(fillAutoShotLies(db, [hole.id], HOLE), 2);
  assert.equal(fillAutoShotLies(db, [hole.id], HOLE), 0);
  const lieOf = (d: SQLiteDatabase, holeId: string, seq: number) => {
    const shot = listShotsForHole(d, holeId).find((row) => row.seq === seq);
    return [shot?.lie ?? null, shot?.lieSource ?? null];
  };
  assert.deepEqual(lieOf(db, hole.id, 2), ['fairway', 'auto']);

  setShotLie(db, 's2', 'sand');
  assert.equal(fillAutoShotLies(db, [hole.id], HOLE), 0);
  assert.deepEqual(lieOf(db, hole.id, 2), ['sand', 'player']);
  assert.equal(listStrokesGainedHoles(db, round.id)[0]?.shots.find((s) => s.seq === 2)?.lie, 'sand');
  assert.deepEqual(listStrokesGainedHolesBatched(db, round.id), listStrokesGainedHoles(db, round.id));

  const fresh = memoryDb();
  const restored = restoreRoundHistory(
    fresh,
    serializeRoundHistory(collectRoundHistoryExport(db, '2026-06-02T00:00:00.000Z')),
  );
  assert.equal(restored.ok, true);
  const freshHole = getHole(fresh, round.id, 1);
  assert.ok(freshHole);
  if (!freshHole) return;
  assert.deepEqual(lieOf(fresh, freshHole.id, 2), ['sand', 'player']);
  // Auto lies are not in the file; they re-read from the map.
  assert.deepEqual(lieOf(fresh, freshHole.id, 1), [null, null]);

  setShotLie(db, 's2', null);
  assert.deepEqual(lieOf(db, hole.id, 2), [null, null]);
  assert.equal(fillAutoShotLies(db, [hole.id], HOLE), 1);
  assert.deepEqual(lieOf(db, hole.id, 2), ['fairway', 'auto']);
});
