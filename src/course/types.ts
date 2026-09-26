import type { LatLng } from '../domain/latLng';
import type { CoursePaintSource } from './paintCache';

export type CourseSummary = {
  id: string;
  name: string;
  club: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  location: LatLng | null;
  /** Nearby search distance. API returns km; stored as meters. */
  distanceMeters: number | null;
};

export type HoleCourseData = {
  holeNumber: number;
  /** Blank when the API omits par — never invented. */
  par: number | null;
  /** Tee yardage for this hole. Blank if the API omits it. */
  yards: number | null;
  /** Stroke index 1–18. Blank if the API omits it — shown as “SI unknown”. */
  handicap: number | null;
  /** Green centroid when the API provides one — never invented. */
  greenCentroid: LatLng | null;
  /** Front of green when the API provides it — never derived from centroid. */
  greenFront: LatLng | null;
  /** Back of green when the API provides it — never derived from centroid. */
  greenBack: LatLng | null;
  /** Green depth in yards when the API provides it — never derived. */
  greenDepthYards: number | null;
  /** Tee coordinate when the API provides one — never invented, never the phone. */
  teeCentroid: LatLng | null;
};

export type TeeSet = {
  name: string;
  rating: number | null;
  slope: number | null;
  totalYards: number | null;
  holes: HoleCourseData[];
};

export type CourseDetail = {
  id: string;
  name: string;
  holeCount: number | null;
  location: LatLng | null;
  /** City when the API/catalog supplies it — used for golfapi search, never invented. */
  city?: string | null;
  /** State when the API/catalog supplies it — used for golfapi search, never invented. */
  state?: string | null;
  holes: HoleCourseData[];
  tees: TeeSet[];
  /** Pro/Max flag from course detail. Missing/false → no invented greens. */
  greenCentersAvailable: boolean | null;
  /**
   * `resolveCoursePaint` winner (`ok`, `source`, `fromCache` only).
   * Absent until that resolve runs. Never inferred from coordinates.
   */
  paintResult?: {
    ok: boolean;
    source: CoursePaintSource | null;
    fromCache: boolean;
  } | null;
};

/**
 * Play surfaces, plus hazard and cart-path kinds that OSM actually uses:
 * `golf=bunker`, `golf=water_hazard`, `golf=lateral_water_hazard`, `golf=cartpath`.
 * `golf=hazard` (unused), bare `highway=service`, and bare `natural=water` are not kinds.
 */
export type OsmGolfKind =
  | 'green'
  | 'fairway'
  | 'tee'
  | 'hole'
  | 'bunker'
  | 'water_hazard'
  | 'lateral_water_hazard'
  | 'cartpath';

export type OsmFeature = {
  kind: OsmGolfKind;
  holeNumber: number | null;
  coordinates: LatLng[];
};

/**
 * OSM fairway/green/tee/hole overlay, plus bunker, water-hazard, and cart-path
 * outlines when Overpass returned them. Empty/unmapped → null, never invented.
 */
export type OsmOverlay = {
  source: 'osm';
  features: OsmFeature[];
  geojson: object | null;
};

export type OsmOverlayQuery = {
  courseId?: string | null;
  /** Direct Overpass center. A hole green is fine here. */
  location?: LatLng | null;
  /**
   * Catalog course pin (favorite, round, or course card). Worker requests use
   * only this, rounded to 4 decimals, so every hole shares one cache entry.
   */
  courseLocation?: LatLng | null;
  holeNumber?: number;
  /** Search radius in meters. Default depends on whether a hole pin is used. */
  radiusM?: number;
};

export type OsmOverlayHook = {
  fetchCourseOverlay: (query: OsmOverlayQuery) => Promise<OsmOverlay | null>;
};

export interface CourseDataClient {
  isConfigured(): boolean;
  nearbyCourses(from: LatLng, radiusKm?: number, signal?: AbortSignal): Promise<CourseSummary[]>;
  searchCourses(query: string, signal?: AbortSignal): Promise<CourseSummary[]>;
  getCourse(id: string): Promise<CourseDetail | null>;
  fetchOsmOverlay(query: OsmOverlayQuery): Promise<OsmOverlay | null>;
}
