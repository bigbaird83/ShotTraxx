import { getGolfCoursesProxyBase } from './config';
import {
  catalogCourseDetail,
  isLocalCatalogId,
  mergeCatalogSummaries,
  nearbyLocalCatalog,
  searchLocalCatalog,
} from './catalog';
import { fetchOsmOverlay } from './osmOverlay';
import { isYardTestCourseId, pinYardTestCourseFirst, yardTestCourseDetail } from './yardTestCourse';
import {
  mergeGreenCenters,
  parseCourseDetail,
  parseGreenCenters,
  parseNearbyCourses,
} from './parse';
import type { CourseDataClient, CourseDetail, CourseSummary, HoleCourseData, OsmOverlayQuery } from './types';
import type { LatLng } from '../domain/latLng';
import { isCourseCardLatLng } from '../domain/latLng';
import { planCourseSearchParams } from '../domain/coursePick';
import { NEARBY_RADIUS_KM, withinNearbyRadius } from '../domain/nearbyRadius';
import { getSharedCoursePaintCache } from './paintCache';
import {
  applyCoursePaintToDetail,
  loadBundledGolfApiCandidate,
  loadGolfApiPaintCandidate,
  loadOsmOpenGolfCandidate,
  resolveCoursePaint,
  type PaintCandidate,
} from './waterfall';

/** Phone + Watch Search nearby: 40 mi (≈ 64.4 km). */
const DEFAULT_RADIUS_KM = NEARBY_RADIUS_KM;
const MAX_RADIUS_KM = 100;

export type CourseDataDeps = {
  /** Worker base for Golf Courses API (`{share sync}/gca/v1`). The key lives on the Worker. */
  getBaseUrl?: () => string | null;
  fetch?: typeof fetch;
};

export class GolfCoursesApiError extends Error {
  status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'GolfCoursesApiError';
    this.status = status;
  }
}

function networkHint(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/tls|ssl|cert|network request failed|failed to fetch|econnreset|enotfound/i.test(raw)) {
    return 'Couldn’t reach courses nearby. Try again.';
  }
  return raw || 'Couldn’t load courses.';
}

async function apiGet(
  path: string,
  base: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<{ status: number; json: unknown }> {
  let res: Response;
  try {
    res = await fetchImpl(`${base}${path}`, {
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new GolfCoursesApiError(networkHint(err));
  }
  if (res.status === 401) {
    throw new GolfCoursesApiError('Couldn’t sign in to courses.', 401);
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

export type GcaPaintDeps = {
  getBaseUrl?: () => string | null;
  fetch?: typeof fetch;
  /** Already-loaded scorecard holes. Tees ride along when the detail had them. */
  holes?: readonly HoleCourseData[] | null;
  numHoles?: number | null;
};

/**
 * Same GCA Pro read as live course paint: `GET /courses/:id/green-centers`.
 * No Worker, a local catalog id, or a non-2xx response is a miss. Never invents a green.
 * When holes were not already loaded, the course detail is read first so tees match live paint.
 */
export async function loadGcaPaintCandidate(
  courseId: string | null | undefined,
  deps: GcaPaintDeps = {},
): Promise<{ candidate: PaintCandidate; rows: ReturnType<typeof parseGreenCenters> } | null> {
  const id = courseId?.trim() ?? '';
  if (!id || isLocalCatalogId(id)) return null;
  const base = (deps.getBaseUrl ?? getGolfCoursesProxyBase)();
  if (!base) return null;
  const fetchImpl = deps.fetch ?? fetch;
  const encoded = encodeURIComponent(id);
  try {
    let holes = deps.holes ?? null;
    let numHoles = deps.numHoles === 9 || deps.numHoles === 18 ? deps.numHoles : null;
    if (!holes) {
      const detailRes = await apiGet(`/courses/${encoded}`, base, fetchImpl);
      if (detailRes.status >= 200 && detailRes.status < 300) {
        const detail = parseCourseDetail(detailRes.json);
        holes = detail?.holes ?? [];
        if (numHoles == null && (detail?.holeCount === 9 || detail?.holeCount === 18)) {
          numHoles = detail.holeCount;
        }
      } else {
        holes = [];
      }
    }
    const greensRes = await apiGet(`/courses/${encoded}/green-centers`, base, fetchImpl);
    if (greensRes.status < 200 || greensRes.status >= 300) return null;
    const rows = parseGreenCenters(greensRes.json);
    if (rows.length === 0) return null;
    return {
      rows,
      candidate: {
        source: 'gca',
        numHoles,
        holes: rows.map((row) => {
          const existing = holes?.find((hole) => hole.holeNumber === row.holeNumber);
          const tee = existing && isCourseCardLatLng(existing.teeCentroid) ? existing.teeCentroid : null;
          return { hole: row.holeNumber, tee, green: row.greenCentroid };
        }),
      },
    };
  } catch {
    return null;
  }
}

/**
 * Golf Courses API client (nearby courses, scorecard par, Pro green centroids).
 * Calls go through the share-sync Worker, which holds the vendor key.
 * Disabled when no Worker is configured — does not invent course or green data.
 */
export function createCourseDataClient(deps: CourseDataDeps = {}): CourseDataClient {
  const getBaseUrl = deps.getBaseUrl ?? getGolfCoursesProxyBase;
  const fetchImpl = deps.fetch ?? fetch;

  return {
    isConfigured(): boolean {
      return getBaseUrl() != null;
    },

    async nearbyCourses(
      from: LatLng,
      radiusKm = DEFAULT_RADIUS_KM,
      signal?: AbortSignal,
    ): Promise<CourseSummary[]> {
      const base = getBaseUrl();
      const radius = Math.min(MAX_RADIUS_KM, Math.max(1, radiusKm));
      const local = nearbyLocalCatalog(from, radius);
      if (!base) return pinYardTestCourseFirst(local);
      const query = new URLSearchParams({
        lat: String(from.lat),
        lng: String(from.lng),
        radius: String(radius),
      });
      const { status, json } = await apiGet(`/courses?${query.toString()}`, base, fetchImpl, signal);
      if (status === 403) {
        throw new GolfCoursesApiError('Courses near you aren’t available.', 403);
      }
      if (status < 200 || status >= 300) {
        throw new GolfCoursesApiError('Couldn’t load courses nearby.', status);
      }
      return pinYardTestCourseFirst(
        withinNearbyRadius(mergeCatalogSummaries(parseNearbyCourses(json), local), radius),
      );
    },

    async searchCourses(query: string, signal?: AbortSignal): Promise<CourseSummary[]> {
      const base = getBaseUrl();
      const params = planCourseSearchParams(query);
      if (!params) return [];
      const local = searchLocalCatalog(params.q);
      if (!base) return local;
      const search = new URLSearchParams({ q: params.q });
      const { status, json } = await apiGet(`/courses?${search.toString()}`, base, fetchImpl, signal);
      if (status === 403) {
        throw new GolfCoursesApiError('Courses aren’t available right now.', 403);
      }
      if (status < 200 || status >= 300) {
        throw new GolfCoursesApiError('Couldn’t find that course.', status);
      }
      return mergeCatalogSummaries(parseNearbyCourses(json), local);
    },

    async getCourse(id: string): Promise<CourseDetail | null> {
      if (!id.trim()) return null;
      // TEMP yard test course: env geometry for hole 1 only. No waterfall, no paint-cache write.
      if (isYardTestCourseId(id)) return yardTestCourseDetail();
      const gcaBase = getBaseUrl();
      if (isLocalCatalogId(id) || !gcaBase) {
        const catalog = catalogCourseDetail(id);
        if (catalog) return paintWithoutWorker(catalog);
        return detailFromLastPaintCache(id);
      }
      let detailRes: { status: number; json: unknown };
      try {
        const encoded = encodeURIComponent(id);
        detailRes = await apiGet(`/courses/${encoded}`, gcaBase, fetchImpl);
      } catch (err) {
        const cached = await detailFromLastPaintCache(id);
        if (cached) return cached;
        throw err;
      }
      if (detailRes.status === 404) return detailFromLastPaintCache(id);
      if (detailRes.status < 200 || detailRes.status >= 300) {
        const cached = await detailFromLastPaintCache(id);
        if (cached) return cached;
        throw new GolfCoursesApiError('Couldn’t load that course.', detailRes.status);
      }
      const detail = parseCourseDetail(detailRes.json);
      if (!detail) return detailFromLastPaintCache(id);

      const match = {
        name: detail.name,
        city: detail.city,
        state: detail.state,
        location: detail.location,
        courseKey: detail.id,
      };
      let gcaRows: ReturnType<typeof parseGreenCenters> | null = null;
      const paint = await resolveCoursePaint(match, {
        loadOsm: async () => loadOsmOpenGolfCandidate(match),
        loadGca: async () => {
          const loaded = await loadGcaPaintCandidate(id, {
            getBaseUrl,
            fetch: fetchImpl,
            numHoles: detail.holeCount,
            holes: detail.holes,
          });
          gcaRows = loaded?.rows ?? null;
          return loaded?.candidate ?? null;
        },
        loadGolfApi: () => loadGolfApiPaintCandidate(match, { fetchImpl }),
        cache: getSharedCoursePaintCache(),
      });
      if (!paint.ok) {
        return { ...detail, paintResult: { ok: false, source: null, fromCache: false } };
      }
      const base =
        paint.source === 'gca' && !paint.fromCache && gcaRows
          ? {
              ...detail,
              holes: mergeGreenCenters(detail.holes, gcaRows),
              tees: detail.tees.map((tee) => ({
                ...tee,
                holes: mergeGreenCenters(tee.holes, gcaRows ?? []),
              })),
            }
          : detail;
      return {
        ...applyCoursePaintToDetail(base, paint),
        paintResult: { ok: true, source: paint.source, fromCache: paint.fromCache },
      };
    },

    fetchOsmOverlay(query: OsmOverlayQuery) {
      return fetchOsmOverlay(query, { fetch: fetchImpl });
    },
  };
}

function emptyCachedDetail(id: string, record: { name: string | null; city: string | null; numHoles: number | null }): CourseDetail {
  return {
    id,
    name: record.name?.trim() || 'Course',
    holeCount: record.numHoles,
    location: null,
    city: record.city,
    state: null,
    holes: [],
    tees: [],
    greenCentersAvailable: false,
  };
}

/**
 * Cache, OSM, and the bundled golfapi seed. No GCA and no network golfapi.
 * A miss is stamped so the card can say so. Never invents a coordinate.
 */
async function paintWithoutWorker(detail: CourseDetail): Promise<CourseDetail> {
  const match = {
    name: detail.name,
    city: detail.city ?? null,
    state: detail.state ?? null,
    location: detail.location,
    courseKey: detail.id,
  };
  const paint = await resolveCoursePaint(match, {
    cache: getSharedCoursePaintCache(),
    loadOsm: async () => loadOsmOpenGolfCandidate(match),
    loadGca: async () => null,
    loadGolfApi: async () => loadBundledGolfApiCandidate(match),
  });
  if (!paint.ok) {
    return { ...detail, paintResult: { ok: false, source: null, fromCache: false } };
  }
  const painted = applyCoursePaintToDetail(detail, paint);
  return {
    ...painted,
    greenCentersAvailable: painted.holes.some((hole) => hole.greenCentroid != null),
    paintResult: { ok: true, source: paint.source, fromCache: paint.fromCache },
  };
}

/**
 * Last successful paint for this id, only when it passes the waterfall gates.
 * A failed gate returns null — the stored points are not copied onto the card.
 */
async function detailFromLastPaintCache(id: string): Promise<CourseDetail | null> {
  const record = await getSharedCoursePaintCache().get(`id:${id.trim()}`);
  if (!record) return null;
  const painted = await paintWithoutWorker(emptyCachedDetail(id.trim(), record));
  if (!painted.paintResult?.ok) return null;
  return painted;
}

let singleton: CourseDataClient | null = null;

export function getCourseDataClient(): CourseDataClient {
  if (!singleton) singleton = createCourseDataClient();
  return singleton;
}

export function resetCourseDataClient(): void {
  singleton = null;
}
