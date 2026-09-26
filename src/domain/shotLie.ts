import type { OsmFeature } from '../course/types';
import { EARTH_RADIUS_M, METERS_PER_YARD } from '../config/sensing';
import { isValidLatLng, type LatLng } from './latLng';

/**
 * Where a shot was played from. Strokes gained only — never a map mark or a
 * club-distance sample.
 *
 * Auto lie reads mapped OSM outlines around the shot start:
 *   bunker → sand · tee → tee · fairway or green (fringe chip) → fairway
 *   outside them, with a fairway within MAPPED_NEAR_YARDS or a green within
 *   GREENSIDE_YARDS → rough
 * Nothing mapped nearby, or no start GPS → null (unknown). Never guessed.
 * A player tap always wins over auto and is never overwritten.
 */

export type ShotLie = 'tee' | 'fairway' | 'rough' | 'sand';
export type ShotLieSource = 'auto' | 'player';

export const SHOT_LIES: readonly ShotLie[] = ['tee', 'fairway', 'rough', 'sand'];

export const SHOT_LIE_LABELS: Record<ShotLie, string> = {
  tee: 'Tee',
  fairway: 'Fairway',
  rough: 'Rough',
  sand: 'Sand',
};

/** A start outside every outline is rough only when a fairway is mapped this close… */
export const MAPPED_NEAR_YARDS = 60;
/** …or a green is this close (greenside rough on holes with no fairway outline). */
export const GREENSIDE_YARDS = 30;

export function parseShotLie(value: unknown): ShotLie | null {
  return value === 'tee' || value === 'fairway' || value === 'rough' || value === 'sand' ? value : null;
}

export function parseShotLieSource(value: unknown): ShotLieSource | null {
  return value === 'auto' || value === 'player' ? value : null;
}

type Xy = { x: number; y: number };

/** Local flat yards around `origin`. Fine at hole scale. */
function projector(origin: LatLng): (p: LatLng) => Xy {
  const yardsPerDeg = (EARTH_RADIUS_M * Math.PI) / 180 / METERS_PER_YARD;
  const cos = Math.cos((origin.lat * Math.PI) / 180);
  return (p) => ({ x: (p.lng - origin.lng) * yardsPerDeg * cos, y: (p.lat - origin.lat) * yardsPerDeg });
}

function insideRing(pt: Xy, ring: Xy[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function segmentDistance(pt: Xy, a: Xy, b: Xy): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2));
  return Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy));
}

function ringDistance(pt: Xy, ring: Xy[]): number {
  let best = Infinity;
  for (let i = 1; i < ring.length; i += 1) best = Math.min(best, segmentDistance(pt, ring[i - 1], ring[i]));
  return best;
}

/** Auto lie for a shot start from mapped outlines. Null when unmapped or unknown. */
export function classifyShotLie(start: LatLng | null, features: readonly OsmFeature[] | null | undefined): ShotLie | null {
  if (!start || !isValidLatLng(start) || !features || features.length === 0) return null;
  const project = projector(start);
  const pt = { x: 0, y: 0 };
  const areas = features
    .filter((f) => f.coordinates.length >= 3 && ['bunker', 'green', 'fairway', 'tee'].includes(f.kind))
    .map((f) => ({ kind: f.kind, ring: f.coordinates.filter(isValidLatLng).map(project) }))
    .filter((f) => f.ring.length >= 3);

  const inside = (kind: string) => areas.some((f) => f.kind === kind && insideRing(pt, f.ring));
  if (inside('bunker')) return 'sand';
  if (inside('green') || inside('fairway')) return 'fairway';
  if (inside('tee')) return 'tee';

  const mappedNear = areas.some(
    (f) =>
      (f.kind === 'fairway' && ringDistance(pt, f.ring) <= MAPPED_NEAR_YARDS) ||
      (f.kind === 'green' && ringDistance(pt, f.ring) <= GREENSIDE_YARDS),
  );
  return mappedNear ? 'rough' : null;
}

export type ShotLieRow = {
  id: string;
  startLat: number | null;
  startLng: number | null;
  lie?: ShotLie | null;
  lieSource?: ShotLieSource | null;
};

/**
 * Auto-lie writes for one hole's shots. Player lies are never touched. An auto
 * lie follows its start (a moved spot re-reads), and one that no longer reads
 * clears back to unknown.
 */
export function planAutoShotLies(
  shots: readonly ShotLieRow[],
  features: readonly OsmFeature[] | null | undefined,
): { id: string; lie: ShotLie | null }[] {
  if (!features || features.length === 0) return [];
  const out: { id: string; lie: ShotLie | null }[] = [];
  for (const shot of shots) {
    if (shot.lieSource === 'player') continue;
    const start = shot.startLat != null && shot.startLng != null ? { lat: shot.startLat, lng: shot.startLng } : null;
    const lie = classifyShotLie(start, features);
    if (lie !== (shot.lie ?? null) || (lie != null && shot.lieSource !== 'auto')) out.push({ id: shot.id, lie });
  }
  return out;
}
