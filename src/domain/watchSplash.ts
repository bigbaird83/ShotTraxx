/** Launch clip. A background process start must not play or time it out. */

export type WatchSplashScene = 'active' | 'inactive' | 'background';

/**
 * Background and inactive do not start the clip. The first active scene does.
 * After playback has started, leaving active dismisses it and it does not replay.
 * A fresh live round skips it.
 */
export function watchSplashPlayback(args: {
  scene: WatchSplashScene;
  /** AVPlayer / Reduce Motion hold has begun this process. */
  started: boolean;
  liveHoleInProgress: boolean;
}): 'skip-live' | 'pending' | 'start' | 'dismiss-left' | 'playing' {
  if (args.liveHoleInProgress && !args.started) return 'skip-live';
  if (!args.started) return args.scene === 'active' ? 'start' : 'pending';
  if (args.scene !== 'active') return 'dismiss-left';
  return 'playing';
}

/**
 * Logo still on screen. True from the first frame while the clip is still due,
 * including before the scene is active (playback is separate). Also true while
 * the scene is inactive or background and there is no fresh live round, so the
 * system snapshot is the logo. Active with the clip already finished is the
 * app underneath. A fresh live round never covers.
 */
export function watchLaunchCoverVisible(args: {
  scene: WatchSplashScene;
  /** Clip has not finished, been skipped, or been dismissed this process. */
  splashDue: boolean;
  liveHoleInProgress: boolean;
}): boolean {
  if (args.liveHoleInProgress) return false;
  if (args.splashDue) return true;
  return args.scene !== 'active';
}

export type WatchPlayerItemStatus = 'unknown' | 'readyToPlay' | 'failed';
export type WatchTimeControlStatus = 'paused' | 'waiting' | 'playing';

/**
 * play() waits until the item is ready and the scene is active.
 * A failed item dismisses. A second call does not play again.
 */
export function watchSplashPlayGate(args: {
  scene: WatchSplashScene;
  itemStatus: WatchPlayerItemStatus;
  playCalled: boolean;
}): 'wait' | 'play' | 'failed' {
  if (args.itemStatus === 'failed') return 'failed';
  if (args.playCalled) return 'wait';
  if (args.scene === 'active' && args.itemStatus === 'readyToPlay') return 'play';
  return 'wait';
}

/** One more play() if the clock is not playing yet. */
export function watchSplashShouldReplay(args: {
  timeControlStatus: WatchTimeControlStatus;
  retried: boolean;
}): boolean {
  if (args.retried) return false;
  return args.timeControlStatus !== 'playing';
}

/**
 * The clip picture is up only after `timeControlStatus == .playing` has settled.
 * Until then, whenever playback stops, and again once the splash is dismissing,
 * the logo covers VideoPlayer so watchOS transport chrome is not on screen.
 * Mirrors `videoVisible` / `revealSettleNanoseconds`.
 */
export function watchSplashVideoShown(args: {
  playing: boolean;
  settled: boolean;
  dismissing: boolean;
}): boolean {
  return args.playing && args.settled && !args.dismissing;
}

/** After playback is observed, wait so the first decoded frame is up. Mirrors `revealSettleNanoseconds`. */
export const WATCH_SPLASH_REVEAL_SETTLE_NS = 150_000_000;

/** The 5 s safety clock starts when the clip is actually moving. Mirrors `safetyNanoseconds`. */
export const WATCH_SPLASH_SAFETY_NS = 5_000_000_000;

export function watchSplashSafetyStarts(timeControlStatus: WatchTimeControlStatus, safetyStarted: boolean): boolean {
  return timeControlStatus === 'playing' && !safetyStarted;
}

/**
 * Hard ceiling from the first active playback attempt. Mirrors `stallNanoseconds`.
 * Independent of item status. Does not start in the background or for Reduce Motion.
 * Once dismissing, the timer is ignored.
 */
export const WATCH_SPLASH_STALL_NS = 6_000_000_000;

export function watchSplashStallCeilingStarts(args: {
  scene: WatchSplashScene;
  /** `run()` has begun. That only happens after the first active scene. */
  playbackStarted: boolean;
  reduceMotion: boolean;
  dismissing: boolean;
}): boolean {
  if (!args.playbackStarted || args.reduceMotion || args.dismissing) return false;
  return args.scene === 'active';
}

/**
 * When In Use waits while the splash overlay is up so the system sheet does
 * not cover the clip. A fresh live round skips the splash, so it does not wait.
 */
export function watchLocationAuthorizationWaitsForSplash(args: {
  splashShowing: boolean;
  liveHoleInProgress: boolean;
}): boolean {
  if (args.liveHoleInProgress) return false;
  return args.splashShowing;
}
