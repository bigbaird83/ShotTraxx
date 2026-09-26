import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SOFT_GPS_MAX_M, SOFT_GPS_MIN_M } from '../config/sensing';
import { COPY } from './playerCopy';
import type { GpsFix } from './types';
import {
  NEARBY_COURSE_FIX_MAX_AGE_MS,
  NEARBY_COURSE_LIST_MAX,
  OPEN_PHONE,
  guessNearbyCourse,
  nearbyCourseFixIsFresh,
  nearbyCourseFixMaxAgeMs,
  nearbyCourseFixPassesMarkGates,
  nearbyCoursesGuessesFromWatch,
  nearbyCoursesHasSearchBox,
  nearbyCoursesPayload,
  nearbyCoursesUsesMarkGates,
  nearbyCoursesUsesPhoneFixOnly,
  nearbyCoursesUsesWatchFix,
  nearbyTeesPayload,
  phoneFixForNearbyCourses,
  planNearbyCourses,
  planWatchCoursePick,
  watchCoursePickRepeatsNameAsRow,
  watchCoursePickShowsOneName,
  watchNearbyHidesCourseNameFeedback,
  watchNearbyNavTitle,
  watchStartsFromBuiltListWithoutPhoneFix,
  watchShowsBag,
  watchShowsScoring,
  watchShowsSettings,
  liveRoundOpensThatHole,
  liveRoundReplacedByWatchCoursePick,
  watchCoursePickSetsPhoneCourse,
  watchOpenCoversLiveHoleWithCourses,
  startDifferentRoundLivesUnderHome,
  planWatchOpenFace,
  SELECT_COURSE,
  holesForWatchRound,
  watchEighteenIsFullCard,
  watchFirstScreenIsSelectCourse,
  watchNineIsFrontOrBack,
  watchNineIsHoles1Through9,
} from './watchNearby';
import {
  WATCH_MESSAGE_TYPES,
  nearbyCoursePickPayload,
  nearbyRequestPayload,
  parseNearbyCourses,
  parseStartRound,
  parseWatchNearbyIntent,
  startRoundPayload,
  watchPayloadRunsAcceptFix,
} from './watchMessages';

function fixAt(
  lat: number,
  lng: number,
  accuracyM: number | null,
  timestamp: number,
): GpsFix {
  return {
    lat,
    lng,
    accuracyM,
    mocked: false,
    isSimulator: false,
    timestamp,
  };
}

const phone = fixAt(37.0, -122.0, 40, 1_000_000);
const watch = fixAt(40.7, -74.0, 4, 1_000_000);
const courses = [
  { id: 'c1', name: 'Bay CC', distanceMeters: 1200 },
  { id: 'c2', name: 'Ridge GC', distanceMeters: 5400 },
];

test('nearby courses use the phone fix only — never the Watch', () => {
  assert.equal(nearbyCoursesUsesPhoneFixOnly(), true);
  assert.equal(nearbyCoursesUsesWatchFix(), false);
  assert.equal(nearbyCoursesGuessesFromWatch(), false);
  assert.equal(nearbyCoursesUsesMarkGates(), false);
  assert.equal(nearbyCourseFixPassesMarkGates(SOFT_GPS_MAX_M + 20), true);
  assert.equal(nearbyCourseFixPassesMarkGates(SOFT_GPS_MIN_M - 1), true);
  assert.equal(nearbyCourseFixMaxAgeMs(), 30_000);
  assert.equal(NEARBY_COURSE_FIX_MAX_AGE_MS, 30_000);

  const chosen = phoneFixForNearbyCourses({ phoneFix: phone, watchFix: watch, nowMs: 1_000_000 });
  assert.deepEqual(chosen, { lat: phone.lat, lng: phone.lng });
  assert.notEqual(chosen?.lat, watch.lat);
  assert.notEqual(chosen?.lng, watch.lng);

  const noPhone = phoneFixForNearbyCourses({ phoneFix: null, watchFix: watch, nowMs: 1_000_000 });
  assert.equal(noPhone, null);
});

test('no fresh phone fix or an empty list is one line: open the phone', () => {
  assert.equal(watchStartsFromBuiltListWithoutPhoneFix(), false);
  assert.equal(OPEN_PHONE, 'open the phone');
  assert.equal(SELECT_COURSE, 'Select course');
  assert.equal(COPY.openPhone, 'open the phone');
  assert.equal(COPY.selectCourse, 'Select course');
  assert.equal(nearbyCourseFixIsFresh(phone, 1_000_000 + NEARBY_COURSE_FIX_MAX_AGE_MS + 1), false);
  assert.equal(nearbyCourseFixIsFresh(null, 1_000_000), false);
  assert.equal(nearbyCourseFixIsFresh({ timestamp: 0 }, 1_000_000), false);

  const stale = planNearbyCourses({
    phoneFix: { ...phone, timestamp: 1_000_000 - NEARBY_COURSE_FIX_MAX_AGE_MS - 1 },
    watchFix: watch,
    courses,
    nowMs: 1_000_000,
  });
  assert.deepEqual(stale, { status: 'open_phone', line: OPEN_PHONE, courses: [] });
  assert.equal(guessNearbyCourse(stale), null);

  const missing = planNearbyCourses({
    phoneFix: null,
    watchFix: watch,
    courses,
    nowMs: 1_000_000,
  });
  assert.deepEqual(missing, { status: 'open_phone', line: OPEN_PHONE, courses: [] });
  assert.equal(guessNearbyCourse(missing), null);

  const empty = planNearbyCourses({
    phoneFix: phone,
    watchFix: watch,
    courses: [],
    nowMs: 1_000_000,
  });
  assert.deepEqual(empty, { status: 'open_phone', line: OPEN_PHONE, courses: [] });
  assert.equal(guessNearbyCourse(empty), null);

  const msg = nearbyCoursesPayload(empty);
  assert.equal(msg.type, 'nearbyCourses');
  assert.equal(msg.status, 'open_phone');
  assert.equal(msg.line, 'open the phone');
  assert.deepEqual(msg.courses, []);
  assert.equal(parseNearbyCourses(msg)?.line, OPEN_PHONE);
});

test('a live round opens the hole and is not replaced by a course pick', () => {
  assert.equal(planWatchOpenFace({ hasLiveRound: true }), 'hole');
  assert.notEqual(planWatchOpenFace({ hasLiveRound: true }), 'nearby');
  assert.notEqual(planWatchOpenFace({ hasLiveRound: true }), 'select_course');
  assert.equal(planWatchCoursePick({ hasLiveRound: true, replaceAllowed: false }), 'keep_live_round');
  assert.equal(liveRoundReplacedByWatchCoursePick(), false);
  assert.equal(watchOpenCoversLiveHoleWithCourses(), false);

  const service = readFileSync(new URL('../services/watchNearby.ts', import.meta.url), 'utf8');
  const pick = service.slice(service.indexOf('const pick = parseNearbyCoursePick'), service.indexOf('const start = parseStartRound'));
  assert.match(pick, /hasActiveRound\(\) && !replaceLiveRoundAllowed/);
  assert.match(pick, /Round in progress/);
  assert.doesNotMatch(pick, /startRound\(/);
});

test('a Watch course pick with no round going is the phone course', () => {
  assert.equal(planWatchCoursePick({ hasLiveRound: false }), 'set_phone_course');
  assert.equal(watchCoursePickSetsPhoneCourse(), true);

  const service = readFileSync(new URL('../services/watchNearby.ts', import.meta.url), 'utf8');
  const pick = service.slice(service.indexOf('const pick = parseNearbyCoursePick'), service.indexOf('const start = parseStartRound'));
  assert.match(pick, /coursePickedHandler/);
  assert.doesNotMatch(pick, /startRound\(/);

  const home = readFileSync(new URL('../../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  assert.match(home, /setWatchCoursePickedHandler/);
  assert.match(home, /setPicked\(pick\.course\)/);
  assert.match(home, /setPickedDetail\(pick\.detail\)/);
});

test('a short nearby list from the phone fix skips 15 m / 25 m mark gates', () => {
  const poorPhone = fixAt(37.1, -122.1, SOFT_GPS_MAX_M + 30, 1_000_000);
  assert.ok((poorPhone.accuracyM ?? 0) > SOFT_GPS_MAX_M);
  const plan = planNearbyCourses({
    phoneFix: poorPhone,
    watchFix: watch,
    courses,
    nowMs: 1_000_000,
  });
  assert.equal(plan.status, 'ok');
  assert.equal(plan.line, null);
  assert.equal(plan.courses.length, 2);
  assert.equal(plan.courses[0].id, 'c1');
  assert.equal(plan.courses[0].name, 'Bay CC');
  assert.notEqual(plan.courses[0].id, 'watch-guess');
  assert.equal(NEARBY_COURSE_LIST_MAX, 8);

  const many = Array.from({ length: 12 }, (_, i) => ({
    id: `c${i}`,
    name: `Course ${i}`,
    distanceMeters: i * 100,
  }));
  const trimmed = planNearbyCourses({
    phoneFix: poorPhone,
    courses: many,
    nowMs: 1_000_000,
  });
  assert.equal(trimmed.status, 'ok');
  if (trimmed.status !== 'ok') return;
  assert.equal(trimmed.courses.length, 8);

  const src = readFileSync(new URL('./watchNearby.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /acceptFix\(|forceMark\(|classifyAccuracyM/);
  assert.match(src, /phoneFixForNearbyCourses/);
  assert.doesNotMatch(src.slice(src.indexOf('export function phoneFixForNearbyCourses'), src.indexOf('export type WatchNearbyCourse')), /args\.watchFix\.(lat|lng)/);
});

test('Watch start messages never run acceptFix and never send Watch GPS', () => {
  const at = '2026-09-18T13:00:00.000Z';
  const request = parseWatchNearbyIntent(nearbyRequestPayload({ at }));
  const pick = parseWatchNearbyIntent(nearbyCoursePickPayload({ courseId: 'c1', at }));
  const start = parseWatchNearbyIntent(startRoundPayload({ courseId: 'c1', teeName: 'Blue', holeCount: 18, at }));
  assert.equal(request?.kind, 'nearbyRequest');
  assert.equal(request?.runsAcceptFix, false);
  assert.equal(request?.usesWatchFix, false);
  assert.equal(pick?.kind, 'nearbyCoursePick');
  assert.equal(pick?.runsAcceptFix, false);
  assert.equal(start?.kind, 'startRound');
  assert.equal(start?.runsAcceptFix, false);
  assert.equal(watchPayloadRunsAcceptFix(nearbyRequestPayload({ at })), false);
  assert.equal(watchPayloadRunsAcceptFix(startRoundPayload({ courseId: 'c1', teeName: 'Blue', holeCount: 18, at })), false);
  assert.equal('lat' in nearbyRequestPayload({ at }), false);
  assert.equal('lng' in startRoundPayload({ courseId: 'c1', teeName: 'Blue', holeCount: 18, at }), false);
  assert.equal(parseStartRound({ type: 'startRound', courseId: 'c1', teeName: '', at }), null);
  assert.equal(parseStartRound(startRoundPayload({ courseId: 'c1', holeCount: 9, at }))?.holeCount, 9);
  assert.deepEqual(holesForWatchRound(9), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(holesForWatchRound(18).length, 18);
  assert.ok(!holesForWatchRound(9).includes(10));
  assert.ok(WATCH_MESSAGE_TYPES.includes('nearbyCourses'));
  assert.ok(WATCH_MESSAGE_TYPES.includes('startRound'));

  const tees = nearbyTeesPayload({
    courseId: 'c1',
    courseName: 'Bay CC',
    tees: [{ name: 'Blue', rating: 72.1, slope: 128, totalYards: 6500 }],
  });
  assert.equal(tees.type, 'nearbyTees');
  assert.equal(tees.tees[0].name, 'Blue');
});

test('a live round opens that hole; a different round lives under Home', () => {
  assert.equal(liveRoundOpensThatHole(), true);
  assert.equal(watchOpenCoversLiveHoleWithCourses(), false);
  assert.equal(liveRoundReplacedByWatchCoursePick(), false);
  assert.equal(watchCoursePickSetsPhoneCourse(), true);
  assert.equal(startDifferentRoundLivesUnderHome(), true);
  assert.equal(planWatchCoursePick({ hasLiveRound: true, replaceAllowed: false }), 'keep_live_round');
  assert.equal(planWatchCoursePick({ hasLiveRound: false }), 'set_phone_course');
  assert.equal(watchFirstScreenIsSelectCourse(), true);
  assert.equal(watchNineIsHoles1Through9(), true);
  assert.equal(watchNineIsFrontOrBack(), false);
  assert.equal(watchEighteenIsFullCard(), true);
  assert.equal(planWatchOpenFace({ hasLiveRound: true }), 'hole');
  assert.equal(planWatchOpenFace({ hasLiveRound: true, openedFromHome: false }), 'hole');
  assert.equal(planWatchOpenFace({ hasLiveRound: false }), 'select_course');
  assert.equal(planWatchOpenFace({ hasLiveRound: true, openedFromHome: true }), 'select_course');
  assert.equal(
    planWatchOpenFace({ hasLiveRound: false, selectCourseTapped: true }),
    'nearby',
  );
  assert.equal(
    planWatchOpenFace({
      hasLiveRound: false,
      selectCourseTapped: true,
      courseId: 'c1',
    }),
    'hole_count',
  );
  assert.equal(
    planWatchOpenFace({
      hasLiveRound: false,
      selectCourseTapped: true,
      courseId: 'c1',
      holeCount: 9,
      hasTees: true,
    }),
    'tees',
  );
  assert.notEqual(planWatchOpenFace({ hasLiveRound: true }), 'nearby');
  assert.notEqual(planWatchOpenFace({ hasLiveRound: true }), 'select_course');

  const session = readFileSync(new URL('../../targets/watch/WatchClubSession.swift', import.meta.url), 'utf8');
  assert.match(session, /var active: Bool = false/);
  assert.match(session, /var hasLiveHole/);
  assert.match(session, /yards > 0/);
  assert.match(session, /var showsNearby/);
  assert.match(session, /nearbyFromHome/);
  assert.match(session, /dismissNearbyToHole/);
  assert.match(session, /if !nearby\.active && hasLiveHole && !nearbyFromHome \{ return \}/);
  const leaveFn = session.slice(session.indexOf('func leave('), session.indexOf('func dismissNearbyToHole'));
  assert.match(leaveFn, /nearbyFromHome = true/);
  assert.match(leaveFn, /awaitingSelect = true/);
  assert.doesNotMatch(leaveFn, /requestNearby/);
  assert.match(leaveFn, /"type": "clubNav"/);
  assert.match(session, /func pickHoleCount/);
  assert.match(session, /"holeCount"/);
  assert.match(session, /awaitingSelect/);
  const activate = session.slice(session.indexOf('activationDidCompleteWith'), session.indexOf('didReceiveApplicationContext'));
  assert.match(activate, /settleLaunchFace\(commit: true\)/);
  assert.doesNotMatch(activate, /requestNearby/);
  const settle = session.slice(session.indexOf('private func settleLaunchFace'), session.indexOf('private func logSavedRoundHomeSkipIfNeeded'));
  assert.match(settle, /awaitingSelect = true/);
  const replyFn = session.slice(session.indexOf('private func handleReply'), session.indexOf('private func failUnavailable'));
  assert.match(replyFn, /type == "startRound"/);
  assert.match(replyFn, /nearbyFromHome = false/);
  assert.match(replyFn, /nearby.active = false/);

  const watchUi = readFileSync(new URL('../../targets/watch/content.swift', import.meta.url), 'utf8');
  assert.match(watchUi, /session\.showsNearby/);
  assert.match(watchUi, /session\.canContinueRound/);
  assert.match(watchUi, /dismissNearbyToHole/);
  assert.match(watchUi, /Text\("Select course"\)/);
  assert.match(watchUi, /session\.pickHoleCount\(9\)/);
  assert.match(watchUi, /session\.pickHoleCount\(18\)/);
  assert.doesNotMatch(watchUi, /Front nine|Back nine|front nine|back nine/);
  const pick = watchUi.slice(watchUi.indexOf('private var clubPick'), watchUi.indexOf('private var moreClubs'));
  assert.doesNotMatch(pick, /session\.nearby\.active/);
  assert.equal((pick.match(/actionPill\("Home"\)/g) ?? []).length, 1);

  const service = readFileSync(new URL('../services/watchNearby.ts', import.meta.url), 'utf8');
  assert.match(service, /allowDuringRound/);
  assert.match(service, /hasActiveRound\(\) && !opts\?\.allowDuringRound/);
  assert.match(service, /hasActiveRound\(\) && !replaceLiveRoundAllowed/);
  assert.match(service, /coursePickedHandler/);
  assert.match(service, /Round in progress/);
  assert.match(service, /start\.holeCount/);
  assert.match(service, /getCurrentFix/);
  assert.doesNotMatch(service, /rememberBuiltNearbyCourses|builtNearbyCourses/);
  assert.doesNotMatch(service, /roundHoleCountFromCourse/);

  const home = readFileSync(new URL('../../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  assert.match(home, /setWatchCoursePickedHandler/);
  assert.match(home, /setPicked\(pick\.course\)/);
  assert.match(home, /setPickedDetail\(pick\.detail\)/);

  const start = readFileSync(new URL('../services/useWatchNearbyStart.ts', import.meta.url), 'utf8');
  assert.match(start, /setWatchNearbyContext/);
  assert.doesNotMatch(start, /pushWatchNearbyCourses/);
});

test('Watch nearby UI is a short list — no search, bag, settings, or scoring', () => {
  assert.equal(nearbyCoursesHasSearchBox(), false);
  assert.equal(watchShowsBag(), false);
  assert.equal(watchShowsSettings(), false);
  assert.equal(watchShowsScoring(), false);

  const watchUi = readFileSync(new URL('../../targets/watch/content.swift', import.meta.url), 'utf8');
  // Search nearby never hard-codes “open the phone”; the phone sends the line.
  assert.doesNotMatch(watchUi, /open the phone/);
  assert.match(watchUi, /nearbyEmptyLine/);
  assert.match(watchUi, /Select course/);
  // Search nearby is a push button, not a text search box.
  assert.match(watchUi, /Text\("Search nearby"\)/);
  assert.doesNotMatch(watchUi, /TextField|searchable/);
  assert.doesNotMatch(watchUi, /Bag|Settings|Scorecard|Averages/);
  assert.match(watchUi, /nearbyCourses|session\.nearby/);

  const session = readFileSync(new URL('../../targets/watch/WatchClubSession.swift', import.meta.url), 'utf8');
  assert.match(session, /nearbyRequest|nearbyCoursePick|startRound/);
  assert.doesNotMatch(
    session.slice(session.indexOf('func requestNearby'), session.indexOf('func pickCourse')),
    /lat|lng|accuracyM/,
  );

  const service = readFileSync(new URL('../services/watchNearby.ts', import.meta.url), 'utf8');
  assert.match(service, /phoneFixForNearbyCourses|planNearbyCourses/);
  assert.doesNotMatch(service, /acceptFix\(|forceMark\(/);
  assert.match(service, /getLastLiveFix|phoneFix/);
});

test('Watch course pick shows one name and Holes/Tees — never Courses near you after select', () => {
  assert.equal(watchCoursePickShowsOneName(), true);
  assert.equal(watchCoursePickRepeatsNameAsRow(), false);
  assert.equal(watchNearbyNavTitle({}), 'Courses near you');
  assert.equal(watchNearbyNavTitle({ courseId: 'c1' }), 'Holes');
  assert.equal(watchNearbyNavTitle({ courseId: 'c1', holeCount: 9, hasTees: true }), 'Tees');
  assert.equal(watchNearbyNavTitle({ courseId: 'c1', holeCount: 18, hasTees: true }), 'Tees');
  assert.equal(watchNearbyNavTitle({ courseId: 'c1', holeCount: 9, hasTees: false }), 'Holes');
  assert.equal(watchNearbyHidesCourseNameFeedback({ feedback: 'Cypress Creek Country Club', courseName: 'Cypress Creek Country Club' }), true);
  assert.equal(watchNearbyHidesCourseNameFeedback({ feedback: 'Phone unavailable', courseName: 'Cypress Creek Country Club' }), false);
  assert.equal(watchNearbyHidesCourseNameFeedback({ feedback: 'Cypress Creek Country Club' }), false);

  const watchUi = readFileSync(new URL('../../targets/watch/content.swift', import.meta.url), 'utf8');
  const session = readFileSync(new URL('../../targets/watch/WatchClubSession.swift', import.meta.url), 'utf8');
  const start = watchUi.slice(watchUi.indexOf('private var nearbyStart'), watchUi.indexOf('private var puttSheet'));
  const header = watchUi.slice(watchUi.indexOf('private var nearbyNavTitle'), watchUi.indexOf('private var nearbyStart'));
  assert.equal((start.match(/if let name = session\.nearby\.courseName/g) ?? []).length, 1);
  assert.equal((start.match(/Text\(name\)/g) ?? []).length, 1);
  assert.ok(start.indexOf('if let name = session.nearby.courseName') < start.indexOf('pickHoleCount(9)'));
  assert.ok(start.indexOf('Text(name)') < start.indexOf('ForEach(session.nearby.tees)'));
  assert.match(start, /if session\.nearby\.courseId != nil \{/);
  assert.match(start, /Color\("cream"\)/);
  assert.doesNotMatch(start, /Color\.orange/);
  // The course list moved to Watch Home; holes → tees never repeats it.
  assert.doesNotMatch(start, /ForEach\(session\.nearby\.courses\)|session\.home\./);
  assert.match(header, /return "Holes"/);
  assert.match(header, /return "Tees"/);
  assert.doesNotMatch(header, /return "Courses near you"/);
  assert.match(header, /nearbyShowsFeedback/);
  assert.match(header, /session\.feedback != session\.nearby\.courseName/);
  assert.match(watchUi, /Text\(session\.showsNearby \? nearbyNavTitle/);
  assert.match(session, /nearby\.courseName = name/);
  const pickFn = session.slice(session.indexOf('func pickCourse'), session.indexOf('func pickTee'));
  assert.match(pickFn, /nearby\.courseName = name/);
  assert.match(session, /func pickCourse/);
});

test('build 26 locks stay: delete confirm, 60% map, one-line header, 600-yard tee start, 5s Undo, privacy strings', () => {
  const app = readFileSync(new URL('../../app.json', import.meta.url), 'utf8');
  assert.match(
    app,
    /NSLocationWhenInUseUsageDescription": "ShotTraxx™ uses your location while the app is open to find courses near you, show yards to the green, and mark where you hit from when you pick a club\./,
  );
  assert.match(app, /NSPhotoLibraryUsageDescription": "ShotTraxx™ does not use your photo library/);
  assert.match(app, /"locationAlwaysAndWhenInUsePermission": false/);
  assert.match(app, /"locationAlwaysPermission": false/);
  assert.match(app, /"isIosBackgroundLocationEnabled": false/);
  assert.match(app, /"motionUsagePermission": false/);
  assert.match(app, /"\.\/plugins\/withDisableExpoLocationMotion"/);
  assert.doesNotMatch(app, /NSLocationAlways/);
  assert.doesNotMatch(app, /NSMotionUsageDescription/);
  assert.doesNotMatch(app, /NSMicrophoneUsageDescription/);
  assert.doesNotMatch(app, /NSSpeechRecognitionUsageDescription/);
  assert.doesNotMatch(app, /RECORD_AUDIO/);
  assert.doesNotMatch(app, /expo-speech-recognition/);

  const watchPlist = readFileSync(new URL('../../targets/watch/Info.plist', import.meta.url), 'utf8');
  assert.match(
    watchPlist,
    /NSLocationWhenInUseUsageDescription[\s\S]*show yards to the green and mark where you hit from/,
  );
  assert.doesNotMatch(watchPlist, /NSMotionUsageDescription/);
  assert.doesNotMatch(watchPlist, /more accurate than the phone/);

  const hole = readFileSync(new URL('../../app/round/[id]/hole/[number].tsx', import.meta.url), 'utf8');
  assert.match(hole, /deleteShotPrompt/);
  assert.match(hole, /planConfirmUndo/);
  assert.match(hole, /formatPlayHeader/);
  assert.match(hole, /styles\.mapFill/);
  assert.match(hole, /planCourseCardCamera/);
  assert.doesNotMatch(hole, /lockHoleCamera/);
  assert.equal(COPY.deleteShotConfirm, 'Delete this shot?');
});
