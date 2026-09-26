import type { SQLiteDatabase } from 'expo-sqlite';
import { DEFAULT_BAG, isLegacyStockCarry, LEGACY_STOCK_CARRY_YARDS } from '../domain/defaultBag';

function ensureColumn(db: SQLiteDatabase, table: string, column: string, ddl: string): boolean {
  const cols = db.getAllSync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (cols.some((c) => c.name === column)) return false;
  db.execSync(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  return true;
}

/**
 * P1 shots required start lat/lng. P3 allows null coords for `no_gps` (forgotten
 * swing). SQLite cannot drop NOT NULL, so rebuild the table when needed.
 */
function migrateShotsP3(db: SQLiteDatabase): void {
  const cols = db.getAllSync<{ name: string; notnull: number }>(`PRAGMA table_info(shots)`);
  if (cols.length === 0) return;
  const hasSource = cols.some((c) => c.name === 'source');
  const startLat = cols.find((c) => c.name === 'start_lat');
  if (hasSource && startLat?.notnull !== 1) return;

  db.execSync('PRAGMA foreign_keys = OFF;');
  db.execSync(`
    CREATE TABLE shots_p3 (
      id TEXT PRIMARY KEY NOT NULL,
      hole_id TEXT NOT NULL,
      club_id TEXT,
      seq INTEGER NOT NULL,
      start_lat REAL,
      start_lng REAL,
      start_accuracy_m REAL,
      start_fix_quality TEXT,
      end_lat REAL,
      end_lng REAL,
      end_accuracy_m REAL,
      end_fix_quality TEXT,
      distance_yards INTEGER,
      fix_quality TEXT,
      impossible_jump INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      source TEXT NOT NULL DEFAULT 'gps',
      typed_yards INTEGER,
      FOREIGN KEY (hole_id) REFERENCES holes(id) ON DELETE CASCADE,
      FOREIGN KEY (club_id) REFERENCES clubs(id)
    );
  `);
  const sourceExpr = hasSource ? 'source' : "'gps'";
  db.execSync(`
    INSERT INTO shots_p3 (
      id, hole_id, club_id, seq,
      start_lat, start_lng, start_accuracy_m, start_fix_quality,
      end_lat, end_lng, end_accuracy_m, end_fix_quality,
      distance_yards, fix_quality, impossible_jump, started_at, ended_at, source
    )
    SELECT
      id, hole_id, club_id, seq,
      start_lat, start_lng, start_accuracy_m, start_fix_quality,
      end_lat, end_lng, end_accuracy_m, end_fix_quality,
      distance_yards, fix_quality, impossible_jump, started_at, ended_at,
      ${sourceExpr}
    FROM shots;
  `);
  db.execSync('DROP TABLE shots;');
  db.execSync('ALTER TABLE shots_p3 RENAME TO shots;');
  db.execSync('PRAGMA foreign_keys = ON;');
}

/** P3 sensing lock: no_gps rows are fixQuality none; typed yards are not GPS distance. */
function migrateNoGpsSensingLock(db: SQLiteDatabase): void {
  db.execSync(`
    UPDATE shots
    SET
      typed_yards = COALESCE(typed_yards, CASE WHEN IFNULL(source, 'gps') = 'no_gps' THEN distance_yards END),
      distance_yards = CASE WHEN IFNULL(source, 'gps') = 'no_gps' THEN NULL ELSE distance_yards END,
      fix_quality = CASE WHEN IFNULL(source, 'gps') = 'no_gps' THEN 'none' ELSE fix_quality END,
      start_fix_quality = CASE WHEN IFNULL(source, 'gps') = 'no_gps' THEN 'none' ELSE start_fix_quality END,
      end_fix_quality = CASE WHEN IFNULL(source, 'gps') = 'no_gps' THEN 'none' ELSE end_fix_quality END
    WHERE IFNULL(source, 'gps') = 'no_gps';
  `);
}

/** P5.2: par is course-data only. Existing NOT NULL par stays; new holes may be NULL. */
function migrateHolesParNullable(db: SQLiteDatabase): void {
  const cols = db.getAllSync<{ name: string; notnull: number }>(`PRAGMA table_info(holes)`);
  if (cols.length === 0) return;
  const par = cols.find((c) => c.name === 'par');
  if (par?.notnull !== 1) return;

  db.execSync('PRAGMA foreign_keys = OFF;');
  db.execSync(`
    CREATE TABLE holes_p5 (
      id TEXT PRIMARY KEY NOT NULL,
      round_id TEXT NOT NULL,
      number INTEGER NOT NULL,
      par INTEGER,
      par_source TEXT,
      score INTEGER,
      yards INTEGER,
      handicap INTEGER,
      green_lat REAL,
      green_lng REAL,
      green_source TEXT,
      FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE
    );
  `);
  const hasParSource = cols.some((c) => c.name === 'par_source');
  const hasGreenSource = cols.some((c) => c.name === 'green_source');
  const hasYards = cols.some((c) => c.name === 'yards');
  const hasHandicap = cols.some((c) => c.name === 'handicap');
  const parSourceExpr = hasParSource ? 'par_source' : 'NULL';
  const greenSourceExpr = hasGreenSource ? 'green_source' : 'NULL';
  const yardsExpr = hasYards ? 'yards' : 'NULL';
  const handicapExpr = hasHandicap ? 'handicap' : 'NULL';
  db.execSync(`
    INSERT INTO holes_p5 (
      id, round_id, number, par, par_source, score, yards, handicap, green_lat, green_lng, green_source
    )
    SELECT
      id, round_id, number, par, ${parSourceExpr}, score, ${yardsExpr}, ${handicapExpr}, green_lat, green_lng, ${greenSourceExpr}
    FROM holes;
  `);
  db.execSync('DROP TABLE holes;');
  db.execSync('ALTER TABLE holes_p5 RENAME TO holes;');
  db.execSync('PRAGMA foreign_keys = ON;');
}

export function migrate(db: SQLiteDatabase): void {
  db.execSync('PRAGMA foreign_keys = ON;');
  db.execSync(`
    CREATE TABLE IF NOT EXISTS clubs (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      short_name TEXT NOT NULL,
      loft_rank INTEGER NOT NULL,
      sort_order INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      typical_carry_yards INTEGER
    );

    CREATE TABLE IF NOT EXISTS rounds (
      id TEXT PRIMARY KEY NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      course_name TEXT,
      hole_count INTEGER NOT NULL,
      course_api_id TEXT,
      course_lat REAL,
      course_lng REAL,
      tee_name TEXT,
      tee_rating REAL,
      tee_slope INTEGER,
      tee_total_yards INTEGER,
      last_club_id TEXT
    );

    CREATE TABLE IF NOT EXISTS holes (
      id TEXT PRIMARY KEY NOT NULL,
      round_id TEXT NOT NULL,
      number INTEGER NOT NULL,
      par INTEGER,
      par_source TEXT,
      score INTEGER,
      yards INTEGER,
      handicap INTEGER,
      green_lat REAL,
      green_lng REAL,
      green_source TEXT,
      FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shots (
      id TEXT PRIMARY KEY NOT NULL,
      hole_id TEXT NOT NULL,
      club_id TEXT,
      seq INTEGER NOT NULL,
      start_lat REAL,
      start_lng REAL,
      start_accuracy_m REAL,
      start_fix_quality TEXT,
      end_lat REAL,
      end_lng REAL,
      end_accuracy_m REAL,
      end_fix_quality TEXT,
      distance_yards INTEGER,
      fix_quality TEXT,
      impossible_jump INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      source TEXT NOT NULL DEFAULT 'gps',
      typed_yards INTEGER,
      FOREIGN KEY (hole_id) REFERENCES holes(id) ON DELETE CASCADE,
      FOREIGN KEY (club_id) REFERENCES clubs(id)
    );

    CREATE TABLE IF NOT EXISTS hole_penalties (
      id TEXT PRIMARY KEY NOT NULL,
      hole_id TEXT NOT NULL,
      strokes INTEGER NOT NULL,
      reason TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'penalty',
      lat REAL,
      lng REAL,
      FOREIGN KEY (hole_id) REFERENCES holes(id) ON DELETE CASCADE
    );

    -- Phone-local ids of penalties the golfer deleted. A delayed Watch
    -- penaltyPick with the same id must not insert again. Not exported.
    CREATE TABLE IF NOT EXISTS deleted_penalty_ids (
      id TEXT PRIMARY KEY NOT NULL,
      deleted_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS share_boards (
      token TEXT PRIMARY KEY NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  ensureColumn(db, 'holes', 'green_lat', 'REAL');
  ensureColumn(db, 'holes', 'green_lng', 'REAL');
  ensureColumn(db, 'holes', 'green_source', 'TEXT');
  ensureColumn(db, 'holes', 'par_source', 'TEXT');
  ensureColumn(db, 'holes', 'yards', 'INTEGER');
  ensureColumn(db, 'holes', 'handicap', 'INTEGER');
  ensureColumn(db, 'rounds', 'course_api_id', 'TEXT');
  ensureColumn(db, 'rounds', 'course_lat', 'REAL');
  ensureColumn(db, 'rounds', 'course_lng', 'REAL');
  ensureColumn(db, 'rounds', 'tee_name', 'TEXT');
  ensureColumn(db, 'rounds', 'tee_rating', 'REAL');
  ensureColumn(db, 'rounds', 'tee_slope', 'INTEGER');
  ensureColumn(db, 'rounds', 'tee_total_yards', 'INTEGER');
  ensureColumn(db, 'rounds', 'last_club_id', 'TEXT');
  ensureColumn(db, 'rounds', 'course_city', 'TEXT');
  ensureColumn(db, 'rounds', 'course_state', 'TEXT');
  ensureColumn(db, 'rounds', 'course_data_source', 'TEXT');
  ensureColumn(db, 'rounds', 'share_token', 'TEXT');
  ensureColumn(db, 'rounds', 'is_test', 'INTEGER NOT NULL DEFAULT 0');
  // Null until the golfer taps Share. Not copied from share_token — that code was minted without a tap.
  ensureColumn(db, 'rounds', 'shared_at', 'TEXT');
  ensureColumn(db, 'holes', 'green_front_lat', 'REAL');
  ensureColumn(db, 'holes', 'green_front_lng', 'REAL');
  ensureColumn(db, 'holes', 'green_back_lat', 'REAL');
  ensureColumn(db, 'holes', 'green_back_lng', 'REAL');
  ensureColumn(db, 'holes', 'green_depth_yards', 'INTEGER');
  ensureColumn(db, 'holes', 'tee_lat', 'REAL');
  ensureColumn(db, 'holes', 'tee_lng', 'REAL');
  ensureColumn(db, 'hole_penalties', 'kind', "TEXT NOT NULL DEFAULT 'penalty'");
  ensureColumn(db, 'hole_penalties', 'lat', 'REAL');
  ensureColumn(db, 'hole_penalties', 'lng', 'REAL');
  ensureColumn(db, 'hole_penalties', 'after_shot_id', 'TEXT');
  ensureColumn(db, 'hole_penalties', 'after_shot_seq', 'INTEGER');
  migrateHolesParNullable(db);
  migrateShotsP3(db);
  ensureColumn(db, 'shots', 'source', "TEXT NOT NULL DEFAULT 'gps'");
  ensureColumn(db, 'shots', 'typed_yards', 'INTEGER');
  ensureColumn(db, 'shots', 'suggested', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'shots', 'average_eligible_at', 'TEXT');
  ensureColumn(db, 'shots', 'hole_out', 'INTEGER NOT NULL DEFAULT 0');
  // Nullable lie for strokes gained. Existing rows stay null; nothing is rewritten.
  ensureColumn(db, 'shots', 'lie', 'TEXT');
  ensureColumn(db, 'shots', 'lie_source', 'TEXT');
  ensureColumn(db, 'holes', 'putts', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'holes', 'putt_lengths', 'TEXT');
  if (ensureColumn(db, 'holes', 'putts_done', 'INTEGER NOT NULL DEFAULT 0')) {
    // Existing stepper putts from the prior cut already count as entered.
    db.execSync('UPDATE holes SET putts_done = 1 WHERE IFNULL(putts, 0) > 0');
  }
  ensureColumn(db, 'holes', 'started_at', 'TEXT');
  ensureColumn(db, 'holes', 'fairway', 'TEXT');
  ensureColumn(db, 'holes', 'completed_at', 'TEXT');
  migrateNoGpsSensingLock(db);

  ensureColumn(db, 'clubs', 'typical_carry_yards', 'INTEGER');
  ensureStockBag(db);
  clearLegacyStockCarry(db);
}

/** First-run seed plus insert any stock clubs missing from an older bag (2i / 3i / 4i / 48° / 50° / 52° / 56° / 60°). */
function ensureStockBag(db: SQLiteDatabase): void {
  const existing = new Set(
    db.getAllSync<{ id: string }>('SELECT id FROM clubs').map((row) => row.id),
  );
  const insert = db.prepareSync(
    'INSERT INTO clubs (id, name, short_name, loft_rank, sort_order, enabled, typical_carry_yards) VALUES (?, ?, ?, ?, ?, 1, ?)',
  );
  try {
    for (const club of DEFAULT_BAG) {
      if (existing.has(club.id)) {
        db.runSync(
          'UPDATE clubs SET name = ?, short_name = ?, loft_rank = ?, sort_order = ? WHERE id = ?',
          [club.name, club.shortName, club.loftRank, club.sortOrder, club.id],
        );
      } else {
        insert.executeSync([
          club.id,
          club.name,
          club.shortName,
          club.loftRank,
          club.sortOrder,
          club.typicalCarryYards,
        ]);
      }
    }
  } finally {
    insert.finalizeSync();
  }
}

/** Drop Build 19 invented seeds. A typed number that differs from stock stays. */
function clearLegacyStockCarry(db: SQLiteDatabase): void {
  for (const [id, yards] of Object.entries(LEGACY_STOCK_CARRY_YARDS)) {
    if (!isLegacyStockCarry(id, yards)) continue;
    db.runSync('UPDATE clubs SET typical_carry_yards = NULL WHERE id = ? AND typical_carry_yards = ?', [
      id,
      yards,
    ]);
  }
}
