/**
 * Course search may have several requests in flight (GPS nearby, zip geocode, name search).
 * Only the latest one may write the list. A GPS nearby answer is dropped once the field has text.
 */

export function nextCourseSearchRequest(previousId: number): number {
  const previous = Number.isFinite(previousId) && previousId > 0 ? Math.floor(previousId) : 0;
  return previous + 1;
}

export function courseSearchResponseIsCurrent(args: {
  requestId: number;
  latestRequestId: number;
  startedQuery: string;
  latestQuery: string;
  /** Phone GPS nearby. Never applied while the field has text. */
  gpsNearby?: boolean;
}): boolean {
  if (args.requestId !== args.latestRequestId) return false;
  if (args.startedQuery !== args.latestQuery) return false;
  if (args.gpsNearby && args.latestQuery.trim() !== '') return false;
  return true;
}
