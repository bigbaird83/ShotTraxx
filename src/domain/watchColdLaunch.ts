/**
 * Cold-launch guards for the Watch app.
 * Mirrors `WatchClubSession.mayCreateGolfWorkout` and the `startActivity`
 * state check in targets/watch/WatchClubSession.swift.
 *
 * Activation applies receivedApplicationContext on every cold launch
 * (live round, round just ended, or no round). That used to happen off the
 * main thread while init and the first body read the same state.
 * A second HKWorkoutSession throws. end() raises unless the session is
 * running or paused, and a second end() of the same object raises too.
 */

export function watchMayCreateGolfWorkout(args: {
  launchGate: boolean;
  recovering: boolean;
  ending: boolean;
  creating: boolean;
  hasSession: boolean;
  sessionEnded: boolean;
}): boolean {
  if (args.launchGate || args.recovering || args.ending || args.creating) return false;
  if (args.hasSession && !args.sessionEnded) return false;
  return true;
}

/** States where `HKWorkoutSession.startActivity` is safe to call once. */
export type WatchGolfActivityState = 'prepared' | 'stopped' | 'notStarted' | 'running' | 'paused' | 'ended' | 'other';

export function watchGolfShouldStartActivity(state: WatchGolfActivityState): boolean {
  return state !== 'running' && state !== 'paused' && state !== 'ended';
}

/**
 * `HKWorkoutSession.end()` raises unless the session is running or paused,
 * and a second end() of the same object raises too. Nil and already-ended
 * sessions are dropped. Mirrors `golfWorkoutEndAction` in WatchClubSession.
 */
export type WatchGolfWorkoutEnd = 'drop-nil' | 'drop-ended' | 'already-ending' | 'end' | 'skip-not-running';

export function watchGolfWorkoutEnd(args: {
  hasSession: boolean;
  ended: boolean;
  runningOrPaused: boolean;
  endingThisSession: boolean;
}): WatchGolfWorkoutEnd {
  if (!args.hasSession) return 'drop-nil';
  if (args.ended) return 'drop-ended';
  if (args.endingThisSession) return 'already-ending';
  if (args.runningOrPaused) return 'end';
  return 'skip-not-running';
}

/** First screen on a cold open. Same order as `ContentView.body`. */
export type WatchColdLaunchFace = 'home' | 'nearby' | 'roundComplete' | 'putt' | 'hole';

export function watchColdLaunchFace(args: {
  showsHome: boolean;
  showsNearby: boolean;
  roundComplete: boolean;
  puttOpen: boolean;
}): WatchColdLaunchFace {
  if (args.showsHome) return 'home';
  if (args.showsNearby) return 'nearby';
  if (args.roundComplete && !args.puttOpen) return 'roundComplete';
  if (args.puttOpen) return 'putt';
  return 'hole';
}
