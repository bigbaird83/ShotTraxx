import type { CourseSummary } from '../course/types';
import { pinYardTestCourseFirst } from '../course/yardTestCourse';
import { haversineYards } from './haversine';
import { isValidLatLng, type LatLng } from './latLng';
import type { GpsFix } from './types';
import { phoneFixForNearbyCourses } from './watchNearby';
import { parseUsZip } from './zipGeocode';

/** Start 9/18 always needs a real picked course. Typed names do not start a round. */
export function courseNameIsOptional(): false {
  return false;
}

export function canStartWithoutCourse(): false {
  return false;
}

export function freeTextCourseStartAllowed(): false {
  return false;
}

/** When the course lists tees, a tee is required. */
export function canStartWithoutTeeWhenCourseHasTees(): false {
  return false;
}

export const COURSE_SEARCH_PLACEHOLDER = 'Search by name, city, state, or zip';

export function courseSearchPlaceholder(): typeof COURSE_SEARCH_PLACEHOLDER {
  return COURSE_SEARCH_PLACEHOLDER;
}

/** Golf Courses API text search. Name, city, and state go through `q`. Zip geocodes, then nearby. */
export function courseSearchQueryParam(): 'q' {
  return 'q';
}

export function parseCourseSearchQuery(raw: string | null | undefined): string | null {
  const q = raw?.trim() ?? '';
  return q.length > 0 ? q : null;
}

export function planCourseSearchParams(raw: string | null | undefined): { q: string } | null {
  const q = parseCourseSearchQuery(raw);
  return q ? { q } : null;
}

export function canStartRound(args: {
  picked?: { id?: string | null } | null;
  teeCount?: number | null;
  pickedTee?: { name?: string | null } | null;
}): boolean {
  const id = args.picked?.id?.trim();
  if (!id) return false;
  if (args.teeCount == null) return false;
  if (args.teeCount > 0 && !args.pickedTee?.name?.trim()) return false;
  return true;
}

function playedAt(
  course: { id?: string | null; name?: string | null },
  lastPlayedAtByCourse?: Record<string, string | null | undefined>,
): string | null {
  if (!lastPlayedAtByCourse) return null;
  const id = course.id?.trim();
  const name = course.name?.trim();
  const raw = (id ? lastPlayedAtByCourse[id] : null) ?? (name ? lastPlayedAtByCourse[name] : null);
  return raw?.trim() ? raw : null;
}

export type CourseListSort = 'distance' | 'name';

/** Distance sort uses a fresh phone fix, or the geocoded zip point. Never Watch. Never invented. */
export function courseListDistanceSortUsesPhoneFix(): true {
  return true;
}

export function courseListDistanceSortUsesWatchFix(): false {
  return false;
}

export function courseListInventDistanceOrder(): false {
  return false;
}

export function phoneFixForCourseList(args: {
  phoneFix?: GpsFix | null;
  watchFix?: GpsFix | null;
  nowMs?: number;
}): LatLng | null {
  return phoneFixForNearbyCourses({
    phoneFix: args.phoneFix ?? null,
    watchFix: args.watchFix,
    nowMs: args.nowMs ?? Date.now(),
  });
}

export function planCourseListSort(args: {
  phoneFix?: GpsFix | null;
  watchFix?: GpsFix | null;
  nowMs?: number;
}): CourseListSort {
  return phoneFixForCourseList(args) ? 'distance' : 'name';
}

function courseLocation(course: { location?: LatLng | null }): LatLng | null {
  return isValidLatLng(course.location) ? course.location : null;
}

function nameKey(course: { name?: string | null }): string {
  return (course.name ?? '').trim().toLowerCase();
}

/** One list: played first, then phone-distance or name. Missing/stale phone → name. */
export function planCourseList<T extends {
  id?: string | null;
  name?: string | null;
  location?: LatLng | null;
}>(args: {
  courses: T[];
  lastPlayedAtByCourse?: Record<string, string | null | undefined>;
  phoneFix?: GpsFix | null;
  watchFix?: GpsFix | null;
  nowMs?: number;
  /** Zip search-near origin. Wins over phone when valid. Never invented. */
  from?: LatLng | null;
}): T[] {
  const from = isValidLatLng(args.from) ? args.from : phoneFixForCourseList(args);
  const sort = from ? 'distance' : 'name';
  const sorted = args.courses
    .map((course, index) => ({
      course,
      index,
      played: playedAt(course, args.lastPlayedAtByCourse),
      location: courseLocation(course),
    }))
    .sort((a, b) => {
      if (a.played && b.played) {
        const byDate = Date.parse(b.played) - Date.parse(a.played);
        if (byDate !== 0) return byDate;
      } else if (a.played) {
        return -1;
      } else if (b.played) {
        return 1;
      }
      if (sort === 'distance' && from) {
        const aYd = a.location ? haversineYards(from, a.location) : Number.POSITIVE_INFINITY;
        const bYd = b.location ? haversineYards(from, b.location) : Number.POSITIVE_INFINITY;
        if (aYd !== bYd) return aYd - bYd;
      }
      const byName = nameKey(a.course).localeCompare(nameKey(b.course));
      if (byName !== 0) return byName;
      return a.index - b.index;
    })
    .map((row) => row.course);
  // TEMP yard test course is only ever listed when its flag is on; then it sits on top.
  return pinYardTestCourseFirst(sorted);
}

export type NearbyCourseSearchPlan =
  | { mode: 'search'; q: string }
  | { mode: 'zip'; zip: string }
  | { mode: 'nearby'; from: LatLng }
  | { mode: 'needs_location' }
  | { mode: 'too_short' };

/**
 * Name search needs 3 non-space characters.
 * Digits-only shorter than a ZIP is not a name search — wait for 5 digits.
 * Empty stays on the GPS nearby path. A real ZIP is not too short.
 */
export function courseSearchInputTooShort(raw: string | null | undefined): boolean {
  const q = raw?.trim() ?? '';
  if (!q || parseUsZip(q)) return false;
  const compact = q.replace(/\s+/g, '');
  if (/^\d+$/.test(compact)) return compact.length < 5;
  return compact.length < 3;
}

/** Nearby without a fresh phone fix does not invent a point or an order. Zip is its own path. */
export function planNearbyCourseSearch(args: {
  query?: string | null;
  phoneFix?: GpsFix | null;
  watchFix?: GpsFix | null;
  nowMs?: number;
}): NearbyCourseSearchPlan {
  const q = parseCourseSearchQuery(args.query);
  const zip = parseUsZip(q);
  if (zip) return { mode: 'zip', zip };
  if (q && courseSearchInputTooShort(q)) return { mode: 'too_short' };
  if (q) return { mode: 'search', q };
  const phone = phoneFixForCourseList(args);
  if (!phone) return { mode: 'needs_location' };
  return { mode: 'nearby', from: phone };
}

export function courseListPutsPlayedOnTop(): true {
  return true;
}

export function courseSearchSharesNearbyList(): true {
  return true;
}

/** Text / place search. Never Watch GPS and never the 15 m / 25 m mark gates. */
export function courseSearchUsesWatchGps(): false {
  return false;
}

export function courseSearchUsesPhoneFix(): false {
  return false;
}

export function nearbyNeedsLocationWhenFixMissing(): true {
  return true;
}

export function courseSearchClearsOnFind(): true {
  return true;
}

/** Nearby/search cards hide after a real course pick so tees sit in-fold. */
export function courseListHidesAfterSelect(): true {
  return true;
}

export function showNearbyCourseList(selected?: { id?: string | null } | null): boolean {
  return !selected?.id?.trim();
}

export function courseSearchUsesMarkGates(): false {
  return false;
}

export type CourseSummaryList = CourseSummary[];
