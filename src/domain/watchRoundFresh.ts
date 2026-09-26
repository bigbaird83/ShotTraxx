import type { ClubListMessage } from './watchMessages';

/**
 * Saved Watch club-list flags do not keep a golf workout up.
 * Mirrors `roundFreshWindow` in targets/watch/WatchClubSession.swift (30 minutes).
 * A phone `complicationAt` (`liveAtMs`) this recent still counts after relaunch.
 */
export const WATCH_ROUND_FRESH_MS = 30 * 60 * 1000;

export function watchRoundIsFresh(args: {
  /** Live club list (roundLive, not complete) delivered by WatchConnectivity this process. */
  receivedLiveListThisLaunch: boolean;
  /** Phone `complicationAt` persisted as `liveAtMs`. 0 means none. */
  liveAtMs: number;
  nowMs: number;
}): boolean {
  if (args.receivedLiveListThisLaunch) return true;
  if (!Number.isFinite(args.liveAtMs) || args.liveAtMs <= 0) return false;
  if (!Number.isFinite(args.nowMs)) return false;
  // A timestamp slightly ahead of the watch still counts. Only age past the window is stale.
  return args.nowMs - args.liveAtMs <= WATCH_ROUND_FRESH_MS;
}

/** Same live-hole gate as `shouldWatchStayFrontmost`, plus freshness. */
export function watchShouldStartRoundWorkout(args: {
  hasLiveHole: boolean;
  puttOpen: boolean;
  userLeftApp?: boolean;
  roundLive?: boolean;
  roundComplete?: boolean;
  roundIsFresh: boolean;
}): boolean {
  if (!args.roundIsFresh) return false;
  if (args.userLeftApp) return false;
  if (args.roundLive === false) return false;
  return (args.hasLiveHole && args.roundComplete !== true) || args.puttOpen;
}

/**
 * Watch Home "Continue · Hole". A round-end list and a stale saved list still
 * have a bag, so `hasLiveHole` alone is not enough. Home/Back (`userLeftApp`)
 * does not hide Continue during a real live round.
 */
export function watchCanContinueRound(args: {
  roundLive: boolean;
  roundComplete: boolean;
  hasLiveHole: boolean;
  roundIsFresh: boolean;
  userLeftApp?: boolean;
}): boolean {
  return args.roundLive && !args.roundComplete && args.hasLiveHole && args.roundIsFresh;
}

/** Splash skip and hole-follow location use this. A stale saved round plays the clip. */
export function watchLiveHoleInProgress(args: {
  hasLiveHole: boolean;
  puttOpen: boolean;
  userLeftApp?: boolean;
  roundLive?: boolean;
  roundComplete?: boolean;
  roundIsFresh: boolean;
}): boolean {
  return watchShouldStartRoundWorkout(args);
}

/**
 * Cold-open face. Home unless this is a real live round, or a round-end
 * message already applied in this process. A saved Round complete is not a
 * live round (`liveHoleInProgress` is false) and must not be the first screen.
 * Mirrors `settleLaunchFace` in targets/watch/WatchClubSession.swift.
 */
export function watchColdOpenShowsHome(args: {
  liveHoleInProgress: boolean;
  roundEndedByMessage: boolean;
}): boolean {
  if (args.roundEndedByMessage) return false;
  return !args.liveHoleInProgress;
}

/**
 * Launch log when a saved list is skipped. Null when there is nothing to skip
 * (no list, or the list is a real live round and we are not skipping it).
 * Mirrors `logSavedRoundHomeSkipIfNeeded`.
 */
export function watchSavedRoundSkipReason(args: {
  hasSavedRound: boolean;
  roundComplete: boolean;
  roundLooksLive: boolean;
  roundIsFresh: boolean;
}): 'complete' | 'stale' | null {
  if (!args.hasSavedRound) return null;
  if (args.roundComplete) return 'complete';
  if (args.roundLooksLive && !args.roundIsFresh) return 'stale';
  return null;
}

/** Recovered HKWorkoutSession: keep it only while the round is fresh. */
export function watchRecoveredWorkoutAction(roundIsFresh: boolean): 'keep' | 'end' {
  return roundIsFresh ? 'keep' : 'end';
}

/**
 * A lower listSeq is normally a late delivery and is dropped. An explicit round
 * end still applies when this launch has not accepted a live list, so a phone
 * relaunch (listSeq starts at 0) can clear a saved round. A live list already
 * accepted this launch keeps the seq gate, so a late end cannot stop it.
 */
export function watchRoundEndOverridesStaleSeq(args: {
  currentSeq: number;
  incomingSeq: number;
  roundLive: boolean;
  roundComplete: boolean;
  receivedLiveListThisLaunch: boolean;
}): boolean {
  const stale = args.currentSeq > 0 && args.incomingSeq < args.currentSeq;
  if (!stale) return false;
  return args.roundLive === false && args.roundComplete === true && !args.receivedLiveListThisLaunch;
}

/**
 * Phone → Watch when no round is open. Same shape as `endWatchRound` with no
 * previous club list. Does not set the phone's ended-round latch.
 */
export function watchRoundEndedClubList(): ClubListMessage {
  return {
    type: 'clubList',
    top3: [],
    bag: [],
    labels: {},
    holeNumber: 1,
    yardsToGreen: null,
    yardsQuality: 'none',
    roundComplete: true,
    roundLive: false,
    shotCount: 0,
    lastShotId: '',
    lastShotClubId: '',
  };
}

/**
 * One `roundLive: false` push per idle stretch, on launch or foreground.
 * An open round resets the latch so the next idle stretch can clear again.
 * A mounted hole screen blocks the push. It does not reset the latch unless
 * that round is the active one (`activeRound`).
 */
export function nextStaleWatchRoundClear(args: {
  sentWhileIdle: boolean;
  activeRound: boolean;
  holeContextMounted: boolean;
  event: 'launch' | 'foreground';
}): { sentWhileIdle: boolean; send: boolean } {
  if (args.event !== 'launch' && args.event !== 'foreground') {
    return { sentWhileIdle: args.sentWhileIdle, send: false };
  }
  if (args.activeRound || args.holeContextMounted) {
    return { sentWhileIdle: args.activeRound ? false : args.sentWhileIdle, send: false };
  }
  if (args.sentWhileIdle) return { sentWhileIdle: true, send: false };
  return { sentWhileIdle: true, send: true };
}
