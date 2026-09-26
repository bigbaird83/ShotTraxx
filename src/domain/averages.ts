import type { FixQuality } from './types';

export type AverageShot = {
  yards: number;
  /** GPS quality. Null for catch-up Placed shots (no soft/good quality). */
  fixQuality: FixQuality | null;
};

export type ClubAverage = {
  count: number;
  avgYards: number;
  includesSoft: boolean;
  includesForced: boolean;
};

/** More than this fraction off the baseline stays on the hole but does not move the average. */
export const AVERAGE_OUTLIER_RATIO = 0.2;

export type AverageSeed = {
  typedCarryYards: number | null;
  estimatedCarryYards: number | null;
};

/** Live average first; else typed carry; else estimated seed. No number → null (shot still starts the average). */
export function averageBaselineYards(args: {
  liveAvgYards: number | null;
  liveCount: number;
  typedCarryYards: number | null;
  estimatedCarryYards: number | null;
}): number | null {
  if (args.liveCount > 0 && args.liveAvgYards != null && Number.isFinite(args.liveAvgYards) && args.liveAvgYards !== 0) {
    return args.liveAvgYards;
  }
  if (args.typedCarryYards != null && Number.isFinite(args.typedCarryYards) && args.typedCarryYards !== 0) {
    return args.typedCarryYards;
  }
  if (args.estimatedCarryYards != null && Number.isFinite(args.estimatedCarryYards) && args.estimatedCarryYards !== 0) {
    return args.estimatedCarryYards;
  }
  return null;
}

/** Strictly inside 20% updates the average. 20% off or more does not. No baseline → still counts. */
export function shotMovesClubAverage(args: { yards: number; baselineYards: number | null }): boolean {
  if (args.baselineYards == null || !Number.isFinite(args.baselineYards) || args.baselineYards === 0) {
    return true;
  }
  if (!Number.isFinite(args.yards)) return false;
  return Math.abs(args.yards - args.baselineYards) / Math.abs(args.baselineYards) < AVERAGE_OUTLIER_RATIO;
}

/** Walk shots in order. Compare each to the live average, or the seed if there is not one yet.
 * Kept shots are the only ones that move the average or count toward the five-shot seed replacement.
 * Live / soft / Placed use the same filter. The shot still saves on the hole. */
export function shotsForClubAverage(shots: AverageShot[], seed: AverageSeed): AverageShot[] {
  const kept: AverageShot[] = [];
  for (const shot of shots) {
    const live = averageWithBadges(kept);
    const baseline = averageBaselineYards({
      liveAvgYards: live.count > 0 ? live.avgYards : null,
      liveCount: live.count,
      typedCarryYards: seed.typedCarryYards,
      estimatedCarryYards: seed.estimatedCarryYards,
    });
    if (shotMovesClubAverage({ yards: shot.yards, baselineYards: baseline })) {
      kept.push(shot);
    }
  }
  return kept;
}

/** Average and sample count after the 20% filter. `count` is what replaces the seed at 5. */
export function clubAverageFromShots(shots: AverageShot[], seed: AverageSeed): ClubAverage {
  return averageWithBadges(shotsForClubAverage(shots, seed));
}

/** Shown on a bag row when the club is unchecked. Not a yardage. */
export const DISABLED_CLUB_YARDAGE = '—' as const;

/**
 * Averages tab rows. Unchecked clubs (`enabled` false) are not in the bag,
 * so they have no row. This only filters the list — it does not delete,
 * reassign, or rewrite shots.
 */
export function enabledClubAverageRows<T extends { club: { enabled: boolean } }>(
  rows: readonly T[],
): T[] {
  return rows.filter((row) => row.club.enabled);
}

/**
 * Bag-row yardage. A disabled club is a dash, never its live average and
 * never a typical or stock carry. An enabled club keeps `yards` as given
 * (including null when there is no number yet).
 */
export function bagClubYardageLabel(args: {
  enabled: boolean;
  yards: number | null;
}): number | null | typeof DISABLED_CLUB_YARDAGE {
  if (!args.enabled) return DISABLED_CLUB_YARDAGE;
  return args.yards;
}

/**
 * Club averages include `soft` and `forced` GPS shots; badges report that mix.
 * Callers must pass only shots that `includeInDistanceAverages` accepts —
 * `fixQuality: none`, `no_gps`, typed yards, hole penalties, and putter shots
 * never belong here. Catch-up Placed shots pass `fixQuality: null` and still count.
 */
export function averageWithBadges(shots: AverageShot[]): ClubAverage {
  if (shots.length === 0) {
    return { count: 0, avgYards: 0, includesSoft: false, includesForced: false };
  }
  const sum = shots.reduce((acc, s) => acc + s.yards, 0);
  return {
    count: shots.length,
    avgYards: sum / shots.length,
    includesSoft: shots.some((s) => s.fixQuality === 'soft'),
    includesForced: shots.some((s) => s.fixQuality === 'forced'),
  };
}
