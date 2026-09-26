import { isClubhousePin } from '../course/hydrate';
import { isYardTestCourseId } from '../course/yardTestCourse';
import { isPutterClubId, parseTypicalCarryYards } from './defaultBag';
import { haversineYards, roundYards } from './haversine';
import { isCourseCardLatLng, isValidLatLng, type LatLng } from './latLng';
import { normalizeCourseDataSource } from './courseDataSource';
import { SHOTTRAXX_BRAND } from './playerCopy';
import { parseFairwayResult, type FairwayResult } from './fairwayGir';
import { MAX_PENALTY_STROKES, MIN_PENALTY_STROKES } from './penalty';
import { parseShotLie, type ShotLie, type ShotLieSource } from './shotLie';
import type { PenaltyKind, ShotFixQuality, ShotSource } from './types';

/**
 * Round history leaves the phone as JSON through the share sheet and comes
 * back the same way. No account. Import keeps real shot marks only.
 * Tee and green stay null when they are missing. Clubhouse never fills them.
 * Club averages are not in the file — they recompute from the imported shots.
 */

export const ROUND_HISTORY_EXPORT_KIND = 'shottrax.round-history';
/**
 * v2 adds favorites and the bag. Penalties and drops are an optional `penalties`
 * array on each hole, so this stays v2. A missing field means the file does not
 * know the list (v1 and build 92). `[]` means the file says there are none.
 * Build 92's parser ignores unknown hole fields, so a newer file that includes
 * `penalties` still opens there.
 */
export const ROUND_HISTORY_EXPORT_VERSION = 2;

export function isRoundHistoryExportVersion(version: unknown): version is 1 | 2 {
  return version === 1 || version === ROUND_HISTORY_EXPORT_VERSION;
}

export function roundTransferNeedsAccount(): false {
  return false;
}

export function roundImportInventsCoords(): false {
  return false;
}

export function roundImportFillsTeeGreenFromClubhouse(): false {
  return false;
}

export function roundImportAveragesFromShotsOnly(): true {
  return true;
}

export function roundImportWritesStoredAverages(): false {
  return false;
}

export type RoundTransferShot = {
  clubId: string | null;
  seq: number;
  start: LatLng;
  end: LatLng;
  startAccuracyM: number | null;
  endAccuracyM: number | null;
  startFixQuality: ShotFixQuality | null;
  endFixQuality: ShotFixQuality | null;
  distanceYards: number;
  typedYards: number | null;
  fixQuality: ShotFixQuality | null;
  impossibleJump: boolean;
  startedAt: string;
  endedAt: string | null;
  source: 'gps' | 'placed';
  suggested: boolean;
  holeOut: boolean;
  averageEligibleAt: string | null;
  /** Player lie tap only. Auto lies re-read from the course map. Older files omit it. */
  playerLie?: ShotLie;
};

/** One penalty or drop. lat/lng are omitted unless they are a real point. */
export type RoundTransferPenalty = {
  /** Present when the file recorded the row id. Older files omit it. */
  id?: string;
  kind: PenaltyKind;
  strokes: number;
  reason: string;
  note: string | null;
  createdAt: string;
  lat?: number;
  lng?: number;
  /** Shot the penalty follows. Null when the file or the hole had none. */
  afterShotId: string | null;
  /** Seq of that shot. Null on older files. */
  afterShotSeq: number | null;
};

export type RoundTransferHole = {
  number: number;
  par: number | null;
  parSource: 'course' | 'user' | null;
  score: number | null;
  yards: number | null;
  handicap: number | null;
  tee: LatLng | null;
  green: LatLng | null;
  greenSource: 'user_estimate' | 'course_centroid' | null;
  greenFront: LatLng | null;
  greenBack: LatLng | null;
  greenDepthYards: number | null;
  putts: number;
  puttLengths: string[];
  puttsDone: boolean;
  /** Pace of play: hole begun / Made it · Hole Out. Null when never stamped. */
  startedAt: string | null;
  completedAt: string | null;
  /** Tee shot on par 4+. Null in older files or when never tapped. */
  fairway: FairwayResult | null;
  shots: RoundTransferShot[];
  /**
   * Undefined when the file has no `penalties` field (the list is unknown).
   * `[]` means the file says this hole has none. New files always write the array.
   */
  penalties: RoundTransferPenalty[] | undefined;
};

export type RoundTransferRound = {
  /** Local round id. Restore replaces a stored round with the same id. Null in older files. */
  id: string | null;
  startedAt: string;
  finishedAt: string | null;
  courseName: string | null;
  holeCount: 9 | 18;
  courseApiId: string | null;
  courseLat: number | null;
  courseLng: number | null;
  courseCity: string | null;
  courseState: string | null;
  courseCountry: string | null;
  teeName: string | null;
  teeRating: number | null;
  teeSlope: number | null;
  teeTotalYards: number | null;
  /** Stored paint/hydrate token. Null when this round never recorded one. */
  courseDataSource: string | null;
  /** Yard-test round. Absent in older files, which are not test rounds. */
  test: boolean;
  holes: RoundTransferHole[];
};

/**
 * Favorite identity only. No offline/download status and no cached paint.
 */
export type RoundTransferFavorite = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  location: LatLng | null;
};

/** One bag: on/off, order, and typed carry. Null carry is blank, never an estimate. */
export type RoundTransferBagClub = {
  id: string;
  enabled: boolean;
  sortOrder: number;
  typicalCarryYards: number | null;
};

/** Bag names so a shot's clubId reads on its own. Restore does not write clubs. */
export type RoundTransferClub = {
  id: string;
  name: string;
  shortName: string | null;
};

export type RoundHistoryDocument = {
  kind: typeof ROUND_HISTORY_EXPORT_KIND;
  version: typeof ROUND_HISTORY_EXPORT_VERSION;
  exportedAt: string;
  clubs: RoundTransferClub[];
  rounds: RoundTransferRound[];
  favorites: RoundTransferFavorite[];
  bag: RoundTransferBagClub[];
};

export type RoundHistoryImport =
  | {
      ok: true;
      rounds: RoundTransferRound[];
      shots: number;
      rejectedShots: number;
      ignoredAverages: true;
      favorites: RoundTransferFavorite[];
      bag: RoundTransferBagClub[];
      /** Document exportedAt, or null when it is missing or not a time. */
      exportedAt: string | null;
    }
  | { ok: false; reason: 'not_shottrax' | 'empty' };

type ExportShotInput = {
  clubId: string | null;
  seq: number;
  startLat: number | null;
  startLng: number | null;
  endLat: number | null;
  endLng: number | null;
  startAccuracyM: number | null;
  endAccuracyM: number | null;
  startFixQuality: ShotFixQuality | null;
  endFixQuality: ShotFixQuality | null;
  distanceYards: number | null;
  typedYards: number | null;
  fixQuality: ShotFixQuality | null;
  impossibleJump: boolean;
  startedAt: string;
  endedAt: string | null;
  source: ShotSource;
  suggested: boolean;
  holeOut: boolean;
  averageEligibleAt?: string | null;
  lie?: ShotLie | null;
  lieSource?: ShotLieSource | null;
};

type ExportHoleInput = {
  number: number;
  par: number | null;
  parSource: 'course' | 'user' | null;
  score: number | null;
  yards: number | null;
  handicap: number | null;
  teeLat: number | null;
  teeLng: number | null;
  greenLat: number | null;
  greenLng: number | null;
  greenSource: 'user_estimate' | 'course_centroid' | null;
  greenFrontLat: number | null;
  greenFrontLng: number | null;
  greenBackLat: number | null;
  greenBackLng: number | null;
  greenDepthYards: number | null;
  putts: number;
  puttLengths: string[];
  puttsDone: boolean;
  startedAt?: string | null;
  completedAt?: string | null;
  fairway?: FairwayResult | null;
  shots: ExportShotInput[];
  penalties?: readonly RoundTransferPenalty[];
};

type ExportRoundInput = {
  id?: string | null;
  startedAt: string;
  finishedAt: string | null;
  courseName: string | null;
  holeCount: number;
  courseApiId: string | null;
  courseLat: number | null;
  courseLng: number | null;
  courseCity?: string | null;
  courseState?: string | null;
  courseCountry?: string | null;
  teeName: string | null;
  teeRating: number | null;
  teeSlope: number | null;
  teeTotalYards: number | null;
  courseDataSource?: string | null;
  test?: boolean | null;
  holes: ExportHoleInput[];
};

export type ExportFavoriteInput = {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
  location?: LatLng | null;
};

export type ExportBagClubInput = {
  id: string;
  enabled: boolean;
  sortOrder: number;
  typicalCarryYards?: number | null;
};

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function finite(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

/** Parseable time only. A bad pace stamp is dropped, never guessed. */
function isoTime(value: unknown): string | null {
  const t = text(value);
  return t && Number.isFinite(Date.parse(t)) ? t : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pair(lat: number | null, lng: number | null): LatLng | null {
  if (lat == null || lng == null) return null;
  const point = { lat, lng };
  return isValidLatLng(point) ? point : null;
}

/** Stored tee/green only. Clubhouse and missing coords stay null. Course location is not a fill. */
export function acceptedTransferPaint(point: LatLng | null | undefined): LatLng | null {
  if (roundImportFillsTeeGreenFromClubhouse()) return null;
  if (!isCourseCardLatLng(point) || isClubhousePin(point)) return null;
  return { lat: point.lat, lng: point.lng };
}

function readPoint(value: unknown): LatLng | null {
  const record = asRecord(value);
  if (!record) return null;
  return pair(finite(record.lat), finite(record.lng));
}

function fixQuality(value: unknown, source: 'gps' | 'placed'): ShotFixQuality | null {
  if (source === 'placed') return null;
  if (value === 'good' || value === 'soft' || value === 'forced' || value === 'none') return value;
  return null;
}

function sourceOf(value: unknown): 'gps' | 'placed' | null {
  if (value === 'gps' || value === 'placed') return value;
  return null;
}

/**
 * A shot imports only with two real marks. Missing, placeholder, or flagged
 * invented coordinates are dropped. Yards are haversine of those marks.
 */
export function acceptTransferShot(raw: unknown): RoundTransferShot | null {
  if (roundImportInventsCoords()) return null;
  const record = asRecord(raw);
  if (!record || record.invented === true) return null;
  const source = sourceOf(record.source);
  if (!source) return null;
  const start = readPoint(record.start);
  const end = readPoint(record.end);
  if (!isValidLatLng(start) || !isValidLatLng(end)) return null;
  const yards = roundYards(haversineYards(start, end));
  if (!Number.isFinite(yards) || yards <= 0) return null;
  const seq = finite(record.seq);
  const startedAt = text(record.startedAt);
  if (seq == null || seq < 1 || !startedAt) return null;
  const startFix = fixQuality(record.startFixQuality, source);
  const endFix = fixQuality(record.endFixQuality, source);
  return {
    clubId: text(record.clubId),
    seq,
    start,
    end,
    startAccuracyM: finite(record.startAccuracyM),
    endAccuracyM: finite(record.endAccuracyM),
    startFixQuality: startFix,
    endFixQuality: endFix,
    distanceYards: yards,
    typedYards: finite(record.typedYards),
    fixQuality: fixQuality(record.fixQuality, source) ?? (source === 'gps' ? startFix : null),
    impossibleJump: record.impossibleJump === true,
    startedAt,
    endedAt: text(record.endedAt),
    source,
    suggested: record.suggested === true,
    holeOut: record.holeOut === true,
    averageEligibleAt: text(record.averageEligibleAt),
    ...playerLieField(parseShotLie(record.playerLie)),
  };
}

/** `playerLie` rides only when the player tapped one, so older files and auto lies add no key. */
function playerLieField(lie: ShotLie | null | undefined): { playerLie?: ShotLie } {
  return lie ? { playerLie: lie } : {};
}

function penaltyKind(value: unknown): PenaltyKind | null {
  return value === 'penalty' || value === 'drop' ? value : null;
}

function penaltyStrokes(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < MIN_PENALTY_STROKES || value > MAX_PENALTY_STROKES) return null;
  return value;
}

/**
 * A penalty row imports only with a known kind, an integer stroke count in the
 * app's range, a text reason, and a real timestamp. Anything else is skipped.
 * Coordinates are kept only as a valid point — never invented, never 0,0.
 */
export function acceptTransferPenalty(raw: unknown): RoundTransferPenalty | null {
  const record = asRecord(raw);
  if (!record) return null;
  const kind = penaltyKind(record.kind);
  const strokes = penaltyStrokes(record.strokes);
  const reason = text(record.reason);
  const createdAt = isoTime(record.createdAt);
  if (!kind || strokes == null || !reason || !createdAt) return null;
  const point = pair(finite(record.lat), finite(record.lng));
  const afterSeq = finite(record.afterShotSeq);
  const penalty: RoundTransferPenalty = {
    kind,
    strokes,
    reason,
    note: text(record.note),
    createdAt,
    afterShotId: text(record.afterShotId),
    afterShotSeq: afterSeq != null && Number.isInteger(afterSeq) ? afterSeq : null,
  };
  const id = text(record.id);
  if (id) penalty.id = id;
  if (point) {
    penalty.lat = point.lat;
    penalty.lng = point.lng;
  }
  return penalty;
}

/**
 * Phone rows kept beside an explicit file list. A row is kept when it is not
 * already in the file (same id) and its createdAt is later than exportedAt.
 * Missing or unparseable exportedAt treats every phone row as newer.
 * Created at exactly exportedAt follows the file.
 *
 * A penalty deleted on the phone is a local Watch tombstone, not a field in
 * this file, so a backup that still lists it puts that penalty back.
 */
export function penaltiesNewerThanExport<T extends { id?: string | null; createdAt: string }>(
  file: readonly { id?: string | null }[],
  phone: readonly T[],
  exportedAt: string | null,
): T[] {
  const fileIds = new Set<string>();
  for (const penalty of file) {
    const id = penalty.id?.trim();
    if (id) fileIds.add(id);
  }
  const exportedMs = exportTimeMs(exportedAt);
  return phone.filter((penalty) => {
    const id = penalty.id?.trim();
    if (id && fileIds.has(id)) return false;
    if (exportedMs == null) return true;
    const createdMs = Date.parse(penalty.createdAt);
    if (!Number.isFinite(createdMs)) return true;
    return createdMs > exportedMs;
  });
}

function exportTimeMs(value: string | null | undefined): number | null {
  const stamp = isoTime(value);
  if (!stamp) return null;
  return Date.parse(stamp);
}

/**
 * An array is a known list, possibly empty after bad rows are skipped.
 * No field, null, or any non-array is unknown — not "none".
 */
function acceptPenalties(raw: unknown): RoundTransferPenalty[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const penalties: RoundTransferPenalty[] = [];
  for (const item of raw) {
    const accepted = acceptTransferPenalty(item);
    if (accepted) penalties.push(accepted);
  }
  return penalties;
}

function acceptHole(raw: unknown): { hole: RoundTransferHole; rejectedShots: number } | null {
  const record = asRecord(raw);
  if (!record) return null;
  // Unknown hole fields are ignored, same as build 92. A missing penalties field stays unknown.
  const number = finite(record.number);
  if (number == null || !Number.isInteger(number) || number < 1 || number > 18) return null;
  const shotsRaw = Array.isArray(record.shots) ? record.shots : [];
  const shots: RoundTransferShot[] = [];
  let rejectedShots = 0;
  for (const shot of shotsRaw) {
    const accepted = acceptTransferShot(shot);
    if (accepted) shots.push(accepted);
    else rejectedShots += 1;
  }
  shots.sort((a, b) => a.seq - b.seq);
  const parSource = record.parSource === 'course' || record.parSource === 'user' ? record.parSource : null;
  const greenSource =
    record.greenSource === 'user_estimate' || record.greenSource === 'course_centroid'
      ? record.greenSource
      : null;
  const putts = finite(record.putts);
  return {
    rejectedShots,
    hole: {
      number,
      par: finite(record.par),
      parSource,
      score: finite(record.score),
      yards: finite(record.yards),
      handicap: finite(record.handicap),
      tee: acceptedTransferPaint(readPoint(record.tee)),
      green: acceptedTransferPaint(readPoint(record.green)),
      greenSource: acceptedTransferPaint(readPoint(record.green)) ? greenSource : null,
      greenFront: acceptedTransferPaint(readPoint(record.greenFront)),
      greenBack: acceptedTransferPaint(readPoint(record.greenBack)),
      greenDepthYards: finite(record.greenDepthYards),
      putts: putts != null && putts >= 0 ? Math.min(5, Math.round(putts)) : 0,
      puttLengths: Array.isArray(record.puttLengths)
        ? record.puttLengths.filter((item): item is string => typeof item === 'string')
        : [],
      puttsDone: record.puttsDone === true,
      startedAt: isoTime(record.startedAt),
      completedAt: isoTime(record.completedAt),
      fairway: parseFairwayResult(record.fairway),
      shots,
      penalties: acceptPenalties(record.penalties),
    },
  };
}

function shotFromExport(shot: ExportShotInput): RoundTransferShot | null {
  return acceptTransferShot({
    clubId: shot.clubId,
    seq: shot.seq,
    start: pair(shot.startLat, shot.startLng),
    end: pair(shot.endLat, shot.endLng),
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
    ...playerLieField(shot.lieSource === 'player' ? shot.lie : null),
  });
}

function carryFromExport(id: string, value: number | null | undefined): number | null {
  if (isPutterClubId(id) || value == null) return null;
  return parseTypicalCarryYards(String(value));
}

function favoriteFromExport(raw: ExportFavoriteInput): RoundTransferFavorite | null {
  const id = text(raw.id);
  const name = text(raw.name);
  if (!id || !name) return null;
  const location = isValidLatLng(raw.location) ? { lat: raw.location.lat, lng: raw.location.lng } : null;
  return { id, name, city: text(raw.city), state: text(raw.state), location };
}

function bagFromExport(raw: ExportBagClubInput): RoundTransferBagClub | null {
  const id = text(raw.id);
  if (!id || typeof raw.enabled !== 'boolean') return null;
  if (!Number.isInteger(raw.sortOrder)) return null;
  return {
    id,
    enabled: raw.enabled,
    sortOrder: raw.sortOrder,
    typicalCarryYards: carryFromExport(id, raw.typicalCarryYards),
  };
}

export function buildRoundHistoryExport(args: {
  rounds: readonly ExportRoundInput[];
  clubs?: readonly { id: string; name: string; shortName?: string | null }[];
  favorites?: readonly ExportFavoriteInput[];
  bag?: readonly ExportBagClubInput[];
  exportedAt: string;
}): RoundHistoryDocument {
  const rounds: RoundTransferRound[] = [];
  for (const round of args.rounds) {
    const startedAt = text(round.startedAt);
    if (!startedAt) continue;
    const holeCount = round.holeCount === 9 ? 9 : round.holeCount === 18 ? 18 : null;
    if (!holeCount) continue;
    const holes: RoundTransferHole[] = [];
    for (const hole of round.holes) {
      const shots = hole.shots
        .map(shotFromExport)
        .filter((shot): shot is RoundTransferShot => shot != null);
      holes.push({
        number: hole.number,
        par: hole.par,
        parSource: hole.parSource,
        score: hole.score,
        yards: hole.yards,
        handicap: hole.handicap,
        tee: acceptedTransferPaint(pair(hole.teeLat, hole.teeLng)),
        green: acceptedTransferPaint(pair(hole.greenLat, hole.greenLng)),
        greenSource: acceptedTransferPaint(pair(hole.greenLat, hole.greenLng)) ? hole.greenSource : null,
        greenFront: acceptedTransferPaint(pair(hole.greenFrontLat, hole.greenFrontLng)),
        greenBack: acceptedTransferPaint(pair(hole.greenBackLat, hole.greenBackLng)),
        greenDepthYards: hole.greenDepthYards,
        putts: hole.putts,
        puttLengths: hole.puttLengths,
        puttsDone: hole.puttsDone,
        startedAt: isoTime(hole.startedAt),
        completedAt: isoTime(hole.completedAt),
        fairway: parseFairwayResult(hole.fairway ?? null),
        shots,
        // New files always write the array, including [] when the hole has none.
        penalties: acceptPenalties(hole.penalties) ?? [],
      });
    }
    rounds.push({
      id: text(round.id),
      startedAt,
      finishedAt: text(round.finishedAt),
      courseName: text(round.courseName),
      holeCount,
      courseApiId: text(round.courseApiId),
      courseLat: finite(round.courseLat),
      courseLng: finite(round.courseLng),
      courseCity: text(round.courseCity),
      courseState: text(round.courseState),
      courseCountry: text(round.courseCountry),
      teeName: text(round.teeName),
      teeRating: finite(round.teeRating),
      teeSlope: finite(round.teeSlope),
      teeTotalYards: finite(round.teeTotalYards),
      courseDataSource: normalizeCourseDataSource(round.courseDataSource),
      test: round.test === true,
      holes,
    });
  }
  const favorites: RoundTransferFavorite[] = [];
  const favoriteIds = new Set<string>();
  for (const raw of args.favorites ?? []) {
    const favorite = favoriteFromExport(raw);
    if (!favorite || favoriteIds.has(favorite.id)) continue;
    favoriteIds.add(favorite.id);
    favorites.push(favorite);
  }
  const bag: RoundTransferBagClub[] = [];
  const bagIds = new Set<string>();
  for (const raw of args.bag ?? []) {
    const club = bagFromExport(raw);
    if (!club || bagIds.has(club.id)) continue;
    bagIds.add(club.id);
    bag.push(club);
  }
  return {
    kind: ROUND_HISTORY_EXPORT_KIND,
    version: ROUND_HISTORY_EXPORT_VERSION,
    exportedAt: text(args.exportedAt) ?? new Date(0).toISOString(),
    clubs: (args.clubs ?? []).flatMap((club) => {
      const id = text(club.id);
      const name = text(club.name);
      return id && name ? [{ id, name, shortName: text(club.shortName) }] : [];
    }),
    rounds,
    favorites,
    bag,
  };
}

export function serializeRoundHistory(doc: RoundHistoryDocument): string {
  return JSON.stringify(doc);
}

export function planRoundHistoryImport(raw: unknown): RoundHistoryImport {
  const parsed = typeof raw === 'string' ? safeParse(raw) : raw;
  const record = asRecord(parsed);
  if (!record || record.kind !== ROUND_HISTORY_EXPORT_KIND || !isRoundHistoryExportVersion(record.version)) {
    return { ok: false, reason: 'not_shottrax' };
  }
  if (roundImportWritesStoredAverages()) {
    return { ok: false, reason: 'not_shottrax' };
  }
  void record.averages;
  const roundsRaw = Array.isArray(record.rounds) ? record.rounds : [];
  const rounds: RoundTransferRound[] = [];
  let shots = 0;
  let rejectedShots = 0;
  for (const item of roundsRaw) {
    const row = asRecord(item);
    if (!row) continue;
    const startedAt = text(row.startedAt);
    const holeCount = row.holeCount === 9 ? 9 : row.holeCount === 18 ? 18 : null;
    if (!startedAt || !holeCount) continue;
    const holes: RoundTransferHole[] = [];
    const holeRows = Array.isArray(row.holes) ? row.holes : [];
    for (const holeRaw of holeRows) {
      const accepted = acceptHole(holeRaw);
      if (!accepted) continue;
      holes.push(accepted.hole);
      shots += accepted.hole.shots.length;
      rejectedShots += accepted.rejectedShots;
    }
    const courseLat = finite(row.courseLat);
    const courseLng = finite(row.courseLng);
    rounds.push({
      id: text(row.id),
      startedAt,
      finishedAt: text(row.finishedAt),
      courseName: text(row.courseName),
      holeCount,
      courseApiId: text(row.courseApiId),
      courseLat,
      courseLng,
      courseCity: text(row.courseCity),
      courseState: text(row.courseState),
      courseCountry: text(row.courseCountry),
      teeName: text(row.teeName),
      teeRating: finite(row.teeRating),
      teeSlope: finite(row.teeSlope),
      teeTotalYards: finite(row.teeTotalYards),
      courseDataSource: normalizeCourseDataSource(row.courseDataSource),
      test: row.test === true,
      holes,
    });
  }
  const favorites = acceptFavorites(record.favorites);
  const bag = acceptBag(record.bag);
  if (rounds.length === 0 && favorites.length === 0 && bag.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  return {
    ok: true,
    rounds,
    shots,
    rejectedShots,
    ignoredAverages: true,
    favorites,
    bag,
    exportedAt: isoTime(record.exportedAt),
  };
}

function acceptFavorites(raw: unknown): RoundTransferFavorite[] {
  if (!Array.isArray(raw)) return [];
  const out: RoundTransferFavorite[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const record = asRecord(item);
    if (!record) continue;
    const id = text(record.id);
    const name = text(record.name);
    if (!id || !name || seen.has(id) || isYardTestCourseId(id)) continue;
    seen.add(id);
    const location = readPoint(record.location);
    out.push({
      id,
      name,
      city: text(record.city),
      state: text(record.state),
      location: location && isValidLatLng(location) ? { lat: location.lat, lng: location.lng } : null,
    });
  }
  return out;
}

function acceptCarry(id: string, value: unknown): number | null {
  if (isPutterClubId(id) || value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return parseTypicalCarryYards(String(value));
  if (typeof value === 'string') return parseTypicalCarryYards(value);
  return null;
}

function acceptBag(raw: unknown): RoundTransferBagClub[] {
  if (!Array.isArray(raw)) return [];
  const out: RoundTransferBagClub[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const record = asRecord(item);
    if (!record) continue;
    const id = text(record.id);
    const sortOrder = finite(record.sortOrder);
    if (!id || seen.has(id) || typeof record.enabled !== 'boolean') continue;
    if (sortOrder == null || !Number.isInteger(sortOrder)) continue;
    seen.add(id);
    out.push({
      id,
      enabled: record.enabled,
      sortOrder,
      typicalCarryYards: acceptCarry(id, record.typicalCarryYards),
    });
  }
  return out;
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** ShotTraxx-rounds-YYYY-MM-DD.json in the phone's local date. */
export function roundExportFilename(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `ShotTraxx-rounds-${y}-${m}-${d}.json`;
}

export type RoundRestoreMerge = {
  /** Rounds not on this phone. Keep the file's id when it has one. */
  add: RoundTransferRound[];
  /** Rounds whose id is already on this phone. That round is replaced. */
  replace: RoundTransferRound[];
  /** Older files without ids that match a stored round, or a repeated id in the file. */
  skipped: number;
};

/**
 * Merge, never wipe. Same id → replace that one round. Otherwise add, unless
 * a round with the same start + course + length is already here (older files
 * carry no id) so a second restore does not double-count.
 */
export function planRoundRestoreMerge(args: {
  existing: readonly { id: string; startedAt: string; courseName: string | null; holeCount: number }[];
  incoming: readonly RoundTransferRound[];
}): RoundRestoreMerge {
  const ids = new Set(args.existing.map((round) => round.id));
  const keys = new Set(args.existing.map(roundTransferKey));
  const seenIds = new Set<string>();
  const add: RoundTransferRound[] = [];
  const replace: RoundTransferRound[] = [];
  let skipped = 0;
  for (const round of args.incoming) {
    const key = roundTransferKey(round);
    if (round.id && ids.has(round.id)) {
      if (seenIds.has(round.id)) {
        skipped += 1;
        continue;
      }
      seenIds.add(round.id);
      replace.push(round);
      continue;
    }
    // New round: skip a repeat in the file or the same round already here under another id.
    if ((round.id && seenIds.has(round.id)) || keys.has(key)) {
      skipped += 1;
      continue;
    }
    if (round.id) seenIds.add(round.id);
    keys.add(key);
    add.push(round);
  }
  return { add, replace, skipped };
}

export function roundTransferKey(round: { startedAt: string; courseName: string | null; holeCount: number }): string {
  return `${round.startedAt}|${round.courseName ?? ''}|${round.holeCount}`;
}

function canonicalPuttLengths(lengths: readonly string[], putts: number): string[] {
  const n = Math.min(5, Math.max(0, Math.round(Number.isFinite(putts) ? putts : 0)));
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) out.push(lengths[i] ?? '');
  return out;
}

function canonicalPoint(point: LatLng | null | undefined): { lat: number; lng: number } | null {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  return { lat: point.lat, lng: point.lng };
}

function canonicalPenalties(penalties: readonly RoundTransferPenalty[] | undefined) {
  return [...(penalties ?? [])]
    .map((penalty) => {
      const point = pair(penalty.lat ?? null, penalty.lng ?? null);
      return {
        kind: penalty.kind,
        strokes: penalty.strokes,
        reason: penalty.reason,
        note: text(penalty.note),
        createdAt: penalty.createdAt,
        lat: point?.lat ?? null,
        lng: point?.lng ?? null,
        afterShotId: text(penalty.afterShotId),
        afterShotSeq:
          typeof penalty.afterShotSeq === 'number' && Number.isInteger(penalty.afterShotSeq)
            ? penalty.afterShotSeq
            : null,
      };
    })
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) ||
        a.kind.localeCompare(b.kind) ||
        a.strokes - b.strokes ||
        a.reason.localeCompare(b.reason) ||
        (a.note ?? '').localeCompare(b.note ?? '') ||
        (a.lat ?? 0) - (b.lat ?? 0) ||
        (a.lng ?? 0) - (b.lng ?? 0),
    );
}

/**
 * Identity of a transferred round, ignoring row ids that restore regenerates.
 * Pass exportedAt (null if the file's stamp is missing or not a time) when `phone`
 * is the round on the device and `file` is the backup. An explicit penalties list
 * then matches if the phone already has that list plus any newer phone rows.
 * Omit exportedAt to compare two explicit lists as written.
 */
export function sameRoundTransferContent(
  phone: RoundTransferRound,
  file: RoundTransferRound,
  exportedAt?: string | null,
): boolean {
  if (exportedAt === undefined) {
    return JSON.stringify(canonicalTransferRound(phone, file)) === JSON.stringify(canonicalTransferRound(file, phone));
  }
  const phonePenalties = (hole: RoundTransferHole, counterpart: RoundTransferHole | undefined) => {
    if (hole.penalties == null || counterpart?.penalties == null) return undefined;
    return hole.penalties;
  };
  const filePenalties = (hole: RoundTransferHole, counterpart: RoundTransferHole | undefined) => {
    if (hole.penalties == null || counterpart?.penalties == null) return undefined;
    return [...hole.penalties, ...penaltiesNewerThanExport(hole.penalties, counterpart.penalties, exportedAt)];
  };
  return (
    JSON.stringify(canonicalTransferRound(phone, file, phonePenalties)) ===
    JSON.stringify(canonicalTransferRound(file, phone, filePenalties))
  );
}

function penaltiesKnownForComparison(hole: RoundTransferHole, other: RoundTransferRound): boolean {
  if (hole.penalties == null) return false;
  const counterpart = other.holes.find((row) => row.number === hole.number);
  return counterpart?.penalties != null;
}

function canonicalTransferRound(
  round: RoundTransferRound,
  other: RoundTransferRound,
  penaltiesOf?: (
    hole: RoundTransferHole,
    counterpart: RoundTransferHole | undefined,
  ) => RoundTransferPenalty[] | undefined,
) {
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
    courseDataSource: round.courseDataSource,
    test: round.test === true,
    teeName: round.teeName,
    teeRating: round.teeRating,
    teeSlope: round.teeSlope,
    teeTotalYards: round.teeTotalYards,
    holes: [...round.holes]
      .sort((left, right) => left.number - right.number)
      .map((hole) => {
        const counterpart = other.holes.find((row) => row.number === hole.number);
        const listed = penaltiesOf
          ? penaltiesOf(hole, counterpart)
          : penaltiesKnownForComparison(hole, other)
            ? hole.penalties
            : undefined;
        return {
        number: hole.number,
        par: hole.par,
        parSource: hole.parSource,
        score: hole.score,
        yards: hole.yards,
        handicap: hole.handicap,
        putts: hole.putts,
        puttsDone: hole.puttsDone,
        puttLengths: canonicalPuttLengths(hole.puttLengths, hole.putts),
        fairway: hole.fairway,
        startedAt: hole.startedAt,
        completedAt: hole.completedAt,
        tee: canonicalPoint(hole.tee),
        green: canonicalPoint(hole.green),
        greenSource: hole.green ? hole.greenSource : null,
        greenFront: canonicalPoint(hole.greenFront),
        greenBack: canonicalPoint(hole.greenBack),
        greenDepthYards: hole.greenDepthYards,
        shots: [...hole.shots]
          .filter((shot) => shot.source === 'gps' || shot.source === 'placed')
          .sort((left, right) => left.seq - right.seq)
          .map((shot) => ({
            clubId: shot.clubId,
            seq: shot.seq,
            source: shot.source,
            startLat: shot.start.lat,
            startLng: shot.start.lng,
            endLat: shot.end.lat,
            endLng: shot.end.lng,
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
            suggested: shot.suggested,
            holeOut: shot.holeOut,
            averageEligibleAt: shot.averageEligibleAt,
            playerLie: shot.playerLie ?? null,
          })),
        ...(listed ? { penalties: canonicalPenalties(listed) } : {}),
        };
      }),
  };
}

/** New favorites only. An id already on the phone is left as it is. */
export function planFavoriteRestoreMerge(
  existingIds: readonly string[],
  incoming: readonly RoundTransferFavorite[],
): RoundTransferFavorite[] {
  const seen = new Set(existingIds);
  const add: RoundTransferFavorite[] = [];
  for (const favorite of incoming) {
    if (seen.has(favorite.id)) continue;
    seen.add(favorite.id);
    add.push(favorite);
  }
  return add;
}

export type BagClubSnapshot = {
  id: string;
  name: string;
  shortName: string;
  enabled: boolean;
  sortOrder: number;
  typicalCarryYards: number | null;
};

export type BagChange =
  | { kind: 'on'; clubId: string; label: string }
  | { kind: 'off'; clubId: string; label: string }
  | { kind: 'order'; clubId: string; label: string; from: number; to: number }
  | { kind: 'carry'; clubId: string; label: string; from: number | null; to: number | null };

/**
 * What would change on clubs this phone already has. Missing file clubs are
 * not removed. Clubs the phone does not have are not created.
 */
export function planBagRestore(
  current: readonly BagClubSnapshot[],
  incoming: readonly RoundTransferBagClub[],
): BagChange[] {
  const incomingById = new Map<string, RoundTransferBagClub>();
  for (const row of incoming) {
    if (!incomingById.has(row.id)) incomingById.set(row.id, row);
  }
  const changes: BagChange[] = [];
  const ordered = [...current].sort(
    (left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
  );
  for (const club of ordered) {
    const next = incomingById.get(club.id);
    if (!next) continue;
    const label = club.name.trim() || club.shortName.trim() || club.id;
    if (next.enabled !== club.enabled) {
      changes.push({ kind: next.enabled ? 'on' : 'off', clubId: club.id, label });
    }
    if (next.sortOrder !== club.sortOrder) {
      changes.push({ kind: 'order', clubId: club.id, label, from: club.sortOrder, to: next.sortOrder });
    }
    const nextCarry = isPutterClubId(club.id) ? null : next.typicalCarryYards;
    const currentCarry = isPutterClubId(club.id) ? null : club.typicalCarryYards;
    if (nextCarry !== currentCarry) {
      changes.push({ kind: 'carry', clubId: club.id, label, from: currentCarry ?? null, to: nextCarry });
    }
  }
  return changes;
}

function carryWord(value: number | null): string {
  return value == null ? 'blank' : String(value);
}

export function formatBagChange(change: BagChange): string {
  if (change.kind === 'on') return `${change.label} turned on`;
  if (change.kind === 'off') return `${change.label} turned off`;
  if (change.kind === 'order') return `${change.label} moved from ${change.from} to ${change.to}`;
  return `${change.label} carry ${carryWord(change.from)} → ${carryWord(change.to)}`;
}

export function formatRestoreToast(args: {
  added: number;
  updated: number;
  favoritesAdded?: number;
}): string {
  const favoritesAdded = args.favoritesAdded ?? 0;
  if (args.added === 0 && args.updated === 0 && favoritesAdded === 0) {
    return 'Those rounds are already on this phone.';
  }
  const parts: string[] = [];
  if (args.added > 0) parts.push(`${args.added} round${args.added === 1 ? '' : 's'} added`);
  if (args.updated > 0) parts.push(`${args.updated} round${args.updated === 1 ? '' : 's'} updated`);
  if (favoritesAdded > 0) parts.push(`${favoritesAdded} favorite${favoritesAdded === 1 ? '' : 's'} added`);
  return `${parts.join(', ')}.`.replace(/^./, (c) => c.toUpperCase());
}

export function roundHistoryShareTitle(): 'ShotTraxx™ rounds' {
  return `${SHOTTRAXX_BRAND} rounds`;
}
