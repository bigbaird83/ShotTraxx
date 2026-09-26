import type { SQLiteDatabase } from 'expo-sqlite';
import {
  attachHoleFromCourse,
  seedHoleFromCourse,
  type CourseLayoutSeed,
} from '../course/layout';
import { clubIsLive, resolveBagCarry, type BagCarry } from '../domain/bagDistance';
import {
  BAG_CARRY_SUGGESTION_DISMISS_KEY,
  suggestBagCarry,
  type BagCarrySuggestion,
} from '../domain/bagSuggestion';
import { fillEstimatedCarries, type CarrySource } from '../domain/carryFill';
import { DEFAULT_BAG, isPutterClubId } from '../domain/defaultBag';
import {
  bagCustomizeSeenValue,
  bagCustomizeSkipValue,
  BAG_CUSTOMIZE_SETTING_KEY,
  shouldPromptBagCustomize,
} from '../domain/bagCustomize';
import {
  FIRST_LAUNCH_TIP_SETTING_KEY,
  firstLaunchTipSeenValue,
  isFirstLaunchTipSeen,
} from '../domain/firstLaunchTip';
import { planInsertPlacedShot } from '../domain/insertShot';
import type { OsmFeature } from '../course/types';
import type { SgHoleIn } from '../domain/strokesGained';
import {
  parseShotLie,
  parseShotLieSource,
  planAutoShotLies,
  type ShotLie,
} from '../domain/shotLie';
import {
  COURSE_DISTANCE_SETTING_KEY,
  parseCourseDistanceUnit,
  type CourseDistanceUnit,
} from '../domain/courseDistance';
import {
  COLOR_THEME_SETTING_KEY,
  parseColorThemeId,
  type ColorThemeId,
} from '../domain/colorTheme';
import {
  isThunderbirdPinSheetId,
  resolveThunderbirdPinSheet,
  THUNDERBIRD_PIN_SHEET_SETTING_KEY,
  type ThunderbirdPinSheetId,
} from '../domain/thunderbirdPins';
import { clubAverageFromShots, type ClubAverage } from '../domain/averages';
import { dropCourseOverlayMemory, rememberResolvedTee } from '../course/osmOverlay';
import { COURSE_OSM_OVERLAY_SETTING_KEY, forgetCourseOsmOverlay } from '../course/osmOverlayStore';
import { COURSE_PAINT_CACHE_SETTING_KEY, forgetCoursePaintCacheForCourse } from '../course/paintCache';
import { isYardTestCourseId, YARD_TEST_COURSE_ID, YARD_TEST_COURSE_KEY, yardTestCourseEnabled } from '../course/yardTestCourse';
import { isValidLatLng } from '../domain/latLng';
import {
  FAVORITES_SETTING_KEY,
  listFavorites,
  OFFLINE_PACKS_SETTING_KEY,
  parseFavorites,
  parseOfflinePacks,
  type FavoriteCourse,
} from '../domain/favorites';
import { WATCH_HOME_LAST_NEARBY_KEY, parseCachedNearby } from '../domain/watchHome';
import { buildRoundsCsv, buildShotsCsv, type CsvShot } from '../domain/roundCsv';
import {
  acceptTransferPenalty,
  buildRoundHistoryExport,
  planFavoriteRestoreMerge,
  penaltiesNewerThanExport,
  planRoundHistoryImport,
  planRoundRestoreMerge,
  sameRoundTransferContent,
  type RoundHistoryDocument,
  type RoundTransferBagClub,
  type RoundTransferFavorite,
  type RoundTransferPenalty,
  type RoundTransferRound,
  type RoundTransferShot,
} from '../domain/roundTransfer';
import { newShareBoardCode, normalizeShareBoardCode } from '../domain/liveBoard';
import { planHoleStartStamp } from '../domain/livePace';
import { parseSpectatorPayload, type SpectatorPayload } from '../domain/spectator';
import { planHoleOutCloseToPin } from '../domain/holeOutClose';
import { planFinishHoleScore, planRecomputeFinishedHoleScore } from '../domain/holeScore';
import { parseFairwayResult, type FairwayResult } from '../domain/fairwayGir';
import type { HandicapRoundIn } from '../domain/handicap';
import type { DispersionShotIn } from '../domain/dispersion';
import { planChangePenaltyReason } from '../domain/penaltyEdit';
import { clampPenaltyStrokes, scoreAfterPenalty, scoreAfterPenaltyRemoval, totalPenaltyStrokes } from '../domain/penalty';
import {
  clampPutts,
  planAttachPuttLength,
  planFinishHoleOut,
  planFlagLastRealShot,
  planPersistMadeIt,
  parsePuttLengthSlots,
  serializePuttLengthSlots,
  serializePuttLengths,
  type PuttLengthId,
} from '../domain/putts';
import { applyMoveShotSpot, type ShotEditSnapshot } from '../domain/shotEdit';
import {
  confirmUndoAverageEligibleAt,
  confirmUndoShotEntersAverage,
} from '../domain/confirmUndo';
import { includeInDistanceAverages, planNoGpsShot, planPlacedShot } from '../domain/shotSource';
import { planUndoLastShot } from '../domain/undoLastShot';
import { planUndoLastSoftGpsClubMark } from '../domain/undoSoftGpsClubMark';
import { planDeleteShot } from '../domain/deleteShot';
import type {
  Club,
  FixQuality,
  GreenSource,
  Hole,
  HolePenalty,
  OpenShot,
  ParSource,
  PenaltyKind,
  PenaltyReason,
  Round,
  Shot,
  ShotFixQuality,
  ShotSource,
} from '../domain/types';
import { newId } from '../lib/id';

export type { CourseLayoutSeed } from '../course/layout';

type ClubRow = {
  id: string;
  name: string;
  short_name: string;
  loft_rank: number;
  sort_order: number;
  enabled: number;
  typical_carry_yards: number | null;
};

type RoundRow = {
  id: string;
  started_at: string;
  finished_at: string | null;
  course_name: string | null;
  hole_count: number;
  course_api_id: string | null;
  course_lat: number | null;
  course_lng: number | null;
  tee_name: string | null;
  tee_rating: number | null;
  tee_slope: number | null;
  tee_total_yards: number | null;
  last_club_id: string | null;
  share_token?: string | null;
  course_city?: string | null;
  course_state?: string | null;
  course_data_source?: string | null;
  is_test?: number | null;
};

type HoleRow = {
  id: string;
  round_id: string;
  number: number;
  par: number | null;
  par_source: string | null;
  score: number | null;
  yards: number | null;
  handicap: number | null;
  green_lat: number | null;
  green_lng: number | null;
  green_source: string | null;
  green_front_lat: number | null;
  green_front_lng: number | null;
  green_back_lat: number | null;
  green_back_lng: number | null;
  green_depth_yards: number | null;
  tee_lat: number | null;
  tee_lng: number | null;
  putts: number | null;
  putt_lengths: string | null;
  putts_done: number | null;
  started_at?: string | null;
  completed_at?: string | null;
  fairway?: string | null;
};

type ShotRow = {
  id: string;
  hole_id: string;
  club_id: string | null;
  seq: number;
  start_lat: number | null;
  start_lng: number | null;
  start_accuracy_m: number | null;
  start_fix_quality: string | null;
  end_lat: number | null;
  end_lng: number | null;
  end_accuracy_m: number | null;
  end_fix_quality: string | null;
  distance_yards: number | null;
  typed_yards: number | null;
  fix_quality: string | null;
  impossible_jump: number;
  started_at: string;
  ended_at: string | null;
  source: string | null;
  suggested: number | null;
  average_eligible_at: string | null;
  hole_out: number | null;
  lie?: string | null;
  lie_source?: string | null;
};

type PenaltyRow = {
  id: string;
  hole_id: string;
  strokes: number;
  reason: string;
  note: string | null;
  created_at: string;
  kind: string | null;
  lat: number | null;
  lng: number | null;
  after_shot_id?: string | null;
  after_shot_seq?: number | null;
};

function mapClub(row: ClubRow): Club {
  return {
    id: row.id,
    name: row.name,
    shortName: row.short_name,
    loftRank: row.loft_rank,
    sortOrder: row.sort_order,
    enabled: row.enabled === 1,
    typicalCarryYards: isPutterClubId(row.id) ? null : (row.typical_carry_yards ?? null),
  };
}

function mapGreenSource(value: string | null): GreenSource | null {
  if (value === 'user_estimate' || value === 'course_centroid') return value;
  return null;
}

function mapParSource(value: string | null): ParSource | null {
  if (value === 'course' || value === 'user') return value;
  return null;
}

function mapRound(row: RoundRow): Round {
  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    courseName: row.course_name,
    holeCount: row.hole_count,
    courseApiId: row.course_api_id ?? null,
    courseLat: row.course_lat ?? null,
    courseLng: row.course_lng ?? null,
    teeName: row.tee_name ?? null,
    teeRating: row.tee_rating ?? null,
    teeSlope: row.tee_slope ?? null,
    teeTotalYards: row.tee_total_yards ?? null,
    lastClubId: row.last_club_id ?? null,
    courseCity: row.course_city ?? null,
    courseState: row.course_state ?? null,
    courseDataSource: row.course_data_source ?? null,
    isTest: (row.is_test ?? 0) === 1,
  };
}

function mapHole(row: HoleRow): Hole {
  return {
    id: row.id,
    roundId: row.round_id,
    number: row.number,
    par: row.par,
    parSource: mapParSource(row.par_source),
    score: row.score,
    yards: row.yards ?? null,
    handicap: row.handicap ?? null,
    greenLat: row.green_lat,
    greenLng: row.green_lng,
    greenSource: mapGreenSource(row.green_source),
    greenFrontLat: row.green_front_lat ?? null,
    greenFrontLng: row.green_front_lng ?? null,
    greenBackLat: row.green_back_lat ?? null,
    greenBackLng: row.green_back_lng ?? null,
    greenDepthYards: row.green_depth_yards ?? null,
    teeLat: row.tee_lat ?? null,
    teeLng: row.tee_lng ?? null,
    putts: clampPutts(row.putts ?? 0),
    puttLengths: parsePuttLengthSlots(row.putt_lengths, clampPutts(row.putts ?? 0)).map(
      (id) => id ?? '',
    ),
    puttsDone: (row.putts_done ?? 0) === 1,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    fairway: parseFairwayResult(row.fairway ?? null),
  };
}

function mapSource(value: string | null): ShotSource {
  if (value === 'no_gps') return 'no_gps';
  if (value === 'placed') return 'placed';
  return 'gps';
}

function mapFixQuality(value: string | null, source: ShotSource): ShotFixQuality | null {
  if (source === 'placed') return null;
  if (source === 'no_gps' || value === 'none') return 'none';
  if (value === 'good' || value === 'soft' || value === 'forced') return value;
  return value as FixQuality | null;
}

function mapShot(row: ShotRow): Shot {
  const source = mapSource(row.source);
  return {
    id: row.id,
    holeId: row.hole_id,
    clubId: row.club_id,
    seq: row.seq,
    startLat: row.start_lat,
    startLng: row.start_lng,
    startAccuracyM: row.start_accuracy_m,
    startFixQuality: mapFixQuality(row.start_fix_quality, source),
    endLat: row.end_lat,
    endLng: row.end_lng,
    endAccuracyM: row.end_accuracy_m,
    endFixQuality: mapFixQuality(row.end_fix_quality, source),
    distanceYards: source === 'no_gps' ? null : row.distance_yards,
    typedYards: row.typed_yards ?? null,
    fixQuality: mapFixQuality(row.fix_quality, source),
    impossibleJump: row.impossible_jump === 1,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    source,
    suggested: row.suggested === 1,
    holeOut: (row.hole_out ?? 0) === 1,
    averageEligibleAt: row.average_eligible_at ?? null,
    lie: parseShotLie(row.lie),
    lieSource: parseShotLie(row.lie) ? parseShotLieSource(row.lie_source) : null,
  };
}

function mapPenalty(row: PenaltyRow): HolePenalty {
  const reason = row.reason;
  const kind: PenaltyKind = row.kind === 'drop' ? 'drop' : 'penalty';
  return {
    id: row.id,
    holeId: row.hole_id,
    strokes: row.strokes,
    reason:
      reason === 'water' || reason === 'ob' || reason === 'unplayable' || reason === 'other'
        ? reason
        : 'other',
    note: row.note,
    createdAt: row.created_at,
    kind,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    afterShotId: textOrNull(row.after_shot_id),
    afterShotSeq: integerOrNull(row.after_shot_seq),
  };
}

function textOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function integerOrNull(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value;
}

export function listClubs(db: SQLiteDatabase, enabledOnly = false): Club[] {
  const sql = enabledOnly
    ? 'SELECT * FROM clubs WHERE enabled = 1 ORDER BY sort_order ASC'
    : 'SELECT * FROM clubs ORDER BY sort_order ASC';
  return db.getAllSync<ClubRow>(sql).map(mapClub);
}

export function setClubEnabled(db: SQLiteDatabase, id: string, enabled: boolean): void {
  db.runSync('UPDATE clubs SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
}

export function addClub(
  db: SQLiteDatabase,
  name: string,
  shortName: string,
  typicalCarryYards: number | null = null,
): Club {
  const max = db.getFirstSync<{ n: number }>('SELECT COALESCE(MAX(sort_order), -1) AS n FROM clubs');
  const sortOrder = (max?.n ?? -1) + 1;
  const club: Club = {
    id: newId(),
    name: name.trim(),
    shortName: shortName.trim() || name.trim().slice(0, 3),
    loftRank: sortOrder,
    sortOrder,
    enabled: true,
    typicalCarryYards,
  };
  db.runSync(
    'INSERT INTO clubs (id, name, short_name, loft_rank, sort_order, enabled, typical_carry_yards) VALUES (?, ?, ?, ?, ?, 1, ?)',
    [club.id, club.name, club.shortName, club.loftRank, club.sortOrder, club.typicalCarryYards],
  );
  return club;
}

export function updateClubCarry(db: SQLiteDatabase, id: string, typicalCarryYards: number | null): void {
  if (isPutterClubId(id)) {
    db.runSync('UPDATE clubs SET typical_carry_yards = NULL WHERE id = ?', [id]);
    return;
  }
  db.runSync('UPDATE clubs SET typical_carry_yards = ? WHERE id = ?', [typicalCarryYards, id]);
}

export function updateClub(
  db: SQLiteDatabase,
  id: string,
  name: string,
  shortName: string,
  typicalCarryYards?: number | null,
): void {
  const trimmedName = name.trim();
  const trimmedShort = shortName.trim() || trimmedName.slice(0, 3);
  if (isPutterClubId(id)) {
    db.runSync('UPDATE clubs SET name = ?, short_name = ?, typical_carry_yards = NULL WHERE id = ?', [
      trimmedName,
      trimmedShort,
      id,
    ]);
    return;
  }
  if (typicalCarryYards === undefined) {
    db.runSync('UPDATE clubs SET name = ?, short_name = ? WHERE id = ?', [
      trimmedName,
      trimmedShort,
      id,
    ]);
    return;
  }
  db.runSync('UPDATE clubs SET name = ?, short_name = ?, typical_carry_yards = ? WHERE id = ?', [
    trimmedName,
    trimmedShort,
    typicalCarryYards,
    id,
  ]);
}

export function deleteClub(db: SQLiteDatabase, id: string): 'deleted' | 'disabled' {
  const used = db.getFirstSync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM shots WHERE club_id = ?',
    [id],
  );
  if ((used?.n ?? 0) > 0) {
    db.runSync('UPDATE clubs SET enabled = 0 WHERE id = ?', [id]);
    return 'disabled';
  }
  db.runSync('DELETE FROM clubs WHERE id = ?', [id]);
  return 'deleted';
}

export function restoreDefaultBag(db: SQLiteDatabase): void {
  const existing = new Set(listClubs(db).map((club) => club.id));
  const insert = db.prepareSync(
    'INSERT INTO clubs (id, name, short_name, loft_rank, sort_order, enabled, typical_carry_yards) VALUES (?, ?, ?, ?, ?, 1, ?)',
  );
  try {
    for (const club of DEFAULT_BAG) {
      if (existing.has(club.id)) {
        db.runSync(
          'UPDATE clubs SET name = ?, short_name = ?, loft_rank = ?, sort_order = ?, enabled = 1, typical_carry_yards = ? WHERE id = ?',
          [club.name, club.shortName, club.loftRank, club.sortOrder, club.typicalCarryYards, club.id],
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

export function listRounds(db: SQLiteDatabase): Round[] {
  return db
    .getAllSync<RoundRow>('SELECT * FROM rounds ORDER BY started_at DESC')
    .map(mapRound);
}

/** Rounds that feed averages, trends, GIR, handicap, and dispersion. Test rounds stay out. */
export function listStatRounds(db: SQLiteDatabase): Round[] {
  return listRounds(db).filter((round) => !round.isTest);
}

export function getRound(db: SQLiteDatabase, id: string): Round | null {
  const row = db.getFirstSync<RoundRow>('SELECT * FROM rounds WHERE id = ?', [id]);
  return row ? mapRound(row) : null;
}

export function getActiveRound(db: SQLiteDatabase): Round | null {
  const row = db.getFirstSync<RoundRow>(
    'SELECT * FROM rounds WHERE finished_at IS NULL ORDER BY started_at DESC LIMIT 1',
  );
  return row ? mapRound(row) : null;
}

export function startRound(
  db: SQLiteDatabase,
  holeCount: 9 | 18,
  courseName: string | null,
  layout?: CourseLayoutSeed | null,
): Round {
  const id = newId();
  const startedAt = new Date().toISOString();
  const courseApiId = layout?.apiId ?? null;
  const courseLoc = isValidLatLng(layout?.location ?? null) ? layout?.location ?? null : null;
  const previous = db.getFirstSync<RoundRow>(
    'SELECT * FROM rounds ORDER BY started_at DESC LIMIT 1',
  );
  const lastClubId = previous?.last_club_id ?? null;
  const isTest = isYardTestCourseId(courseApiId);
  db.withTransactionSync(() => {
    db.runSync(
      'INSERT INTO rounds (id, started_at, finished_at, course_name, hole_count, course_api_id, course_lat, course_lng, tee_name, tee_rating, tee_slope, tee_total_yards, last_club_id, course_city, course_state, course_data_source, is_test) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        startedAt,
        courseName,
        holeCount,
        courseApiId,
        courseLoc?.lat ?? null,
        courseLoc?.lng ?? null,
        layout?.teeName ?? null,
        layout?.teeRating ?? null,
        layout?.teeSlope ?? null,
        layout?.teeTotalYards ?? null,
        lastClubId,
        layout?.city ?? null,
        layout?.state ?? null,
        layout?.courseDataSource ?? null,
        isTest ? 1 : 0,
      ],
    );
    for (let n = 1; n <= holeCount; n += 1) {
      const seed = layout?.holes?.find((hole) => hole.number === n);
      const applied = seedHoleFromCourse(seed ?? null);
      db.runSync(
        'INSERT INTO holes (id, round_id, number, par, par_source, score, yards, handicap, green_lat, green_lng, green_source, green_front_lat, green_front_lng, green_back_lat, green_back_lng, green_depth_yards, tee_lat, tee_lng) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          newId(),
          id,
          n,
          applied.par,
          applied.parSource,
          applied.yards,
          applied.handicap,
          applied.green?.lat ?? null,
          applied.green?.lng ?? null,
          applied.greenSource,
          applied.greenFront?.lat ?? null,
          applied.greenFront?.lng ?? null,
          applied.greenBack?.lat ?? null,
          applied.greenBack?.lng ?? null,
          applied.greenDepthYards,
          isValidLatLng(seed?.teeCentroid ?? null) ? seed!.teeCentroid!.lat : null,
          isValidLatLng(seed?.teeCentroid ?? null) ? seed!.teeCentroid!.lng : null,
        ],
      );
      const tee = isValidLatLng(seed?.teeCentroid ?? null) ? seed?.teeCentroid ?? null : null;
      const green = applied.green;
      if (tee && green) {
        rememberResolvedTee({ courseId: courseApiId, holeNumber: n, green }, tee);
      }
    }
  });
  return {
    id,
    startedAt,
    finishedAt: null,
    courseName,
    holeCount,
    courseApiId,
    courseLat: courseLoc?.lat ?? null,
    courseLng: courseLoc?.lng ?? null,
    teeName: layout?.teeName ?? null,
    teeRating: layout?.teeRating ?? null,
    teeSlope: layout?.teeSlope ?? null,
    teeTotalYards: layout?.teeTotalYards ?? null,
    lastClubId,
    courseCity: layout?.city ?? null,
    courseState: layout?.state ?? null,
    courseDataSource: layout?.courseDataSource ?? null,
    isTest,
  };
}

/**
 * Attach a nearby course to an in-progress round. Fills blank par/green only.
 * Never overwrites user par/green and never invents missing API fields.
 */
export function attachCourseToRound(
  db: SQLiteDatabase,
  roundId: string,
  courseName: string | null,
  layout: CourseLayoutSeed,
): void {
  const courseLoc = isValidLatLng(layout.location ?? null) ? layout.location ?? null : null;
  db.withTransactionSync(() => {
    db.runSync(
      'UPDATE rounds SET course_name = COALESCE(?, course_name), course_api_id = ?, course_lat = ?, course_lng = ?, tee_name = ?, tee_rating = ?, tee_slope = ?, tee_total_yards = ?, course_city = COALESCE(?, course_city), course_state = COALESCE(?, course_state), course_data_source = COALESCE(?, course_data_source) WHERE id = ?',
      [
        courseName,
        layout.apiId,
        courseLoc?.lat ?? null,
        courseLoc?.lng ?? null,
        layout.teeName ?? null,
        layout.teeRating ?? null,
        layout.teeSlope ?? null,
        layout.teeTotalYards ?? null,
        layout.city ?? null,
        layout.state ?? null,
        layout.courseDataSource ?? null,
        roundId,
      ],
    );
    const holes = db.getAllSync<HoleRow>(
      'SELECT * FROM holes WHERE round_id = ? ORDER BY number ASC',
      [roundId],
    );
    for (const row of holes) {
      const seed = layout.holes?.find((hole) => hole.number === row.number);
      const applied = attachHoleFromCourse(
        {
          par: row.par,
          parSource: mapParSource(row.par_source),
          greenLat: row.green_lat,
          greenLng: row.green_lng,
          greenSource: mapGreenSource(row.green_source),
        },
        seed ?? null,
      );
      const tee = isValidLatLng(seed?.teeCentroid ?? null) ? seed?.teeCentroid ?? null : null;
      db.runSync(
        'UPDATE holes SET par = ?, par_source = ?, yards = ?, handicap = ?, green_lat = ?, green_lng = ?, green_source = ?, green_front_lat = ?, green_front_lng = ?, green_back_lat = ?, green_back_lng = ?, green_depth_yards = ?, tee_lat = COALESCE(?, tee_lat), tee_lng = COALESCE(?, tee_lng) WHERE id = ?',
        [
          applied.par,
          applied.parSource,
          applied.yards,
          applied.handicap,
          applied.green?.lat ?? null,
          applied.green?.lng ?? null,
          applied.greenSource,
          applied.greenFront?.lat ?? null,
          applied.greenFront?.lng ?? null,
          applied.greenBack?.lat ?? null,
          applied.greenBack?.lng ?? null,
          applied.greenDepthYards,
          tee?.lat ?? null,
          tee?.lng ?? null,
          row.id,
        ],
      );
      if (tee && applied.green) {
        rememberResolvedTee({ courseId: layout.apiId, holeNumber: row.number, green: applied.green }, tee);
      }
    }
  });
}

function transferredPenalties(db: SQLiteDatabase, holeId: string): RoundTransferPenalty[] {
  return db
    .getAllSync<PenaltyRow>(
      'SELECT * FROM hole_penalties WHERE hole_id = ? ORDER BY created_at ASC',
      [holeId],
    )
    .flatMap((row) => {
      const penalty = acceptTransferPenalty({
        id: row.id,
        kind: row.kind,
        strokes: row.strokes,
        reason: row.reason,
        note: row.note,
        createdAt: row.created_at,
        lat: row.lat,
        lng: row.lng,
        afterShotId: row.after_shot_id,
        afterShotSeq: row.after_shot_seq,
      });
      return penalty ? [penalty] : [];
    });
}

export function collectRoundHistoryExport(db: SQLiteDatabase, exportedAt: string): RoundHistoryDocument {
  const store = readSettingStore(db);
  const rounds = listRounds(db).map((round) => ({
    id: round.id,
    startedAt: round.startedAt,
    finishedAt: round.finishedAt,
    courseName: round.courseName,
    holeCount: round.holeCount,
    courseApiId: round.courseApiId,
    courseLat: round.courseLat,
    courseLng: round.courseLng,
    courseCity: round.courseCity,
    courseState: round.courseState,
    courseDataSource: round.courseDataSource,
    teeName: round.teeName,
    teeRating: round.teeRating,
    teeSlope: round.teeSlope,
    teeTotalYards: round.teeTotalYards,
    test: round.isTest,
    holes: listHoles(db, round.id).map((hole) => ({
      number: hole.number,
      par: hole.par,
      parSource: hole.parSource,
      score: hole.score,
      yards: hole.yards,
      handicap: hole.handicap,
      teeLat: hole.teeLat,
      teeLng: hole.teeLng,
      greenLat: hole.greenLat,
      greenLng: hole.greenLng,
      greenSource: hole.greenSource,
      greenFrontLat: hole.greenFrontLat,
      greenFrontLng: hole.greenFrontLng,
      greenBackLat: hole.greenBackLat,
      greenBackLng: hole.greenBackLng,
      greenDepthYards: hole.greenDepthYards,
      putts: hole.putts,
      puttLengths: hole.puttLengths,
      puttsDone: hole.puttsDone,
      startedAt: hole.startedAt,
      completedAt: hole.completedAt,
      fairway: hole.fairway,
      penalties: transferredPenalties(db, hole.id),
      shots: listShotsForHole(db, hole.id).map((shot) => ({
        clubId: shot.clubId,
        seq: shot.seq,
        startLat: shot.startLat,
        startLng: shot.startLng,
        endLat: shot.endLat,
        endLng: shot.endLng,
        startAccuracyM: shot.startAccuracyM,
        endAccuracyM: shot.endAccuracyM,
        startFixQuality: shot.startFixQuality,
        endFixQuality: shot.endFixQuality,
        distanceYards: shot.distanceYards,
        typedYards: shot.typedYards,
        fixQuality: shot.fixQuality,
        impossibleJump: shot.impossibleJump,
        startedAt: shot.startedAt,
        endedAt: shot.endedAt,
        source: shot.source,
        suggested: shot.suggested,
        holeOut: shot.holeOut,
        averageEligibleAt: shot.averageEligibleAt ?? null,
        lie: shot.lie ?? null,
        lieSource: shot.lieSource ?? null,
      })),
    })),
  }));
  const clubs = listClubs(db).map((club) => ({ id: club.id, name: club.name, shortName: club.shortName }));
  const favorites = listFavorites(store).map((favorite) => ({
    id: favorite.id,
    name: favorite.name,
    city: favorite.city,
    state: favorite.state,
    location: favorite.location,
  }));
  const bag = listClubs(db).map((club) => ({
    id: club.id,
    enabled: club.enabled,
    sortOrder: club.sortOrder,
    typicalCarryYards: club.typicalCarryYards,
  }));
  return buildRoundHistoryExport({ rounds, clubs, favorites, bag, exportedAt });
}

/**
 * Merge a rounds file into this phone. Other rounds stay. A round whose id is
 * already here is replaced (its live-board token and shared flag are kept). A round already
 * here without a matching id is skipped so a second restore does not
 * double-count. Does not write a stored average. Club averages recompute from shots.
 */
export function restoreRoundHistory(
  db: SQLiteDatabase,
  raw: unknown,
):
  | {
      ok: true;
      added: number;
      updated: number;
      shots: number;
      rejectedShots: number;
      favoritesAdded: number;
      bag: RoundTransferBagClub[];
    }
  | { ok: false; reason: string } {
  const plan = planRoundHistoryImport(raw);
  if (!plan.ok) return plan;
  const clubs = new Set(db.getAllSync<{ id: string }>('SELECT id FROM clubs').map((row) => row.id));
  const merge = planRoundRestoreMerge({ existing: listRounds(db), incoming: plan.rounds });
  const replace = merge.replace.filter((round) => {
    const stored = round.id ? storedRoundAsTransfer(db, round.id) : null;
    return stored == null || !sameRoundTransferContent(stored, round, plan.exportedAt);
  });
  let shots = 0;
  let favoritesAdded = 0;
  db.withTransactionSync(() => {
    for (const round of replace) {
      const id = round.id as string;
      const token = getRoundShareToken(db, id);
      const sharedAt = getRoundSharedAt(db, id);
      // Read before delete. Unknown lists are copied whole. An explicit list keeps phone rows newer than exportedAt.
      const carried = phonePenaltiesByHole(db, id);
      deleteRoundRows(db, id);
      insertTransferredRound(db, round, clubs, id, carried, plan.exportedAt);
      if (token) db.runSync('UPDATE rounds SET share_token = ? WHERE id = ?', [token, id]);
      if (sharedAt) db.runSync('UPDATE rounds SET shared_at = ? WHERE id = ?', [sharedAt, id]);
    }
    for (const round of merge.add) {
      insertTransferredRound(db, round, clubs, round.id ?? newId());
    }
    for (const round of [...replace, ...merge.add]) {
      shots += round.holes.reduce((sum, hole) => sum + hole.shots.length, 0);
    }
    favoritesAdded = addRestoredFavorites(db, plan.favorites);
    purgeYardTestCourseSaved(db);
  });
  return {
    ok: true,
    added: merge.add.length,
    updated: replace.length,
    shots,
    rejectedShots: plan.rejectedShots,
    favoritesAdded,
    bag: plan.bag,
  };
}

type CarriedPenalty = {
  id: string;
  strokes: number;
  reason: string;
  note: string | null;
  createdAt: string;
  kind: string;
  lat: number | null;
  lng: number | null;
  afterShotId: string | null;
  afterShotSeq: number | null;
};

/** Every stored penalty on the round, keyed by hole number. Caller still owns the rows. */
function phonePenaltiesByHole(db: SQLiteDatabase, roundId: string): Map<number, CarriedPenalty[]> {
  const carried = new Map<number, CarriedPenalty[]>();
  const holes = db.getAllSync<{ id: string; number: number }>('SELECT id, number FROM holes WHERE round_id = ?', [
    roundId,
  ]);
  for (const hole of holes) {
    const rows = db.getAllSync<PenaltyRow>(
      'SELECT * FROM hole_penalties WHERE hole_id = ? ORDER BY created_at ASC',
      [hole.id],
    );
    carried.set(
      hole.number,
      rows.map((row) => ({
        id: row.id,
        strokes: row.strokes,
        reason: row.reason,
        note: row.note,
        createdAt: row.created_at,
        kind: row.kind ?? 'penalty',
        lat: row.lat ?? null,
        lng: row.lng ?? null,
        afterShotId: textOrNull(row.after_shot_id),
        afterShotSeq: integerOrNull(row.after_shot_seq),
      })),
    );
  }
  return carried;
}

function insertCarriedPenalty(db: SQLiteDatabase, holeId: string, penalty: CarriedPenalty): void {
  db.runSync(
    'INSERT INTO hole_penalties (id, hole_id, strokes, reason, note, created_at, kind, lat, lng, after_shot_id, after_shot_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      penalty.id.trim() || newId(),
      holeId,
      penalty.strokes,
      penalty.reason,
      penalty.note,
      penalty.createdAt,
      penalty.kind,
      penalty.lat,
      penalty.lng,
      textOrNull(penalty.afterShotId),
      integerOrNull(penalty.afterShotSeq),
    ],
  );
}

function insertTransferredRound(
  db: SQLiteDatabase,
  round: RoundTransferRound,
  clubs: Set<string>,
  roundId: string,
  carriedPenalties?: ReadonlyMap<number, CarriedPenalty[]>,
  exportedAt?: string | null,
): void {
  const courseLoc = isValidLatLng(
    round.courseLat != null && round.courseLng != null
      ? { lat: round.courseLat, lng: round.courseLng }
      : null,
  )
    ? { lat: round.courseLat as number, lng: round.courseLng as number }
    : null;
  db.runSync(
    'INSERT INTO rounds (id, started_at, finished_at, course_name, hole_count, course_api_id, course_lat, course_lng, tee_name, tee_rating, tee_slope, tee_total_yards, last_club_id, course_city, course_state, course_data_source, is_test) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)',
    [
      roundId,
      round.startedAt,
      round.finishedAt,
      round.courseName,
      round.holeCount,
      round.courseApiId,
      courseLoc?.lat ?? null,
      courseLoc?.lng ?? null,
      round.teeName,
      round.teeRating,
      round.teeSlope,
      round.teeTotalYards,
      round.courseCity,
      round.courseState,
      round.courseDataSource,
      round.test ? 1 : 0,
    ],
  );
  for (const hole of round.holes) {
    const holeId = newId();
    db.runSync(
      'INSERT INTO holes (id, round_id, number, par, par_source, score, yards, handicap, green_lat, green_lng, green_source, green_front_lat, green_front_lng, green_back_lat, green_back_lng, green_depth_yards, tee_lat, tee_lng, putts, putt_lengths, putts_done, started_at, completed_at, fairway) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        holeId,
        roundId,
        hole.number,
        hole.par,
        hole.parSource,
        hole.score,
        hole.yards,
        hole.handicap,
        hole.green?.lat ?? null,
        hole.green?.lng ?? null,
        hole.green ? hole.greenSource : null,
        hole.greenFront?.lat ?? null,
        hole.greenFront?.lng ?? null,
        hole.greenBack?.lat ?? null,
        hole.greenBack?.lng ?? null,
        hole.greenDepthYards,
        hole.tee?.lat ?? null,
        hole.tee?.lng ?? null,
        hole.putts,
        hole.puttLengths.length ? hole.puttLengths.join(',') : null,
        hole.puttsDone ? 1 : 0,
        hole.startedAt,
        hole.completedAt,
        hole.fairway,
      ],
    );
    for (const shot of hole.shots) {
      const clubId = shot.clubId && clubs.has(shot.clubId) ? shot.clubId : null;
      db.runSync(
        `INSERT INTO shots (
          id, hole_id, club_id, seq,
          start_lat, start_lng, start_accuracy_m, start_fix_quality,
          end_lat, end_lng, end_accuracy_m, end_fix_quality,
          distance_yards, typed_yards, fix_quality, impossible_jump,
          started_at, ended_at, source, suggested, average_eligible_at, hole_out,
          lie, lie_source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId(),
          holeId,
          clubId,
          shot.seq,
          shot.start.lat,
          shot.start.lng,
          shot.startAccuracyM,
          shot.startFixQuality,
          shot.end.lat,
          shot.end.lng,
          shot.endAccuracyM,
          shot.endFixQuality,
          shot.distanceYards,
          shot.typedYards,
          shot.fixQuality,
          shot.impossibleJump ? 1 : 0,
          shot.startedAt,
          shot.endedAt,
          shot.source,
          shot.suggested ? 1 : 0,
          shot.averageEligibleAt,
          shot.holeOut ? 1 : 0,
          shot.playerLie ?? null,
          shot.playerLie ? 'player' : null,
        ],
      );
    }
    const phoneRows = carriedPenalties?.get(hole.number) ?? [];
    if (hole.penalties == null) {
      for (const penalty of phoneRows) insertCarriedPenalty(db, holeId, penalty);
    } else {
      // File list wins for rows at or before exportedAt. Newer phone rows are added.
      // A phone delete is a local Watch tombstone, not a field in this file, so a
      // backup that still lists that penalty writes it again.
      for (const penalty of hole.penalties) {
        const point =
          penalty.lat != null && penalty.lng != null && isValidLatLng({ lat: penalty.lat, lng: penalty.lng })
            ? { lat: penalty.lat, lng: penalty.lng }
            : null;
        insertCarriedPenalty(db, holeId, {
          id: penalty.id ?? '',
          strokes: penalty.strokes,
          reason: penalty.reason,
          note: penalty.note,
          createdAt: penalty.createdAt,
          kind: penalty.kind,
          lat: point?.lat ?? null,
          lng: point?.lng ?? null,
          afterShotId: penalty.afterShotId,
          afterShotSeq: penalty.afterShotSeq,
        });
      }
      const newer = penaltiesNewerThanExport(hole.penalties, phoneRows, exportedAt ?? null);
      for (const penalty of newer) insertCarriedPenalty(db, holeId, penalty);
    }
  }
}

function pointOrNull(lat: number | null, lng: number | null): { lat: number; lng: number } | null {
  if (lat == null || lng == null) return null;
  const point = { lat, lng };
  return isValidLatLng(point) ? point : null;
}

/** Stored round in transfer shape, for an identical-file no-op. no_gps shots are not in the file. */
function storedRoundAsTransfer(db: SQLiteDatabase, id: string): RoundTransferRound | null {
  const round = getRound(db, id);
  if (!round || (round.holeCount !== 9 && round.holeCount !== 18)) return null;
  const holes = listHoles(db, id).map((hole) => {
    const shots: RoundTransferShot[] = [];
    for (const shot of listShotsForHole(db, hole.id)) {
      if (shot.source === 'no_gps') continue;
      const start = pointOrNull(shot.startLat, shot.startLng);
      const end = pointOrNull(shot.endLat, shot.endLng);
      if (!start || !end || shot.distanceYards == null) continue;
      shots.push({
        clubId: shot.clubId,
        seq: shot.seq,
        start,
        end,
        startAccuracyM: shot.startAccuracyM,
        endAccuracyM: shot.endAccuracyM,
        startFixQuality: shot.source === 'placed' ? null : shot.startFixQuality,
        endFixQuality: shot.source === 'placed' ? null : shot.endFixQuality,
        distanceYards: shot.distanceYards,
        typedYards: shot.typedYards,
        fixQuality: shot.source === 'placed' ? null : shot.fixQuality,
        impossibleJump: shot.impossibleJump,
        startedAt: shot.startedAt,
        endedAt: shot.endedAt,
        source: shot.source === 'placed' ? 'placed' : 'gps',
        suggested: shot.suggested,
        holeOut: shot.holeOut,
        averageEligibleAt: shot.averageEligibleAt ?? null,
        ...(shot.lieSource === 'player' && shot.lie ? { playerLie: shot.lie } : {}),
      });
    }
    const green = pointOrNull(hole.greenLat, hole.greenLng);
    return {
      number: hole.number,
      par: hole.par,
      parSource: hole.parSource,
      score: hole.score,
      yards: hole.yards,
      handicap: hole.handicap,
      tee: pointOrNull(hole.teeLat, hole.teeLng),
      green,
      greenSource: green ? hole.greenSource : null,
      greenFront: pointOrNull(hole.greenFrontLat, hole.greenFrontLng),
      greenBack: pointOrNull(hole.greenBackLat, hole.greenBackLng),
      greenDepthYards: hole.greenDepthYards,
      putts: hole.putts,
      puttLengths: hole.puttLengths,
      puttsDone: hole.puttsDone,
      startedAt: hole.startedAt,
      completedAt: hole.completedAt,
      fairway: hole.fairway,
      shots,
      penalties: transferredPenalties(db, hole.id),
    };
  });
  return {
    id: round.id,
    startedAt: round.startedAt,
    finishedAt: round.finishedAt,
    courseName: round.courseName,
    holeCount: round.holeCount,
    courseApiId: round.courseApiId,
    courseLat: round.courseLat,
    courseLng: round.courseLng,
    courseCity: round.courseCity,
    courseState: round.courseState,
    courseCountry: null,
    teeName: round.teeName,
    teeRating: round.teeRating,
    teeSlope: round.teeSlope,
    teeTotalYards: round.teeTotalYards,
    courseDataSource: round.courseDataSource,
    test: round.isTest,
    holes,
  };
}

/** Append favorites this phone does not already have. Does not write a download pack. */
function addRestoredFavorites(db: SQLiteDatabase, incoming: readonly RoundTransferFavorite[]): number {
  const store = readSettingStore(db);
  const existing = listFavorites(store);
  const add = planFavoriteRestoreMerge(
    existing.map((favorite) => favorite.id),
    incoming,
  );
  if (add.length === 0) return 0;
  const next: FavoriteCourse[] = [
    ...existing,
    ...add.map((favorite) => ({
      id: favorite.id,
      name: favorite.name,
      city: favorite.city,
      state: favorite.state,
      country: null,
      location: favorite.location,
    })),
  ];
  store.set(FAVORITES_SETTING_KEY, JSON.stringify(next));
  return add.length;
}

/**
 * Write bag on/off, order, and typed carry for clubs already on this phone.
 * A blank carry stays null. Putter carry stays null. Unknown clubs are skipped.
 */
export function applyTransferredBag(db: SQLiteDatabase, bag: readonly RoundTransferBagClub[]): void {
  const known = new Set(listClubs(db).map((club) => club.id));
  db.withTransactionSync(() => {
    for (const club of bag) {
      if (!known.has(club.id)) continue;
      const carry = isPutterClubId(club.id) ? null : club.typicalCarryYards;
      db.runSync('UPDATE clubs SET enabled = ?, sort_order = ?, typical_carry_yards = ? WHERE id = ?', [
        club.enabled ? 1 : 0,
        club.sortOrder,
        carry,
        club.id,
      ]);
    }
  });
}

function clubLabel(clubs: ReadonlyMap<string, { name: string; shortName: string }>, clubId: string | null): string | null {
  if (!clubId) return null;
  const club = clubs.get(clubId);
  if (!club) return null;
  const label = club.shortName.trim() || club.name.trim();
  return label || null;
}

function enteredPutts(hole: { putts: number; puttsDone: boolean }): number | null {
  if (hole.puttsDone || hole.putts > 0) return hole.putts;
  return null;
}

/** rounds.csv and shots.csv from stored rows. Missing numbers stay blank. */
export function collectRoundCsv(db: SQLiteDatabase): { roundsCsv: string; shotsCsv: string } {
  const clubs = new Map(listClubs(db).map((club) => [club.id, club]));
  const rounds = listRounds(db);
  const shots: CsvShot[] = [];
  const csvRounds = rounds.map((round) => {
    const holes = listHoles(db, round.id);
    for (const hole of holes) {
      for (const shot of listShotsForHole(db, hole.id)) {
        const noGps = shot.source === 'no_gps';
        shots.push({
          roundId: round.id,
          holeNumber: hole.number,
          shotNumber: shot.seq,
          club: clubLabel(clubs, shot.clubId),
          distanceYards: noGps ? null : shot.distanceYards,
          startLat: noGps ? null : shot.startLat,
          startLng: noGps ? null : shot.startLng,
          endLat: noGps ? null : shot.endLat,
          endLng: noGps ? null : shot.endLng,
          fixQuality: shot.fixQuality,
          source: shot.source,
          typedYards: shot.typedYards,
        });
      }
      for (const penalty of listPenaltiesForHole(db, hole.id)) {
        if (penalty.kind !== 'penalty') continue;
        const point = pointOrNull(penalty.lat, penalty.lng);
        shots.push({
          roundId: round.id,
          holeNumber: hole.number,
          shotNumber: null,
          club: null,
          distanceYards: null,
          startLat: point?.lat ?? null,
          startLng: point?.lng ?? null,
          endLat: null,
          endLng: null,
          fixQuality: null,
          source: 'penalty',
          typedYards: null,
        });
      }
    }
    return {
      id: round.id,
      startedAt: round.startedAt,
      courseId: round.courseApiId,
      courseName: round.courseName,
      city: round.courseCity,
      state: round.courseState,
      holesPlayed: round.holeCount,
      courseDataSource: round.courseDataSource,
      test: round.isTest,
      holes: holes.map((hole) => ({
        number: hole.number,
        par: hole.par,
        score: hole.score,
        putts: enteredPutts(hole),
      })),
    };
  });
  return { roundsCsv: buildRoundsCsv(csvRounds), shotsCsv: buildShotsCsv(shots) };
}

export function finishRound(db: SQLiteDatabase, id: string): void {
  db.runSync('UPDATE rounds SET finished_at = ? WHERE id = ?', [new Date().toISOString(), id]);
}

export function deleteRound(db: SQLiteDatabase, id: string): void {
  db.withTransactionSync(() => deleteRoundRows(db, id));
}

/** Caller owns the transaction. */
function deleteRoundRows(db: SQLiteDatabase, id: string): void {
  const holes = db.getAllSync<{ id: string }>('SELECT id FROM holes WHERE round_id = ?', [id]);
  for (const hole of holes) {
    db.runSync('DELETE FROM shots WHERE hole_id = ?', [hole.id]);
    db.runSync('DELETE FROM hole_penalties WHERE hole_id = ?', [hole.id]);
  }
  db.runSync('DELETE FROM holes WHERE round_id = ?', [id]);
  db.runSync('DELETE FROM rounds WHERE id = ?', [id]);
}

export function setRoundLastClub(db: SQLiteDatabase, roundId: string, clubId: string | null): void {
  db.runSync('UPDATE rounds SET last_club_id = ? WHERE id = ?', [clubId, roundId]);
}

export function getRoundShareToken(db: SQLiteDatabase, roundId: string): string | null {
  const row = db.getFirstSync<{ share_token: string | null }>(
    'SELECT share_token FROM rounds WHERE id = ?',
    [roundId],
  );
  const token = row?.share_token?.trim();
  return token ? token : null;
}

/** ISO time of the first Share tap for this round. Null means never shared. */
export function getRoundSharedAt(db: SQLiteDatabase, roundId: string): string | null {
  const row = db.getFirstSync<{ shared_at: string | null }>(
    'SELECT shared_at FROM rounds WHERE id = ?',
    [roundId],
  );
  const value = row?.shared_at?.trim();
  return value ? value : null;
}

export function isRoundShared(db: SQLiteDatabase, roundId: string): boolean {
  return getRoundSharedAt(db, roundId) != null;
}

/** First explicit Share tap. A later tap keeps the original time. */
export function markRoundShared(db: SQLiteDatabase, roundId: string, at?: string): void {
  db.runSync('UPDATE rounds SET shared_at = ? WHERE id = ? AND shared_at IS NULL', [
    at ?? new Date().toISOString(),
    roundId,
  ]);
}

/** Same token for live + finished so the share link stays up after the round. */
export function ensureRoundShareToken(db: SQLiteDatabase, roundId: string): string {
  const existing = getRoundShareToken(db, roundId);
  if (existing) return existing;
  let token = newShareBoardCode();
  for (let i = 0; i < 8; i += 1) {
    const taken = db.getFirstSync<{ id: string }>('SELECT id FROM rounds WHERE share_token = ?', [token]);
    if (!taken) break;
    token = newShareBoardCode();
  }
  db.runSync('UPDATE rounds SET share_token = ? WHERE id = ?', [token, roundId]);
  return token;
}

export function putShareBoard(db: SQLiteDatabase, payload: SpectatorPayload): void {
  const token = normalizeShareBoardCode(payload.token);
  if (!token) return;
  db.runSync(
    'INSERT INTO share_boards (token, payload_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(token) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at',
    [token, JSON.stringify(payload), new Date().toISOString()],
  );
}

export function getShareBoard(db: SQLiteDatabase, token: string): SpectatorPayload | null {
  const key = normalizeShareBoardCode(token);
  if (!key) return null;
  const row = db.getFirstSync<{ payload_json: string }>(
    'SELECT payload_json FROM share_boards WHERE token = ?',
    [key],
  );
  if (!row?.payload_json) return null;
  try {
    return parseSpectatorPayload(JSON.parse(row.payload_json) as unknown);
  } catch {
    return null;
  }
}

/** Every saved shot with its hole's green pin, shaped for `planDispersion`. Never live GPS. */
export function listDispersionShots(db: SQLiteDatabase): DispersionShotIn[] {
  const out: DispersionShotIn[] = [];
  for (const round of listStatRounds(db)) {
    for (const hole of listHoles(db, round.id)) {
      const green =
        hole.greenLat != null && hole.greenLng != null ? { lat: hole.greenLat, lng: hole.greenLng } : null;
      for (const shot of listShotsForHole(db, hole.id)) {
        out.push({
          shotId: shot.id,
          clubId: shot.clubId,
          source: shot.source,
          fixQuality: shot.fixQuality,
          distanceYards: shot.distanceYards,
          impossibleJump: shot.impossibleJump,
          start: shot.startLat != null && shot.startLng != null ? { lat: shot.startLat, lng: shot.startLng } : null,
          end: shot.endLat != null && shot.endLng != null ? { lat: shot.endLat, lng: shot.endLng } : null,
          green,
          playedAt: round.finishedAt ?? round.startedAt,
          courseName: round.courseName,
          holeNumber: hole.number,
        });
      }
    }
  }
  return out;
}

/** Saved rounds shaped for `planHandicap`. Holes and tee only — never shots or GPS. */
export function listHandicapRounds(db: SQLiteDatabase): HandicapRoundIn[] {
  return listStatRounds(db).map((round) => ({
    id: round.id,
    courseName: round.courseName,
    startedAt: round.startedAt,
    finishedAt: round.finishedAt,
    holeCount: round.holeCount,
    teeRating: round.teeRating,
    teeSlope: round.teeSlope,
    holes: listHoles(db, round.id).map((hole) => ({
      number: hole.number,
      par: hole.par,
      score: hole.score,
      strokeIndex: hole.handicap,
    })),
  }));
}

export function listHoles(db: SQLiteDatabase, roundId: string): Hole[] {
  return db
    .getAllSync<HoleRow>('SELECT * FROM holes WHERE round_id = ? ORDER BY number ASC', [roundId])
    .map(mapHole);
}

export function getHole(db: SQLiteDatabase, roundId: string, number: number): Hole | null {
  const row = db.getFirstSync<HoleRow>(
    'SELECT * FROM holes WHERE round_id = ? AND number = ?',
    [roundId, number],
  );
  return row ? mapHole(row) : null;
}

/** Persist a course / OSM tee. Never writes the phone. Skips if already stored. */
export function saveHoleTee(
  db: SQLiteDatabase,
  holeId: string,
  tee: { lat: number; lng: number } | null,
): void {
  if (!holeId || !isValidLatLng(tee)) return;
  const row = db.getFirstSync<{ tee_lat: number | null; tee_lng: number | null }>(
    'SELECT tee_lat, tee_lng FROM holes WHERE id = ?',
    [holeId],
  );
  if (row && isValidLatLng({ lat: row.tee_lat ?? Number.NaN, lng: row.tee_lng ?? Number.NaN })) {
    return;
  }
  db.runSync('UPDATE holes SET tee_lat = ?, tee_lng = ? WHERE id = ?', [tee.lat, tee.lng, holeId]);
}

export function updateHolePar(db: SQLiteDatabase, holeId: string, par: number | null): void {
  db.runSync('UPDATE holes SET par = ?, par_source = ? WHERE id = ?', [
    par,
    par == null ? null : 'user',
    holeId,
  ]);
}

/**
 * Live follow: stamp a hole's start only when the player moves onto it after
 * every earlier hole is finished. Looking ahead never stamps. Never restamps.
 */
export function markHoleStarted(db: SQLiteDatabase, roundId: string, number: number): void {
  const round = getRound(db, roundId);
  if (!round || round.finishedAt != null) return;
  const holes = listHoles(db, roundId);
  const planned = planHoleStartStamp(
    holes.map((hole) => ({
      number: hole.number,
      score: hole.score,
      puttsDone: hole.puttsDone,
      startedAt: hole.startedAt,
      completedAt: hole.completedAt,
    })),
    number,
  );
  if (!planned) return;
  db.runSync('UPDATE holes SET started_at = ? WHERE round_id = ? AND number = ? AND started_at IS NULL', [
    new Date().toISOString(),
    roundId,
    number,
  ]);
}

/** Live follow: first Made it / Hole Out time. Re-finishing keeps the first stamp. */
function stampHoleCompleted(db: SQLiteDatabase, holeId: string): void {
  db.runSync('UPDATE holes SET completed_at = COALESCE(completed_at, ?) WHERE id = ?', [
    new Date().toISOString(),
    holeId,
  ]);
}

/** One-tap fairway result. Null clears it. Stats only — never a mark or GPS write. */
export function updateHoleFairway(db: SQLiteDatabase, holeId: string, fairway: FairwayResult | null): void {
  db.runSync('UPDATE holes SET fairway = ? WHERE id = ?', [parseFairwayResult(fairway), holeId]);
}

export function updateHoleScore(db: SQLiteDatabase, holeId: string, score: number | null): void {
  db.runSync('UPDATE holes SET score = ? WHERE id = ?', [score, holeId]);
}

/** Made it / Hole Out: persist total strokes (marks + putts + penalties), never putts-only. */
function persistCloseHoleScore(db: SQLiteDatabase, holeId: string, putts: number): void {
  const planned = planFinishHoleScore({
    shotCount: listShotsForHole(db, holeId).length,
    putts,
    penaltyStrokes: totalPenaltyStrokes(listPenaltiesForHole(db, holeId)),
  });
  if (!planned.ok) return;
  updateHoleScore(db, holeId, planned.score);
}

/** Delete/edit on a finished hole — restamp posted score from remaining marks + putts. */
function persistRecomputedHoleScore(db: SQLiteDatabase, holeId: string): void {
  const row = db.getFirstSync<{ putts: number | null; putts_done: number | null }>(
    'SELECT putts, putts_done FROM holes WHERE id = ?',
    [holeId],
  );
  if (!row || (row.putts_done ?? 0) !== 1) return;
  const planned = planRecomputeFinishedHoleScore({
    puttsDone: true,
    shotCount: listShotsForHole(db, holeId).length,
    putts: clampPutts(row.putts ?? 0),
    penaltyStrokes: totalPenaltyStrokes(listPenaltiesForHole(db, holeId)),
  });
  if (!planned.write) return;
  updateHoleScore(db, holeId, planned.score);
}

export function updateHolePutts(
  db: SQLiteDatabase,
  holeId: string,
  putts: number,
  lengths: PuttLengthId[],
  puttsDone = false,
): void {
  const next = clampPutts(putts);
  db.runSync('UPDATE holes SET putts = ?, putt_lengths = ?, putts_done = ? WHERE id = ?', [
    next,
    serializePuttLengths(lengths.slice(0, next)),
    puttsDone ? 1 : 0,
    holeId,
  ]);
  if (puttsDone) persistRecomputedHoleScore(db, holeId);
}

/** Made it: persist user-chosen buckets and mark putts entered. Walking off the green never calls this. */
export function finishHolePutts(
  db: SQLiteDatabase,
  holeId: string,
  putts: number,
  lengths: PuttLengthId[],
): void {
  // applyMadeIt already closed via planMadeIt. Persist that count — a second
  // sheet close would turn a one-putt with a bucket into two putts.
  const planned = planPersistMadeIt({ putts, lengths });
  if (!planned.ok) return;
  updateHolePutts(db, holeId, planned.putts, planned.lengths, true);
  persistCloseHoleScore(db, holeId, planned.putts);
  stampHoleCompleted(db, holeId);
}

/** Off-green hole-out. Current club is the shot. No fake putt yards. GIR stays unset. */
export function finishHoleOut(db: SQLiteDatabase, holeId: string): void {
  const planned = planFinishHoleOut();
  updateHolePutts(db, holeId, planned.putts, planned.lengths, true);
  persistCloseHoleScore(db, holeId, planned.putts);
  stampHoleCompleted(db, holeId);
  const flag = planFlagLastRealShot(
    db.getAllSync<{ id: string; seq: number }>(
      'SELECT id, seq FROM shots WHERE hole_id = ? ORDER BY seq ASC',
      [holeId],
    ),
  );
  if (!flag.shotId) return;
  db.runSync('UPDATE shots SET hole_out = 0 WHERE hole_id = ?', [holeId]);
  db.runSync('UPDATE shots SET hole_out = 1 WHERE id = ?', [flag.shotId]);
}

/** Close an open GPS shot without an end pin — never invents coordinates. */
export function sealOpenShotWithoutGps(db: SQLiteDatabase, shotId: string): void {
  db.runSync('UPDATE shots SET ended_at = COALESCE(ended_at, ?) WHERE id = ?', [
    new Date().toISOString(),
    shotId,
  ]);
}

/**
 * Hole Out: seal the open club-pick shot from its stored start to a pin this
 * hole already has. Caller pin wins (the green the play map already uses);
 * otherwise the hole's stored green. Does not insert a shot, change the club,
 * or read a new GPS fix. No pin → false, and the start is left alone.
 */
export function closeOpenShotToExistingPin(
  db: SQLiteDatabase,
  holeId: string,
  pin?: { lat: number; lng: number } | null,
): boolean {
  const open = getOpenShotForHole(db, holeId);
  if (!open) return false;
  const stored = db.getFirstSync<{ green_lat: number | null; green_lng: number | null }>(
    'SELECT green_lat, green_lng FROM holes WHERE id = ?',
    [holeId],
  );
  const storedPin =
    stored?.green_lat != null && stored.green_lng != null
      ? { lat: stored.green_lat, lng: stored.green_lng }
      : null;
  const target = isValidLatLng(pin) ? pin : isValidLatLng(storedPin) ? storedPin : null;
  const planned = planHoleOutCloseToPin({
    shotId: open.id,
    start: { lat: open.startLat, lng: open.startLng },
    startFixQuality: open.startFixQuality,
    pin: target,
  });
  if (!planned) return false;
  db.runSync(
    `UPDATE shots SET
      end_lat = ?, end_lng = ?, end_accuracy_m = NULL, end_fix_quality = ?,
      distance_yards = ?, fix_quality = ?, impossible_jump = 0, ended_at = ?
     WHERE id = ? AND ended_at IS NULL`,
    [
      planned.endLat,
      planned.endLng,
      planned.endFixQuality,
      planned.distanceYards,
      planned.fixQuality,
      new Date().toISOString(),
      planned.shotId,
    ],
  );
  return true;
}

/**
 * After-the-fact putt length on a finished hole. Writes putt_lengths only.
 * Does not reopen, change putt count, rewrite score, or invent GPS / yards.
 */
export function attachHolePuttLength(
  db: SQLiteDatabase,
  holeId: string,
  index: number,
  id: PuttLengthId,
): boolean {
  const row = db.getFirstSync<HoleRow>('SELECT * FROM holes WHERE id = ?', [holeId]);
  if (!row) return false;
  const putts = clampPutts(row.putts ?? 0);
  const planned = planAttachPuttLength(
    {
      puttsDone: (row.putts_done ?? 0) === 1,
      putts,
      lengths: parsePuttLengthSlots(row.putt_lengths, putts),
    },
    index,
    id,
  );
  if (!planned.ok) return false;
  db.runSync('UPDATE holes SET putt_lengths = ? WHERE id = ?', [
    serializePuttLengthSlots(planned.slots),
    holeId,
  ]);
  return true;
}

/** Player lie tap. Null clears the tap so auto lie reads again. */
export function setShotLie(db: SQLiteDatabase, shotId: string, lie: ShotLie | null): void {
  db.runSync('UPDATE shots SET lie = ?, lie_source = ? WHERE id = ?', [lie, lie ? 'player' : null, shotId]);
}

/**
 * Auto lie from mapped outlines for these holes' shots. Pass only holes the
 * outlines cover. Returns rows written. A `player` lie is never overwritten,
 * and a second call with the same outlines writes nothing.
 */
export function fillAutoShotLies(
  db: SQLiteDatabase,
  holeIds: readonly string[],
  features: readonly OsmFeature[] | null | undefined,
): number {
  if (!features || features.length === 0) return 0;
  let written = 0;
  for (const holeId of holeIds) {
    for (const write of planAutoShotLies(listShotsForHole(db, holeId), features)) {
      db.runSync('UPDATE shots SET lie = ?, lie_source = ? WHERE id = ?', [
        write.lie,
        write.lie ? 'auto' : null,
        write.id,
      ]);
      written += 1;
    }
  }
  return written;
}

/** Green pin from current GPS, a map long-press, or a course centroid. Never invented. */
export function setHoleGreen(
  db: SQLiteDatabase,
  holeId: string,
  green: { lat: number; lng: number; source?: GreenSource } | null,
): void {
  const valid = isValidLatLng(green) ? green : null;
  db.runSync('UPDATE holes SET green_lat = ?, green_lng = ?, green_source = ? WHERE id = ?', [
    valid?.lat ?? null,
    valid?.lng ?? null,
    valid ? (green?.source ?? 'user_estimate') : null,
    holeId,
  ]);
}

function strokesGainedHole(
  hole: Hole,
  shots: readonly Shot[],
  penalties: readonly HolePenalty[],
): SgHoleIn {
  return {
    number: hole.number,
    par: hole.par,
    score: hole.score,
    yards: hole.yards,
    greenLat: hole.greenLat,
    greenLng: hole.greenLng,
    putts: hole.putts,
    puttLengths: hole.puttLengths,
    puttsDone: hole.puttsDone,
    shots,
    penalties,
  };
}

function groupByHole<T extends { holeId: string }>(rows: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const list = grouped.get(row.holeId);
    if (list) list.push(row);
    else grouped.set(row.holeId, [row]);
  }
  return grouped;
}

/** One round's holes, shots, and penalties in the shape strokes gained reads. */
export function listStrokesGainedHoles(db: SQLiteDatabase, roundId: string): SgHoleIn[] {
  return listHoles(db, roundId).map((hole) =>
    strokesGainedHole(hole, listShotsForHole(db, hole.id), listPenaltiesForHole(db, hole.id)),
  );
}

/**
 * Same rows as `listStrokesGainedHoles`. Shots and penalties are each one join
 * for the round, instead of a query per hole.
 */
export function listStrokesGainedHolesBatched(db: SQLiteDatabase, roundId: string): SgHoleIn[] {
  const holes = listHoles(db, roundId);
  if (holes.length === 0) return [];
  const shots = db
    .getAllSync<ShotRow>(
      `SELECT shots.* FROM shots
       INNER JOIN holes ON holes.id = shots.hole_id
       WHERE holes.round_id = ?
       ORDER BY holes.number ASC, shots.seq ASC`,
      [roundId],
    )
    .map(mapShot);
  const penalties = db
    .getAllSync<PenaltyRow>(
      `SELECT hole_penalties.* FROM hole_penalties
       INNER JOIN holes ON holes.id = hole_penalties.hole_id
       WHERE holes.round_id = ?
       ORDER BY holes.number ASC, hole_penalties.created_at ASC`,
      [roundId],
    )
    .map(mapPenalty);
  const shotsByHole = groupByHole(shots);
  const penaltiesByHole = groupByHole(penalties);
  return holes.map((hole) =>
    strokesGainedHole(hole, shotsByHole.get(hole.id) ?? [], penaltiesByHole.get(hole.id) ?? []),
  );
}

export function listShotsForHole(db: SQLiteDatabase, holeId: string): Shot[] {
  return db
    .getAllSync<ShotRow>('SELECT * FROM shots WHERE hole_id = ? ORDER BY seq ASC', [holeId])
    .map(mapShot);
}

export function getShot(db: SQLiteDatabase, shotId: string): Shot | null {
  const row = db.getFirstSync<ShotRow>('SELECT * FROM shots WHERE id = ?', [shotId]);
  return row ? mapShot(row) : null;
}

export function getOpenShotForHole(db: SQLiteDatabase, holeId: string): OpenShot | null {
  const row = db.getFirstSync<ShotRow>(
    `SELECT * FROM shots
     WHERE hole_id = ?
       AND ended_at IS NULL
       AND IFNULL(source, 'gps') IN ('gps', 'placed')
       AND start_lat IS NOT NULL
       AND start_lng IS NOT NULL
     ORDER BY seq DESC LIMIT 1`,
    [holeId],
  );
  if (!row || row.start_lat == null || row.start_lng == null) return null;
  const source = mapSource(row.source);
  return {
    id: row.id,
    startLat: row.start_lat,
    startLng: row.start_lng,
    startFixQuality: source === 'placed' ? null : (row.start_fix_quality as FixQuality) ?? 'good',
  };
}

export function nextShotSeq(db: SQLiteDatabase, holeId: string): number {
  const row = db.getFirstSync<{ n: number }>(
    'SELECT COALESCE(MAX(seq), 0) AS n FROM shots WHERE hole_id = ?',
    [holeId],
  );
  return (row?.n ?? 0) + 1;
}

export function insertOpenShot(
  db: SQLiteDatabase,
  args: {
    holeId: string;
    clubId: string | null;
    seq: number;
    lat: number;
    lng: number;
    accuracyM: number | null;
    startFixQuality: FixQuality | null;
    source?: ShotSource;
    suggested?: boolean;
  },
): string {
  const id = newId();
  const source = args.source ?? 'gps';
  db.runSync(
    `INSERT INTO shots (
      id, hole_id, club_id, seq,
      start_lat, start_lng, start_accuracy_m, start_fix_quality,
      distance_yards, fix_quality, impossible_jump, started_at, source, suggested
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, ?, ?)`,
    [
      id,
      args.holeId,
      args.clubId,
      args.seq,
      args.lat,
      args.lng,
      args.accuracyM,
      args.startFixQuality,
      args.startFixQuality,
      new Date().toISOString(),
      source,
      args.suggested ? 1 : 0,
    ],
  );
  persistRecomputedHoleScore(db, args.holeId);
  return id;
}

/** Change club only. GPS start/end and distance_yards stay; suggested badge clears.
 * Club averages follow `club_id` on the next listClubAverages() read.
 */
export function updateShotClub(db: SQLiteDatabase, shotId: string, clubId: string): void {
  db.runSync('UPDATE shots SET club_id = ?, suggested = 0 WHERE id = ?', [clubId, shotId]);
}

/** Move from/to pins: store as Placed, haversine yards, no GPS quality. Never acceptFix. */
export function applyShotPlacement(
  db: SQLiteDatabase,
  shotId: string,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): boolean {
  const plan = planPlacedShot(from, to);
  if (!plan.ok) return false;
  const now = new Date().toISOString();
  db.runSync(
    `UPDATE shots SET
      start_lat = ?, start_lng = ?, start_accuracy_m = NULL, start_fix_quality = NULL,
      end_lat = ?, end_lng = ?, end_accuracy_m = NULL, end_fix_quality = NULL,
      distance_yards = ?, typed_yards = NULL, fix_quality = NULL,
      impossible_jump = ?, ended_at = COALESCE(ended_at, ?), source = ?, suggested = 0
     WHERE id = ?`,
    [
      plan.startLat,
      plan.startLng,
      plan.endLat,
      plan.endLng,
      plan.distanceYards,
      plan.impossibleJump ? 1 : 0,
      now,
      plan.source,
      shotId,
    ],
  );
  return true;
}

/** Restore a shot after a wrong edit. Writes the snapshot back — never invents GPS. */
export function restoreShotSnapshot(db: SQLiteDatabase, snap: ShotEditSnapshot): void {
  db.runSync(
    `UPDATE shots SET
      club_id = ?,
      start_lat = ?, start_lng = ?, start_accuracy_m = ?, start_fix_quality = ?,
      end_lat = ?, end_lng = ?, end_accuracy_m = ?, end_fix_quality = ?,
      distance_yards = ?, typed_yards = ?, fix_quality = ?,
      impossible_jump = ?, ended_at = ?, source = ?, suggested = ?
     WHERE id = ?`,
    [
      snap.clubId,
      snap.startLat,
      snap.startLng,
      snap.startAccuracyM,
      snap.startFixQuality,
      snap.endLat,
      snap.endLng,
      snap.endAccuracyM,
      snap.endFixQuality,
      snap.distanceYards,
      snap.typedYards,
      snap.fixQuality,
      snap.impossibleJump ? 1 : 0,
      snap.endedAt,
      snap.source,
      snap.suggested ? 1 : 0,
      snap.id,
    ],
  );
}

function writeShotSpot(db: SQLiteDatabase, shot: Shot): void {
  db.runSync(
    `UPDATE shots SET
      start_lat = ?, start_lng = ?, start_accuracy_m = ?, start_fix_quality = ?,
      end_lat = ?, end_lng = ?, end_accuracy_m = ?, end_fix_quality = ?,
      distance_yards = ?, typed_yards = ?, fix_quality = ?,
      impossible_jump = ?, source = ?, suggested = ?
     WHERE id = ?`,
    [
      shot.startLat,
      shot.startLng,
      shot.startAccuracyM,
      shot.startFixQuality,
      shot.endLat,
      shot.endLng,
      shot.endAccuracyM,
      shot.endFixQuality,
      shot.distanceYards,
      shot.typedYards,
      shot.fixQuality,
      shot.impossibleJump ? 1 : 0,
      shot.source,
      shot.suggested ? 1 : 0,
      shot.id,
    ],
  );
}

/**
 * Move one shot's spot to the dropped pin and recompute yardages from the
 * stored rows. Does not renumber, reopen a neighbor, or touch putts, score,
 * or penalty order. Cancel and a pin that was never dropped write nothing.
 */
export function moveShotSpotOnHole(
  db: SQLiteDatabase,
  args: {
    roundId: string;
    holeNumber: number;
    shotId: string;
    point: { lat: number; lng: number } | null;
    dropped: boolean;
    confirmed: boolean;
  },
): { status: 'cancel' } | { status: 'missing' } | { status: 'rejected' } | { status: 'commit' } {
  const hole = getHole(db, args.roundId, args.holeNumber);
  if (!hole) return args.confirmed && args.dropped ? { status: 'missing' } : { status: 'cancel' };
  const shots = listShotsForHole(db, hole.id);
  const planned = applyMoveShotSpot({
    shots,
    shotId: args.shotId,
    point: args.point,
    dropped: args.dropped,
    confirmed: args.confirmed,
  });
  if (planned.status !== 'commit') {
    if (planned.status === 'cancel') return { status: 'cancel' };
    return planned.status === 'missing' ? { status: 'missing' } : { status: 'rejected' };
  }
  const before = new Map(shots.map((shot) => [shot.id, shot]));
  db.withTransactionSync(() => {
    for (const shot of planned.shots) {
      const prev = before.get(shot.id);
      if (!prev) continue;
      if (
        prev.startLat === shot.startLat &&
        prev.startLng === shot.startLng &&
        prev.endLat === shot.endLat &&
        prev.endLng === shot.endLng &&
        prev.distanceYards === shot.distanceYards &&
        prev.source === shot.source &&
        prev.fixQuality === shot.fixQuality &&
        prev.startFixQuality === shot.startFixQuality &&
        prev.endFixQuality === shot.endFixQuality &&
        prev.startAccuracyM === shot.startAccuracyM &&
        prev.endAccuracyM === shot.endAccuracyM &&
        prev.impossibleJump === shot.impossibleJump &&
        prev.typedYards === shot.typedYards &&
        prev.suggested === shot.suggested
      ) {
        continue;
      }
      writeShotSpot(db, shot);
    }
  });
  return { status: 'commit' };
}

export function reopenShot(db: SQLiteDatabase, shotId: string): void {
  db.runSync(
    `UPDATE shots SET
      end_lat = NULL, end_lng = NULL, end_accuracy_m = NULL, end_fix_quality = NULL,
      distance_yards = NULL, impossible_jump = 0, ended_at = NULL,
      fix_quality = start_fix_quality
     WHERE id = ?`,
    [shotId],
  );
}

export function deleteShot(db: SQLiteDatabase, shotId: string): void {
  db.runSync('DELETE FROM shots WHERE id = ?', [shotId]);
}

/**
 * Delete any shot on the hole (live or Placed). Neighbors keep pins.
 * Yards rewrite only when that shot's own distance actually changed.
 * Does not reopen a neighbor. Averages recompute on the next listClubAverages().
 */
export function deleteShotOnHole(
  db: SQLiteDatabase,
  args: { roundId: string; holeNumber: number; shotId: string; confirmed: boolean },
): { status: 'cancel' } | { status: 'missing' } | { status: 'commit' } {
  if (!args.confirmed) return { status: 'cancel' };
  const hole = getHole(db, args.roundId, args.holeNumber);
  if (!hole) return { status: 'missing' };
  const plan = planDeleteShot(listShotsForHole(db, hole.id), args.shotId);
  if (!plan.ok) return { status: 'missing' };
  db.withTransactionSync(() => {
    deleteShot(db, plan.deleteShotId);
    for (const row of plan.renumber) {
      db.runSync('UPDATE shots SET seq = ? WHERE id = ?', [row.seq, row.id]);
    }
    for (const row of plan.yardsUpdates) {
      db.runSync('UPDATE shots SET distance_yards = ? WHERE id = ?', [row.distanceYards, row.id]);
    }
    setRoundLastClub(db, args.roundId, plan.nextLastClubId);
    persistRecomputedHoleScore(db, hole.id);
  });
  return { status: 'commit' };
}

export function undoLastShot(
  db: SQLiteDatabase,
  roundId: string,
  holeNumber: number,
  /** Watch Undo: remove only while this is still the shot Undo would remove. */
  expectShotId?: string,
): { ok: true } | { ok: false; reason: 'empty' | 'changed' } {
  const hole = getHole(db, roundId, holeNumber);
  if (!hole) return { ok: false, reason: 'empty' };
  const plan = planUndoLastShot(listShotsForHole(db, hole.id));
  if (!plan) return { ok: false, reason: 'empty' };
  if (expectShotId != null && plan.deleteShotId !== expectShotId) return { ok: false, reason: 'changed' };
  db.withTransactionSync(() => {
    deleteShot(db, plan.deleteShotId);
    if (plan.reopenShotId) {
      reopenShot(db, plan.reopenShotId);
    }
    setRoundLastClub(db, roundId, plan.nextLastClubId);
    persistRecomputedHoleScore(db, hole.id);
  });
  return { ok: true };
}

export function applyClosedShot(
  db: SQLiteDatabase,
  close: {
    shotId: string;
    endLat: number;
    endLng: number;
    endAccuracyM: number | null;
    endFixQuality: FixQuality;
    distanceYards: number;
    impossibleJump: boolean;
    fixQuality: FixQuality;
  },
): void {
  db.runSync(
    `UPDATE shots SET
      end_lat = ?, end_lng = ?, end_accuracy_m = ?, end_fix_quality = ?,
      distance_yards = ?, fix_quality = ?, impossible_jump = ?, ended_at = ?
     WHERE id = ?`,
    [
      close.endLat,
      close.endLng,
      close.endAccuracyM,
      close.endFixQuality,
      close.distanceYards,
      close.fixQuality,
      close.impossibleJump ? 1 : 0,
      new Date().toISOString(),
      close.shotId,
    ],
  );
}

/**
 * Remove only the most recent Soft GPS club mark on this hole.
 * Newest row reuses undo-last (delete + reopen the shot that tap closed).
 * An earlier soft mark reuses delete-one (renumber, no neighbor reopen).
 * Does not start a round and does not clear the rest of the hole.
 */
export function undoLastSoftGpsClubMark(
  db: SQLiteDatabase,
  roundId: string,
  holeNumber: number,
): { ok: true } | { ok: false; reason: 'empty' } {
  const hole = getHole(db, roundId, holeNumber);
  if (!hole) return { ok: false, reason: 'empty' };
  const shots = listShotsForHole(db, hole.id);
  const plan = planUndoLastSoftGpsClubMark(shots);
  if (!plan) return { ok: false, reason: 'empty' };
  if (plan.keepShotIds.length !== shots.length - 1) return { ok: false, reason: 'empty' };
  if (plan.usesUndoLast) {
    db.withTransactionSync(() => {
      deleteShot(db, plan.deleteShotId);
      if (plan.reopenShotId) reopenShot(db, plan.reopenShotId);
      setRoundLastClub(db, roundId, plan.nextLastClubId);
      persistRecomputedHoleScore(db, hole.id);
    });
    return { ok: true };
  }
  const drop = planDeleteShot(shots, plan.deleteShotId);
  if (!drop.ok || drop.remaining.length !== plan.keepShotIds.length) {
    return { ok: false, reason: 'empty' };
  }
  db.withTransactionSync(() => {
    deleteShot(db, drop.deleteShotId);
    for (const row of drop.renumber) {
      db.runSync('UPDATE shots SET seq = ? WHERE id = ?', [row.seq, row.id]);
    }
    for (const row of drop.yardsUpdates) {
      db.runSync('UPDATE shots SET distance_yards = ? WHERE id = ?', [row.distanceYards, row.id]);
    }
    setRoundLastClub(db, roundId, drop.nextLastClubId);
    persistRecomputedHoleScore(db, hole.id);
  });
  return { ok: true };
}

/** Forgotten swing: not a GPS distance shot. Never calls acceptFix/haversine. */
export function insertNoGpsShot(
  db: SQLiteDatabase,
  args: { holeId: string; clubId: string; seq: number; typedYards?: number | null },
): string {
  const id = newId();
  const plan = planNoGpsShot(args.typedYards ?? null);
  const now = new Date().toISOString();
  db.runSync(
    `INSERT INTO shots (
      id, hole_id, club_id, seq,
      start_lat, start_lng, start_accuracy_m, start_fix_quality,
      end_lat, end_lng, end_accuracy_m, end_fix_quality,
      distance_yards, typed_yards, fix_quality, impossible_jump, started_at, ended_at, source
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [
      id,
      args.holeId,
      args.clubId,
      args.seq,
      plan.startLat,
      plan.startLng,
      plan.startFixQuality,
      plan.endLat,
      plan.endLng,
      plan.endFixQuality,
      plan.distanceYards,
      plan.typedYards,
      plan.fixQuality,
      now,
      now,
      plan.source,
    ],
  );
  persistRecomputedHoleScore(db, args.holeId);
  return id;
}

/** Catch-up Add shot: two player map points. Haversine yards immediately. Never acceptFix. */
export function insertPlacedShot(
  db: SQLiteDatabase,
  args: {
    holeId: string;
    clubId: string;
    seq: number;
    from: { lat: number; lng: number };
    to: { lat: number; lng: number };
  },
): string | null {
  const plan = planPlacedShot(args.from, args.to);
  if (!plan.ok) return null;
  const id = newId();
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  db.runSync(
    `INSERT INTO shots (
      id, hole_id, club_id, seq,
      start_lat, start_lng, start_accuracy_m, start_fix_quality,
      end_lat, end_lng, end_accuracy_m, end_fix_quality,
      distance_yards, typed_yards, fix_quality, impossible_jump, started_at, ended_at, source,
      average_eligible_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, NULL, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
    [
      id,
      args.holeId,
      args.clubId,
      args.seq,
      plan.startLat,
      plan.startLng,
      plan.endLat,
      plan.endLng,
      plan.distanceYards,
      plan.impossibleJump ? 1 : 0,
      now,
      now,
      plan.source,
      confirmUndoAverageEligibleAt(nowMs),
    ],
  );
  persistRecomputedHoleScore(db, args.holeId);
  return id;
}

/** Insert or append a Placed shot at `seq`. Renumbers later shots. Neighbors keep pins. */
export function insertPlacedShotAtSeq(
  db: SQLiteDatabase,
  args: {
    holeId: string;
    clubId: string;
    seq: number;
    from: { lat: number; lng: number };
    to: { lat: number; lng: number };
  },
): string | null {
  const shots = listShotsForHole(db, args.holeId);
  const planned = planInsertPlacedShot({
    shots,
    seq: args.seq,
    from: args.from,
    to: args.to,
    clubId: args.clubId,
  });
  if (!planned.ok) return null;
  let id: string | null = null;
  db.withTransactionSync(() => {
    for (const row of planned.renumber) {
      db.runSync('UPDATE shots SET seq = ? WHERE id = ?', [row.seq, row.id]);
    }
    id = insertPlacedShot(db, {
      holeId: args.holeId,
      clubId: args.clubId,
      seq: planned.seq,
      from: args.from,
      to: args.to,
    });
  });
  return id;
}

export function listPenaltiesForHole(db: SQLiteDatabase, holeId: string): HolePenalty[] {
  return db
    .getAllSync<PenaltyRow>(
      'SELECT * FROM hole_penalties WHERE hole_id = ? ORDER BY created_at ASC',
      [holeId],
    )
    .map(mapPenalty);
}

type InsertPenaltyArgs = {
  holeId: string;
  par: number | null;
  currentScore: number | null;
  strokes: number;
  reason: PenaltyReason;
  note: string | null;
  kind?: PenaltyKind;
  lat?: number | null;
  lng?: number | null;
  afterShotId?: string | null;
  afterShotSeq?: number | null;
  /**
   * Caller-supplied id. A second insert with the same id returns the existing
   * row and does not add another stroke. A deleted id is a tombstone: no row
   * and no stroke. Omit on the phone menu (a new id).
   */
  id?: string | null;
};

export type InsertPenaltyResult =
  | { replay: 'inserted' | 'existing'; penalty: HolePenalty; score: number }
  | { replay: 'deleted'; penalty: null; score: number | null };

function penaltyScoreOrStored(
  db: SQLiteDatabase,
  holeId: string,
  fallback: number,
): number {
  const hole = db.getFirstSync<{ score: number | null }>('SELECT score FROM holes WHERE id = ?', [holeId]);
  return typeof hole?.score === 'number' && Number.isFinite(hole.score) ? hole.score : fallback;
}

function storedHoleScore(db: SQLiteDatabase, holeId: string): number | null {
  const hole = db.getFirstSync<{ score: number | null }>('SELECT score FROM holes WHERE id = ?', [holeId]);
  return typeof hole?.score === 'number' && Number.isFinite(hole.score) ? hole.score : null;
}

/**
 * Writes the penalty row and hole score. Caller owns the transaction.
 * Do not call insertPenalty from inside withTransactionSync — that helper
 * opens its own BEGIN, and expo-sqlite cannot nest those.
 * The same id is one stroke: a retry returns the row already stored, including
 * a reason the phone edited later. A deleted id is already handled.
 */
export function insertPenaltyInTransaction(
  db: SQLiteDatabase,
  args: InsertPenaltyArgs,
): InsertPenaltyResult {
  const requestedId = textOrNull(args.id);
  if (requestedId) {
    const existing = db.getFirstSync<PenaltyRow>('SELECT * FROM hole_penalties WHERE id = ?', [requestedId]);
    if (existing) {
      const penalty = mapPenalty(existing);
      return {
        replay: 'existing',
        penalty,
        score: penaltyScoreOrStored(db, penalty.holeId, scoreAfterPenalty(args.currentScore, args.par, penalty.strokes)),
      };
    }
    const tombstone = db.getFirstSync<{ id: string }>(
      'SELECT id FROM deleted_penalty_ids WHERE id = ?',
      [requestedId],
    );
    if (tombstone) {
      return { replay: 'deleted', penalty: null, score: storedHoleScore(db, args.holeId) };
    }
  }
  const strokes = clampPenaltyStrokes(args.strokes);
  const score = scoreAfterPenalty(args.currentScore, args.par, strokes);
  const penalty: HolePenalty = {
    id: requestedId ?? newId(),
    holeId: args.holeId,
    strokes,
    reason: args.reason,
    note: args.note?.trim() || null,
    createdAt: new Date().toISOString(),
    kind: args.kind ?? 'penalty',
    lat: args.lat ?? null,
    lng: args.lng ?? null,
    afterShotId: textOrNull(args.afterShotId),
    afterShotSeq: integerOrNull(args.afterShotSeq),
  };
  db.runSync(
    'INSERT INTO hole_penalties (id, hole_id, strokes, reason, note, created_at, kind, lat, lng, after_shot_id, after_shot_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      penalty.id,
      penalty.holeId,
      penalty.strokes,
      penalty.reason,
      penalty.note,
      penalty.createdAt,
      penalty.kind,
      penalty.lat,
      penalty.lng,
      penalty.afterShotId,
      penalty.afterShotSeq,
    ],
  );
  db.runSync('UPDATE holes SET score = ? WHERE id = ?', [score, args.holeId]);
  return { replay: 'inserted', penalty, score };
}

/** Score-only event. Never calls acceptFix, haversine, or club-average inserts. */
export function insertPenalty(db: SQLiteDatabase, args: InsertPenaltyArgs): InsertPenaltyResult {
  let saved: InsertPenaltyResult | null = null;
  db.withTransactionSync(() => {
    saved = insertPenaltyInTransaction(db, args);
  });
  if (!saved) {
    throw new Error('Penalty was not saved.');
  }
  return saved;
}

/**
 * Reason and note only. Strokes, attachment, kind, and the posted score stay.
 * A blank note is stored as null. Other shows that note as the row label.
 */
export function updatePenaltyReason(
  db: SQLiteDatabase,
  args: { penaltyId: string; reason: PenaltyReason; note: string | null },
): { status: 'missing' } | { status: 'updated'; penalty: HolePenalty; score: number | null } {
  const row = db.getFirstSync<PenaltyRow>('SELECT * FROM hole_penalties WHERE id = ?', [args.penaltyId]);
  if (!row) return { status: 'missing' };
  const planned = planChangePenaltyReason({ reason: args.reason, note: args.note });
  if (!planned.ok) return { status: 'missing' };
  db.runSync('UPDATE hole_penalties SET reason = ?, note = ? WHERE id = ?', [
    planned.reason,
    planned.note,
    args.penaltyId,
  ]);
  const updated = db.getFirstSync<PenaltyRow>('SELECT * FROM hole_penalties WHERE id = ?', [args.penaltyId]);
  if (!updated) return { status: 'missing' };
  return { status: 'updated', penalty: mapPenalty(updated), score: storedHoleScore(db, row.hole_id) };
}

/**
 * Remove one penalty stroke and remember its id so a delayed Watch duplicate
 * cannot insert it again. Shots are not renumbered. Score drops by this row's
 * strokes, never below shots + putts + penalties still on the hole.
 * Do not call from inside withTransactionSync — this opens its own BEGIN.
 */
export function deletePenalty(
  db: SQLiteDatabase,
  penaltyId: string,
): { status: 'missing' } | { status: 'deleted'; score: number | null } {
  const row = db.getFirstSync<PenaltyRow>('SELECT * FROM hole_penalties WHERE id = ?', [penaltyId]);
  if (!row) return { status: 'missing' };
  const penalty = mapPenalty(row);
  const hole = db.getFirstSync<{ score: number | null; putts: number | null }>(
    'SELECT score, putts FROM holes WHERE id = ?',
    [penalty.holeId],
  );
  const shotCount =
    db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM shots WHERE hole_id = ?', [penalty.holeId])?.n ?? 0;
  const remaining = totalPenaltyStrokes(
    listPenaltiesForHole(db, penalty.holeId).filter((item) => item.id !== penalty.id),
  );
  const score = scoreAfterPenaltyRemoval({
    currentScore: hole?.score ?? null,
    removedStrokes: penalty.strokes,
    shotCount,
    puttCount: hole?.putts ?? 0,
    remainingPenaltyStrokes: remaining,
  });
  const deletedAt = new Date().toISOString();
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM hole_penalties WHERE id = ?', [penalty.id]);
    db.runSync('INSERT OR REPLACE INTO deleted_penalty_ids (id, deleted_at) VALUES (?, ?)', [
      penalty.id,
      deletedAt,
    ]);
    db.runSync('UPDATE holes SET score = ? WHERE id = ?', [score, penalty.holeId]);
  });
  return { status: 'deleted', score };
}

export type ClubAverageRow = ClubAverage & {
  club: Club;
  /** Pre-live seed (typed or carryFill). Kept for the outlier baseline / delete rollback. */
  typicalCarryYards: number | null;
  carrySource: CarrySource;
  /** carryFill estimate, only while the club has neither live nor typed yards. */
  estimatedCarryYards: number | null;
  /** THE bag number — bag row, Club data and Suggested all read this. */
  bag: BagCarry;
  /** Typed/estimated carry the real shots keep missing. Null when nothing to offer. */
  suggestion: BagCarrySuggestion | null;
};

export function listClubAverages(db: SQLiteDatabase): ClubAverageRow[] {
  const clubs = listClubs(db, false).filter((club) => !isPutterClubId(club.id));
  const filled = fillEstimatedCarries(clubs);
  const nowMs = Date.now();
  const shots = db.getAllSync<{
    id: string;
    club_id: string;
    distance_yards: number;
    fix_quality: string;
    source: string | null;
    average_eligible_at: string | null;
    start_lat: number | null;
    start_lng: number | null;
    green_front_lat: number | null;
    green_front_lng: number | null;
    green_lat: number | null;
    green_lng: number | null;
    green_back_lat: number | null;
    green_back_lng: number | null;
  }>(
    `SELECT shots.id, shots.club_id, shots.distance_yards, shots.fix_quality, shots.source,
            shots.average_eligible_at, shots.start_lat, shots.start_lng,
            holes.green_front_lat, holes.green_front_lng,
            holes.green_lat, holes.green_lng,
            holes.green_back_lat, holes.green_back_lng
     FROM shots
     LEFT JOIN holes ON holes.id = shots.hole_id
     LEFT JOIN rounds ON rounds.id = holes.round_id
     WHERE shots.distance_yards IS NOT NULL AND shots.club_id IS NOT NULL
       AND IFNULL(rounds.is_test, 0) = 0
       AND (
         (IFNULL(shots.source, 'gps') = 'gps' AND shots.fix_quality IN ('good', 'soft', 'forced'))
         OR IFNULL(shots.source, 'gps') = 'placed'
       )
     ORDER BY shots.started_at ASC`,
  );
  return clubs.map((club) => {
    const eligible = shots
      .filter(
        (s) =>
          s.club_id === club.id &&
          includeInDistanceAverages({
            source:
              s.source === 'no_gps' ? 'no_gps' : s.source === 'placed' ? 'placed' : 'gps',
            distanceYards: s.distance_yards,
            clubId: s.club_id,
            fixQuality:
              s.source === 'placed'
                ? null
                : s.fix_quality === 'none'
                  ? 'none'
                  : s.fix_quality === 'soft' || s.fix_quality === 'forced' || s.fix_quality === 'good'
                    ? s.fix_quality
                    : 'good',
          }) &&
          confirmUndoShotEntersAverage(s.average_eligible_at, nowMs),
      )
      .map((s) => {
        const quality: FixQuality | null =
          s.source === 'placed'
            ? null
            : s.fix_quality === 'soft' || s.fix_quality === 'forced' || s.fix_quality === 'good'
              ? s.fix_quality
              : null;
        return {
          id: s.id,
          yards: s.distance_yards,
          fixQuality: quality,
          startLat: s.start_lat,
          startLng: s.start_lng,
          greenFrontLat: s.green_front_lat,
          greenFrontLng: s.green_front_lng,
          greenLat: s.green_lat,
          greenLng: s.green_lng,
          greenBackLat: s.green_back_lat,
          greenBackLng: s.green_back_lng,
        };
      });
    const fill = filled.get(club.id);
    const seed = {
      typedCarryYards: fill?.source === 'typed' ? fill.yards : null,
      estimatedCarryYards: fill?.source === 'estimated' ? fill.yards : null,
    };
    const average = clubAverageFromShots(
      eligible.map((s) => ({ yards: s.yards, fixQuality: s.fixQuality })),
      seed,
    );
    const live = clubIsLive(average);
    const estimatedCarryYards = !live && fill?.source === 'estimated' ? fill.yards : null;
    return {
      club,
      typicalCarryYards: fill?.yards ?? null,
      carrySource: fill?.source ?? null,
      estimatedCarryYards,
      bag: resolveBagCarry({
        id: club.id,
        liveCount: average.count,
        liveAvgYards: average.avgYards,
        typedYards: seed.typedCarryYards,
        estimatedYards: estimatedCarryYards,
      }),
      ...average,
      suggestion: suggestBagCarry({
        clubId: club.id,
        shots: eligible,
        typedCarryYards: seed.typedCarryYards,
        estimatedCarryYards: seed.estimatedCarryYards,
      }),
    };
  });
}

export function getClubMap(db: SQLiteDatabase): Record<string, Club> {
  const map: Record<string, Club> = {};
  for (const club of listClubs(db)) {
    map[club.id] = club;
  }
  return map;
}

export const GOLFAPI_HYDRATE_SETTING_KEY = 'golfapi.hydrates';
export { COURSE_PAINT_CACHE_SETTING_KEY, COURSE_OSM_OVERLAY_SETTING_KEY };

export function getCourseOsmOverlay(db: SQLiteDatabase): string | null {
  return getSetting(db, COURSE_OSM_OVERLAY_SETTING_KEY);
}

export function setCourseOsmOverlay(db: SQLiteDatabase, json: string): void {
  setSetting(db, COURSE_OSM_OVERLAY_SETTING_KEY, json);
}

export function getCoursePaintCache(db: SQLiteDatabase): string | null {
  return getSetting(db, COURSE_PAINT_CACHE_SETTING_KEY);
}

export function setCoursePaintCache(db: SQLiteDatabase, json: string): void {
  setSetting(db, COURSE_PAINT_CACHE_SETTING_KEY, json);
}

export function getGolfApiHydrateCache(db: SQLiteDatabase): string | null {
  return getSetting(db, GOLFAPI_HYDRATE_SETTING_KEY);
}

export function setGolfApiHydrateCache(db: SQLiteDatabase, json: string): void {
  setSetting(db, GOLFAPI_HYDRATE_SETTING_KEY, json);
}

export function readSettingStore(db: SQLiteDatabase): {
  get(key: string): string | null;
  set(key: string, value: string): void;
} {
  return {
    get: (key) => getSetting(db, key),
    set: (key, value) => setSetting(db, key, value),
  };
}

export function getSetting(db: SQLiteDatabase, key: string): string | null {
  const row = db.getFirstSync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value ?? null;
}

export function setSetting(db: SQLiteDatabase, key: string, value: string): void {
  db.runSync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
}

/**
 * Drop a saved favorite, offline pack, paint-cache row, or Watch nearby cache
 * row for the yard test course. No-op while that course is switched on.
 * Never throws — a bad settings blob is left alone.
 */
export function purgeYardTestCourseSaved(db: SQLiteDatabase): void {
  if (yardTestCourseEnabled()) return;
  try {
    const store = readSettingStore(db);
    const favorites = parseFavorites(store.get(FAVORITES_SETTING_KEY));
    const keptFavorites = favorites.filter((favorite) => !isYardTestCourseId(favorite.id));
    if (keptFavorites.length !== favorites.length) {
      store.set(FAVORITES_SETTING_KEY, JSON.stringify(keptFavorites));
    }
    const packs = parseOfflinePacks(store.get(OFFLINE_PACKS_SETTING_KEY));
    const keptPacks = packs.filter((pack) => !isYardTestCourseId(pack.courseId));
    if (keptPacks.length !== packs.length) {
      store.set(OFFLINE_PACKS_SETTING_KEY, JSON.stringify(keptPacks));
    }
    const nearbyRaw = store.get(WATCH_HOME_LAST_NEARBY_KEY);
    const nearby = parseCachedNearby(nearbyRaw);
    const keptNearby = nearby.filter((row) => !isYardTestCourseId(row.id));
    if (keptNearby.length !== nearby.length) {
      store.set(WATCH_HOME_LAST_NEARBY_KEY, JSON.stringify(keptNearby));
    }
    forgetCoursePaintCacheForCourse(YARD_TEST_COURSE_ID);
    forgetCoursePaintCacheForCourse(YARD_TEST_COURSE_KEY);
    forgetCourseOsmOverlay(YARD_TEST_COURSE_ID);
    forgetCourseOsmOverlay(YARD_TEST_COURSE_KEY);
    dropCourseOverlayMemory(YARD_TEST_COURSE_ID);
    dropCourseOverlayMemory(YARD_TEST_COURSE_KEY);
  } catch {
    // Silent. A purge must not surface an error to the player.
  }
}

export function getBagCarrySuggestionDismissals(db: SQLiteDatabase): string | null {
  return getSetting(db, BAG_CARRY_SUGGESTION_DISMISS_KEY);
}

export function setBagCarrySuggestionDismissals(db: SQLiteDatabase, value: string): void {
  setSetting(db, BAG_CARRY_SUGGESTION_DISMISS_KEY, value);
}

export function getCourseDistanceUnit(db: SQLiteDatabase): CourseDistanceUnit {
  return parseCourseDistanceUnit(getSetting(db, COURSE_DISTANCE_SETTING_KEY));
}

export function setCourseDistanceUnit(db: SQLiteDatabase, unit: CourseDistanceUnit): void {
  setSetting(db, COURSE_DISTANCE_SETTING_KEY, unit);
}

export function getColorTheme(db: SQLiteDatabase): ColorThemeId {
  return parseColorThemeId(getSetting(db, COLOR_THEME_SETTING_KEY));
}

export function setColorTheme(db: SQLiteDatabase, theme: ColorThemeId): void {
  setSetting(db, COLOR_THEME_SETTING_KEY, parseColorThemeId(theme));
}

export function hasSeenBagCustomize(db: SQLiteDatabase): boolean {
  return !shouldPromptBagCustomize(getSetting(db, BAG_CUSTOMIZE_SETTING_KEY));
}

export function markBagCustomizeSeen(db: SQLiteDatabase): void {
  setSetting(db, BAG_CUSTOMIZE_SETTING_KEY, bagCustomizeSeenValue());
}

export function markBagCustomizeSkipped(db: SQLiteDatabase): void {
  setSetting(db, BAG_CUSTOMIZE_SETTING_KEY, bagCustomizeSkipValue());
}

export function hasSeenFirstLaunchTip(db: SQLiteDatabase): boolean {
  return isFirstLaunchTipSeen(getSetting(db, FIRST_LAUNCH_TIP_SETTING_KEY));
}

export function markFirstLaunchTipSeen(db: SQLiteDatabase): void {
  setSetting(db, FIRST_LAUNCH_TIP_SETTING_KEY, firstLaunchTipSeenValue());
}

export function getThunderbirdPinSheet(
  db: SQLiteDatabase,
  weekday: number = new Date().getDay(),
): ThunderbirdPinSheetId {
  return resolveThunderbirdPinSheet(getSetting(db, THUNDERBIRD_PIN_SHEET_SETTING_KEY), weekday);
}

export function setThunderbirdPinSheet(db: SQLiteDatabase, sheet: ThunderbirdPinSheetId): void {
  if (!isThunderbirdPinSheetId(sheet)) return;
  setSetting(db, THUNDERBIRD_PIN_SHEET_SETTING_KEY, sheet);
}
