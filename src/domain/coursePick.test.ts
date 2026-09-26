import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { COPY } from './playerCopy';
import {
  COURSE_SEARCH_PLACEHOLDER,
  canStartRound,
  canStartWithoutCourse,
  canStartWithoutTeeWhenCourseHasTees,
  courseListDistanceSortUsesPhoneFix,
  courseListDistanceSortUsesWatchFix,
  courseListInventDistanceOrder,
  courseListPutsPlayedOnTop,
  courseNameIsOptional,
  courseSearchClearsOnFind,
  courseSearchPlaceholder,
  courseSearchQueryParam,
  courseSearchSharesNearbyList,
  courseSearchUsesMarkGates,
  courseSearchUsesPhoneFix,
  courseSearchUsesWatchGps,
  courseListHidesAfterSelect,
  freeTextCourseStartAllowed,
  nearbyNeedsLocationWhenFixMissing,
  parseCourseSearchQuery,
  showNearbyCourseList,
  planCourseList,
  planCourseListSort,
  planCourseSearchParams,
  planNearbyCourseSearch,
  courseSearchInputTooShort,
} from './coursePick';
import { inventGreenFromCenterPlusYards, inventGreenFromCourseCenter } from './courseCardPaint';
import { NEARBY_COURSE_FIX_MAX_AGE_MS } from './watchNearby';
import {
  nearbyCoursesHasSearchBox,
  nearbyCoursesUsesMarkGates,
  nearbyCoursesUsesPhoneFixOnly,
  nearbyCoursesUsesWatchFix,
} from './watchNearby';

test('start 9/18 needs a real course and a tee when the course has tees', () => {
  assert.equal(courseNameIsOptional(), false);
  assert.equal(canStartWithoutCourse(), false);
  assert.equal(freeTextCourseStartAllowed(), false);
  assert.equal(canStartWithoutTeeWhenCourseHasTees(), false);

  assert.equal(canStartRound({}), false);
  assert.equal(canStartRound({ picked: null, teeCount: 0, pickedTee: null }), false);
  assert.equal(canStartRound({ picked: { id: '' }, teeCount: 0, pickedTee: null }), false);
  assert.equal(canStartRound({ picked: { id: 'c1' }, teeCount: null, pickedTee: null }), false);
  assert.equal(canStartRound({ picked: { id: 'c1' }, teeCount: 2, pickedTee: null }), false);
  assert.equal(canStartRound({ picked: { id: 'c1' }, teeCount: 1, pickedTee: { name: '' } }), false);
  assert.equal(canStartRound({ picked: { id: 'c1' }, teeCount: 1, pickedTee: { name: 'Blue' } }), true);
  assert.equal(canStartRound({ picked: { id: 'c1' }, teeCount: 0, pickedTee: null }), true);
});

test('search placeholder is name/city/state/zip and never optional', () => {
  assert.equal(courseSearchPlaceholder(), 'Search by name, city, state, or zip');
  assert.equal(COPY.courseNamePlaceholder, COURSE_SEARCH_PLACEHOLDER);
  assert.equal(COPY.courseNamePlaceholder, 'Search by name, city, state, or zip');
  assert.doesNotMatch(COPY.courseNamePlaceholder, /optional/i);
  assert.doesNotMatch(COPY.nearbyUnavailable, /type a course name/i);
  assert.doesNotMatch(COPY.nearbyEmptyHint, /type a course name/i);
  assert.doesNotMatch(JSON.stringify(COPY), /Course name \(optional\)/);
  assert.doesNotMatch(JSON.stringify(COPY), /type a course name to start/i);
  assert.equal(courseSearchQueryParam(), 'q');
  assert.deepEqual(planCourseSearchParams('  pebble  '), { q: 'pebble' });
  assert.deepEqual(planCourseSearchParams('90210'), { q: '90210' });
  assert.deepEqual(planCourseSearchParams('Austin, TX'), { q: 'Austin, TX' });
  assert.equal(planCourseSearchParams('   '), null);
  assert.equal(parseCourseSearchQuery(''), null);
  assert.equal(courseSearchUsesWatchGps(), false);
  assert.equal(courseSearchUsesPhoneFix(), false);
  assert.equal(courseSearchUsesMarkGates(), false);
});

test('selecting a course hides nearby/search cards so tees sit in-fold', () => {
  assert.equal(courseListHidesAfterSelect(), true);
  assert.equal(showNearbyCourseList(null), true);
  assert.equal(showNearbyCourseList(undefined), true);
  assert.equal(showNearbyCourseList({ id: '' }), true);
  assert.equal(showNearbyCourseList({ id: 'cypress' }), false);

  const picker = readFileSync(new URL('../ui/CoursePicker.tsx', import.meta.url), 'utf8');
  assert.match(picker, /showNearbyCourseList\(selected\)/);
  assert.match(picker, /COPY\.clearCourse/);
  assert.match(picker, /COPY\.pickTee/);
  assert.match(picker, /onSelect\(null\)/);
  const listMap = picker.slice(picker.indexOf('{showList'), picker.indexOf('{teeBusy'));
  assert.match(listMap, /listed\.map/);
  assert.match(listMap, /showList/);
  assert.doesNotMatch(listMap, /selected\?\.id === course\.id/);
});

test('one course list puts played courses on top', () => {
  assert.equal(courseListPutsPlayedOnTop(), true);
  assert.equal(courseSearchSharesNearbyList(), true);
  const nearby = [
    { id: 'new', name: 'New CC' },
    { id: 'pebble', name: 'Pebble Beach' },
    { id: 'old', name: 'Old CC' },
  ];
  const listed = planCourseList({
    courses: nearby,
    lastPlayedAtByCourse: {
      pebble: '2026-09-18T16:00:00.000Z',
      old: '2026-09-10T16:00:00.000Z',
    },
  });
  assert.deepEqual(
    listed.map((row) => row.id),
    ['pebble', 'old', 'new'],
  );
});

test('home cannot start without a pick and has no free-text course start', () => {
  const home = readFileSync(new URL('../../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  const search = readFileSync(new URL('../../app/search.tsx', import.meta.url), 'utf8');
  assert.match(home, /canStartRound\(/);
  assert.match(home, /disabled=\{starting \|\| !canStart\}/);
  assert.doesNotMatch(home, /courseName\.trim\(\) \|\| null/);
  assert.doesNotMatch(home, /startRound\(db, holeCount, name\)/);
  assert.match(home, /COPY\.courseNamePlaceholder/);
  assert.match(home, /router\.push\('\/search'\)/);
  assert.doesNotMatch(home, /onChangeText/);
  assert.match(search, /searchQuery/);
  assert.match(search, /setSearchQuery\(''\)/);
  assert.match(home, /if \(!canStart \|\| !picked\) return;/);

  const picker = readFileSync(new URL('../ui/CoursePicker.tsx', import.meta.url), 'utf8');
  assert.match(picker, /searchCourses/);
  assert.match(picker, /planCourseList/);
  assert.match(picker, /planNearbyCourseSearch/);
  assert.match(picker, /COPY\.courseNamePlaceholder/);
  assert.match(search, /setSearchQuery\(''\)/);
  const findFn = picker.slice(picker.indexOf('const onFind'), picker.indexOf('useEffect(() => {\n    onRefreshReady'));
  assert.match(findFn, /planNearbyCourseSearch/);
  assert.match(findFn, /searchCourses\(plan\.q\)/);
  assert.match(findFn, /nearbyCourses\(plan\.from\)/);
  assert.match(findFn, /geocodeUsZip/);
  assert.match(findFn, /COPY\.zipGeocodeMiss/);
  assert.match(findFn, /COPY\.nearbyNeedsLocation/);
  assert.doesNotMatch(findFn, /nearbyCourses\(await getCurrentFix\(\)\)/);
  assert.doesNotMatch(findFn, /watchFix|Watch GPS|acceptFix/);

  const client = readFileSync(new URL('../course/client.ts', import.meta.url), 'utf8');
  assert.match(client, /searchCourses/);
  assert.match(client, /\/courses\?\$\{query\.toString\(\)\}/);
  assert.match(client, /q: params\.q/);

  const tree = [
    home,
    picker,
    readFileSync(new URL('./playerCopy.ts', import.meta.url), 'utf8'),
    readFileSync(new URL('../../README.md', import.meta.url), 'utf8'),
    readFileSync(new URL('../../NOTES.md', import.meta.url), 'utf8'),
  ].join('\n');
  assert.doesNotMatch(tree, /Course name \(optional\)/);
  assert.doesNotMatch(tree, /type a course name to start/i);
});

test('nearby is a phone fix; search is text/geocode and never Watch GPS or mark gates', () => {
  assert.equal(nearbyCoursesUsesPhoneFixOnly(), true);
  assert.equal(nearbyCoursesUsesWatchFix(), false);
  assert.equal(nearbyCoursesUsesMarkGates(), false);
  assert.equal(nearbyCoursesHasSearchBox(), false);
  assert.equal(courseSearchUsesWatchGps(), false);
  assert.equal(courseSearchUsesPhoneFix(), false);
  assert.equal(courseSearchUsesMarkGates(), false);

  const picker = readFileSync(new URL('../ui/CoursePicker.tsx', import.meta.url), 'utf8');
  const findFn = picker.slice(picker.indexOf('const onFind'), picker.indexOf('useEffect(() => {\n    onRefreshReady'));
  assert.match(findFn, /planNearbyCourseSearch/);
  assert.match(findFn, /nearbyCourses\(plan\.from\)/);
  assert.doesNotMatch(findFn, /watchFix|preferWatchFix|acceptFix|forceMark|classifyAccuracyM/);
  assert.match(picker, /COPY\.nearbyNeedsLocation/);
  assert.match(picker, /COPY\.clearSearch/);

  const client = readFileSync(new URL('../course/client.ts', import.meta.url), 'utf8');
  const searchFn = client.slice(client.indexOf('async searchCourses'), client.indexOf('async getCourse'));
  assert.match(searchFn, /q: params\.q/);
  assert.doesNotMatch(searchFn, /lat=|lng=|acceptFix|forceMark|watchFix/);

  const watch = readFileSync(new URL('./watchNearby.ts', import.meta.url), 'utf8');
  assert.match(watch, /phoneFixForNearbyCourses/);
  assert.match(watch, /void args\.watchFix/);
});

test('distance sort uses a fresh phone fix; missing or stale falls back to name', () => {
  assert.equal(courseListDistanceSortUsesPhoneFix(), true);
  assert.equal(courseListDistanceSortUsesWatchFix(), false);
  assert.equal(courseListInventDistanceOrder(), false);
  assert.equal(nearbyNeedsLocationWhenFixMissing(), true);
  assert.equal(courseSearchClearsOnFind(), true);
  assert.equal(courseSearchUsesPhoneFix(), false);
  assert.equal(inventGreenFromCourseCenter(), false);
  assert.equal(inventGreenFromCenterPlusYards(), false);

  const nowMs = 1_000_000;
  const phone = {
    lat: 35.02,
    lng: -92.06,
    accuracyM: 8,
    mocked: false,
    isSimulator: false,
    timestamp: nowMs,
  };
  const watch = { ...phone, lat: 33.27, lng: -93.24, timestamp: nowMs };
  const stale = { ...phone, timestamp: nowMs - NEARBY_COURSE_FIX_MAX_AGE_MS - 1 };
  const courses = [
    { id: 'zebra', name: 'Zebra CC', location: { lat: 35.021, lng: -92.061 } },
    { id: 'alpha', name: 'Alpha CC', location: { lat: 33.27, lng: -93.24 } },
    { id: 'middle', name: 'Middle CC', location: { lat: 34.5, lng: -92.3 } },
  ];

  assert.equal(planCourseListSort({ nowMs }), 'name');
  assert.equal(planCourseListSort({ phoneFix: stale, nowMs }), 'name');
  assert.equal(planCourseListSort({ phoneFix: phone, watchFix: watch, nowMs }), 'distance');
  assert.deepEqual(
    planCourseList({ courses, nowMs }).map((row) => row.id),
    ['alpha', 'middle', 'zebra'],
  );
  assert.deepEqual(
    planCourseList({ courses, phoneFix: stale, nowMs }).map((row) => row.id),
    ['alpha', 'middle', 'zebra'],
  );
  assert.deepEqual(
    planCourseList({ courses, phoneFix: phone, watchFix: watch, nowMs }).map((row) => row.id),
    ['zebra', 'middle', 'alpha'],
  );

  assert.deepEqual(planNearbyCourseSearch({ query: '72205', phoneFix: null, nowMs }), {
    mode: 'zip',
    zip: '72205',
  });
  assert.deepEqual(planNearbyCourseSearch({ query: '  magnolia  ', phoneFix: null, nowMs }), {
    mode: 'search',
    q: 'magnolia',
  });
  assert.deepEqual(planNearbyCourseSearch({ query: '', phoneFix: null, nowMs }), {
    mode: 'needs_location',
  });
  assert.deepEqual(planNearbyCourseSearch({ query: '', phoneFix: stale, watchFix: watch, nowMs }), {
    mode: 'needs_location',
  });
  assert.deepEqual(planNearbyCourseSearch({ query: '', phoneFix: phone, nowMs }), {
    mode: 'nearby',
    from: { lat: phone.lat, lng: phone.lng },
  });
});

test('short and partial digit input is not a name search', () => {
  assert.equal(courseSearchInputTooShort(''), false);
  assert.equal(courseSearchInputTooShort('32218'), false);
  assert.equal(courseSearchInputTooShort('oak'), false);
  for (const query of ['3', '32', '322', '3221', '  3  ', '1 2', 'ab', 'a b', '  ma']) {
    assert.equal(courseSearchInputTooShort(query), true, query);
    assert.deepEqual(planNearbyCourseSearch({ query, phoneFix: null, nowMs: 1 }), {
      mode: 'too_short',
    });
  }
  assert.deepEqual(planNearbyCourseSearch({ query: '32218', phoneFix: null, nowMs: 1 }), {
    mode: 'zip',
    zip: '32218',
  });
  assert.deepEqual(planNearbyCourseSearch({ query: '71753-0001', phoneFix: null, nowMs: 1 }), {
    mode: 'zip',
    zip: '71753',
  });
  assert.deepEqual(planNearbyCourseSearch({ query: 'oak', phoneFix: null, nowMs: 1 }), {
    mode: 'search',
    q: 'oak',
  });
  assert.deepEqual(planNearbyCourseSearch({ query: '12a', phoneFix: null, nowMs: 1 }), {
    mode: 'search',
    q: '12a',
  });
  assert.deepEqual(planNearbyCourseSearch({ query: 'Jacksonville FL', phoneFix: null, nowMs: 1 }), {
    mode: 'search',
    q: 'Jacksonville FL',
  });
  assert.deepEqual(planNearbyCourseSearch({ query: '123456', phoneFix: null, nowMs: 1 }), {
    mode: 'search',
    q: '123456',
  });
});
