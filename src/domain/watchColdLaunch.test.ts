import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  watchColdLaunchFace,
  watchGolfShouldStartActivity,
  watchGolfWorkoutEnd,
  watchMayCreateGolfWorkout,
} from './watchColdLaunch';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

test('a second golf workout is refused while recovery, launch, or a session is open', () => {
  const blocked = {
    launchGate: false,
    recovering: false,
    ending: false,
    creating: false,
    hasSession: false,
    sessionEnded: false,
  };
  assert.equal(watchMayCreateGolfWorkout(blocked), true);
  assert.equal(watchMayCreateGolfWorkout({ ...blocked, launchGate: true }), false);
  assert.equal(watchMayCreateGolfWorkout({ ...blocked, recovering: true }), false);
  assert.equal(watchMayCreateGolfWorkout({ ...blocked, ending: true }), false);
  assert.equal(watchMayCreateGolfWorkout({ ...blocked, creating: true }), false);
  assert.equal(watchMayCreateGolfWorkout({ ...blocked, hasSession: true, sessionEnded: false }), false);
  assert.equal(watchMayCreateGolfWorkout({ ...blocked, hasSession: true, sessionEnded: true }), true);
  // An ended session does not stay blocked when recovery is still in flight.
  assert.equal(
    watchMayCreateGolfWorkout({ ...blocked, recovering: true, hasSession: true, sessionEnded: true }),
    false,
  );

  assert.equal(watchGolfShouldStartActivity('prepared'), true);
  assert.equal(watchGolfShouldStartActivity('stopped'), true);
  assert.equal(watchGolfShouldStartActivity('notStarted'), true);
  assert.equal(watchGolfShouldStartActivity('other'), true);
  assert.equal(watchGolfShouldStartActivity('running'), false);
  assert.equal(watchGolfShouldStartActivity('paused'), false);
  assert.equal(watchGolfShouldStartActivity('ended'), false);
});

test('ending a workout at launch does not end nil, ended, or an in-flight session', () => {
  const idle = { hasSession: true, ended: false, runningOrPaused: true, endingThisSession: false };
  assert.equal(watchGolfWorkoutEnd({ ...idle, hasSession: false, runningOrPaused: false }), 'drop-nil');
  assert.equal(watchGolfWorkoutEnd({ ...idle, ended: true, runningOrPaused: false }), 'drop-ended');
  assert.equal(watchGolfWorkoutEnd({ ...idle, endingThisSession: true }), 'already-ending');
  assert.equal(watchGolfWorkoutEnd(idle), 'end');
  assert.equal(watchGolfWorkoutEnd({ ...idle, runningOrPaused: false }), 'skip-not-running');
  // Ended wins over a stale "already ending" flag so end() is not called again.
  assert.equal(
    watchGolfWorkoutEnd({ hasSession: true, ended: true, runningOrPaused: false, endingThisSession: true }),
    'drop-ended',
  );

  const session = read('targets/watch/WatchClubSession.swift');
  const action = session.slice(
    session.indexOf('func golfWorkoutEndAction'),
    session.indexOf('private func endGolfWorkout'),
  );
  assert.match(action, /if !hasSession \{ return \.dropNil \}/);
  assert.match(action, /if ended \{ return \.dropEnded \}/);
  assert.match(action, /if endingThisSession \{ return \.alreadyEnding \}/);
  assert.match(action, /if runningOrPaused \{ return \.end \}/);
  assert.match(action, /return \.skipNotRunning/);
  const endFn = session.slice(session.indexOf('private func endGolfWorkout'), session.indexOf('private func stopRoundStay'));
  assert.equal((endFn.match(/session\.end\(\)/g) ?? []).length, 1);
  const stop = session.slice(session.indexOf('private func stopRoundStay'), session.indexOf('func workoutSession'));
  assert.match(stop, /endGolfWorkout\(golfWorkout\)/);
  assert.doesNotMatch(stop, /session\.end\(\)/);
  const finish = session.slice(
    session.indexOf('func finishGolfWorkoutRecovery'),
    session.indexOf('activationDidCompleteWith'),
  );
  assert.match(finish, /session\.state == \.ended/);
  assert.doesNotMatch(finish, /created\.end\(\)/);
  assert.match(finish, /endGolfWorkout\(created\)/);
  const app = read('targets/watch/index.swift');
  const recovery = app.slice(app.indexOf('func handleActiveWorkoutRecovery'), app.indexOf('@main'));
  const call = recovery.indexOf('recoverActiveWorkoutSession {');
  const hopped = recovery.slice(call);
  assert.ok(call >= 0);
  assert.ok(hopped.indexOf('DispatchQueue.main.async') >= 0);
  assert.ok(hopped.indexOf('DispatchQueue.main.async') < hopped.indexOf('finishGolfWorkoutRecovery'));
});

test('cold open face is hole, round complete, or home without a trap', () => {
  assert.equal(
    watchColdLaunchFace({ showsHome: false, showsNearby: false, roundComplete: false, puttOpen: false }),
    'hole',
  );
  assert.equal(
    watchColdLaunchFace({ showsHome: false, showsNearby: false, roundComplete: true, puttOpen: false }),
    'roundComplete',
  );
  assert.equal(
    watchColdLaunchFace({ showsHome: true, showsNearby: true, roundComplete: true, puttOpen: false }),
    'home',
  );
  assert.equal(
    watchColdLaunchFace({ showsHome: false, showsNearby: false, roundComplete: false, puttOpen: true }),
    'putt',
  );

  const content = read('targets/watch/content.swift');
  const body = content.slice(content.indexOf('var body: some View'), content.indexOf('private var watchHome'));
  const homeAt = body.indexOf('if session.showsHome');
  const nearbyAt = body.indexOf('else if session.showsNearby');
  const doneAt = body.indexOf('else if session.list.roundComplete && !session.putt.open');
  const puttAt = body.indexOf('else if session.putt.open');
  assert.ok(homeAt >= 0 && nearbyAt > homeAt && doneAt > nearbyAt && puttAt > doneAt);
  const roundComplete = content.slice(content.indexOf('private var roundComplete'), content.indexOf('private func carryFromLabel'));
  assert.doesNotMatch(roundComplete, /fatalError|preconditionFailure|as!|try!|\[\d+\]/);
});

test('Watch cold launch loads defaults before WCSession and applies context on main', () => {
  const session = read('targets/watch/WatchClubSession.swift');
  const app = read('targets/watch/index.swift');

  const initFn = session.slice(session.indexOf('override init()'), session.indexOf('var appLiveYardsTrusted'));
  const loadAt = initFn.indexOf('loadFromDefaults()');
  const holdAt = initFn.indexOf('holdWorkoutLaunchGate()');
  const stayAt = initFn.indexOf('syncRoundStay()');
  const activateAt = initFn.indexOf('session.activate()');
  const releaseAt = initFn.indexOf('scheduleWorkoutLaunchGateRelease()');
  assert.ok(loadAt >= 0 && holdAt > loadAt && stayAt > holdAt && activateAt > stayAt && releaseAt > activateAt);
  assert.equal(initFn.indexOf('session.activate()'), activateAt);
  assert.doesNotMatch(initFn, /requestWhenInUseAuthorization/);

  const activate = session.slice(
    session.indexOf('activationDidCompleteWith'),
    session.indexOf('didReceiveApplicationContext'),
  );
  const hop = activate.indexOf('DispatchQueue.main.async');
  assert.ok(hop >= 0);
  assert.equal(activate.slice(0, hop).includes('applyClubList('), false);
  assert.ok(activate.indexOf('applyClubList(') > hop);
  assert.ok(activate.indexOf('flushPending()') > hop);
  assert.ok(activate.indexOf('syncRoundStay()') > hop);
  assert.match(activate, /awaitingSelect = true/);
  assert.doesNotMatch(activate, /requestNearby/);

  const may = session.slice(session.indexOf('func mayCreateGolfWorkout'), session.indexOf('private func beginGolfWorkoutSession'));
  assert.match(may, /if launchGate \|\| recovering \|\| ending \|\| creating \{ return false \}/);
  assert.match(may, /if hasSession && !sessionEnded \{ return false \}/);

  const begin = session.slice(session.indexOf('private func beginGolfWorkoutSession'), session.indexOf('private func stopRoundStay'));
  assert.match(begin, /mayCreateGolfWorkout/);
  assert.match(begin, /recoveringGolfWorkout/);
  assert.match(begin, /golf workout not started; recoverActiveWorkoutSession in progress/);
  assert.match(begin, /golf workout not started; a session is already running/);
  assert.match(begin, /try HKWorkoutSession/);
  assert.match(begin, /catch \{/);
  const startAt = begin.indexOf('session.startActivity(with: Date())');
  const runningAt = begin.indexOf('session.state == .running || session.state == .paused');
  const endedAt = begin.indexOf('session.state == .ended');
  assert.ok(begin.indexOf('try HKWorkoutSession') < startAt);
  assert.ok(runningAt >= 0 && runningAt < startAt);
  assert.ok(endedAt >= 0 && endedAt < startAt);
  assert.equal((begin.match(/startActivity\(with:/g) ?? []).length, 1);

  const recovery = app.slice(app.indexOf('func handleActiveWorkoutRecovery'), app.indexOf('@main'));
  assert.ok(recovery.indexOf('beginGolfWorkoutRecovery()') < recovery.indexOf('recoverActiveWorkoutSession {'));
  assert.ok(recovery.indexOf('isHealthDataAvailable()') < recovery.indexOf('recoverActiveWorkoutSession {'));
  assert.match(recovery, /finishGolfWorkoutRecovery/);
  assert.match(app, /_ = WatchClubSession\.shared/);
  const appInit = app.slice(app.indexOf('init() {'), app.indexOf('var body: some Scene'));
  assert.doesNotMatch(appInit, /splashDidFinish|requestWhenInUseAuthorization/);

  const enables = session.match(/allowsBackgroundLocationUpdates = true/g) ?? [];
  assert.equal(enables.length, 1);
  const enable = session.slice(
    session.indexOf('private func enableWorkoutBackgroundLocation'),
    session.indexOf('private func disableWorkoutBackgroundLocation'),
  );
  assert.ok(enable.indexOf('hasBackgroundLocationMode') < enable.indexOf('allowsBackgroundLocationUpdates = true'));
});

test('every delegate callback hops before it touches session state', () => {
  const session = read('targets/watch/WatchClubSession.swift');
  const app = read('targets/watch/index.swift');
  const methods = [
    'func workoutSession(\n    _ workoutSession: HKWorkoutSession,\n    didChangeTo',
    'func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError',
    'func session(_ session: WCSession, activationDidCompleteWith',
    'func session(_ session: WCSession, didReceiveApplicationContext',
    'func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {',
    'didReceiveMessage message: [String: Any],\n    replyHandler:',
    'func session(_ session: WCSession, didReceiveUserInfo',
    'func session(_ session: WCSession, didFinish userInfoTransfer:',
    'func session(_ session: WCSession, didReceive file:',
    'func session(_ session: WCSession, didFinish fileTransfer:',
    'func sessionReachabilityDidChange',
    'func locationManagerDidChangeAuthorization',
    'func locationManager(_: CLLocationManager, didFailWithError',
    'func locationManager(_ manager: CLLocationManager, didUpdateLocations',
  ];
  const stateTouch = /self\.|applyClubList\(|applyWatchAck\(|applyWatchHome\(|flushPending\(|syncRoundStay\(|adoptWatchFix\(|lastFix\s*=|replyHandler\(/;
  for (let i = 0; i < methods.length; i++) {
    const start = session.indexOf(methods[i]);
    assert.ok(start >= 0, methods[i]);
    const end =
      i + 1 < methods.length
        ? session.indexOf(methods[i + 1], start + methods[i].length)
        : session.indexOf('func noteScenePhase', start);
    assert.ok(end > start, methods[i]);
    const body = session.slice(start, end);
    const hop = body.indexOf('DispatchQueue.main.async');
    assert.ok(hop >= 0, methods[i]);
    const before = body
      .slice(0, hop)
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');
    assert.equal(stateTouch.test(before), false, methods[i]);
  }

  const reply = session.slice(
    session.indexOf('didReceiveMessage message: [String: Any],\n    replyHandler:'),
    session.indexOf('func session(_ session: WCSession, didReceiveUserInfo'),
  );
  const replyHop = reply.indexOf('DispatchQueue.main.async');
  assert.ok(reply.indexOf('applyClubList(') > replyHop);
  assert.ok(reply.indexOf('replyHandler([:])') > replyHop);
  assert.equal(session.includes('DispatchQueue.main.sync'), false);
  assert.equal(app.includes('DispatchQueue.main.sync'), false);
  assert.match(session, /transferCurrentComplicationUserInfo/);
  assert.doesNotMatch(session, /func session\(_ session: WCSession, didReceiveComplicationUserInfo/);

  const mutators = [
    'private func applyWatchAck',
    'private func handleReply',
    'private func applyNearbyCourses',
    'private func applyWatchHome',
    'private func applyNearbyTees',
    'private func applyClubList',
    'private func applyPuttSheet',
    'private func adoptWatchFix',
    'private func flushPending',
    'private func syncRoundStay',
  ];
  for (const name of mutators) {
    const start = session.indexOf(name);
    assert.ok(start >= 0, name);
    const head = session.slice(start, start + 280);
    const brace = head.indexOf('{');
    const call = head.indexOf('requireMainForPublishedState()');
    assert.ok(brace >= 0 && call > brace, name);
  }
  assert.match(session, /dispatchPrecondition\(condition: \.onQueue\(\.main\)\)/);

  const drain = session.slice(session.indexOf('static func drainConnectivity'), session.indexOf('@Published var list'));
  assert.match(drain, /await MainActor\.run/);
  assert.doesNotMatch(drain, /applyClubList\(/);
  assert.match(app, /await WatchClubSession\.drainConnectivity\(\)/);
});
