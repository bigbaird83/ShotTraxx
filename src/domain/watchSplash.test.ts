import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  watchLaunchCoverVisible,
  watchLocationAuthorizationWaitsForSplash,
  watchSplashPlayGate,
  watchSplashPlayback,
  watchSplashVideoShown,
  WATCH_SPLASH_REVEAL_SETTLE_NS,
  WATCH_SPLASH_SAFETY_NS,
  WATCH_SPLASH_STALL_NS,
  watchSplashSafetyStarts,
  watchSplashShouldReplay,
  watchSplashStallCeilingStarts,
} from './watchSplash';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

test('Watch splash clip ships in the Watch target with no audio track', () => {
  const clip = readFileSync(new URL('targets/watch/WatchSplash.mov', root));
  assert.ok(clip.length > 0);
  assert.ok(clip.length < 2_000_000, 'keep the Watch bundle small');
  assert.equal(clip.subarray(4, 8).toString('latin1'), 'ftyp');
  assert.equal(clip.includes(Buffer.from('avc1')), true);
  // Handler type for an audio track. Stripped so the splash never touches audio.
  assert.equal(clip.includes(Buffer.from('soun')), false);
});

test('Watch splash plays over the app on cold start and never blocks it', () => {
  const app = read('targets/watch/index.swift');
  // Skipped on a relaunch mid-round, and cut short if a round goes live.
  assert.match(app, /@State private var splashDue = !WatchClubSession\.shared\.liveHoleInProgress/);
  assert.match(app, /onChange\(of: session\.liveHoleInProgress\) \{ _, live in\s*[^}]*if live \{\s*[^}]*skipSplashForLiveRound\(\)/);
  const session = read('targets/watch/WatchClubSession.swift');
  assert.match(session, /var liveHoleInProgress: Bool \{\n    roundLooksLive && roundIsFresh/);
  assert.match(session, /var roundLooksLive: Bool \{\n    !userLeftApp && list\.roundLive && \(\(hasLiveHole && !list\.roundComplete\) \|\| putt\.open\)/);
  assert.match(app, /@Environment\(\\\.scenePhase\) private var scenePhase/);
  assert.match(app, /ZStack \{\s*ContentView\(\)[\s\S]*if showLaunchCover \{\s*if splashDue \{\s*WatchSplash\(scenePhase: scenePhase\)/);
  assert.match(app, /WatchSplashCover\(\)/);
  assert.match(app, /backgroundTask\(\.snapshot\)/);
  assert.match(app, /raiseSnapshotCover\(\)/);
  assert.match(app, /SnapshotResponse\(\s*restoredDefaultState: true/);
  const coverRule = app.slice(app.indexOf('private var showLaunchCover'), app.indexOf('var body: some View'));
  assert.match(coverRule, /if session\.liveHoleInProgress \{ return false \}/);
  assert.match(coverRule, /if splashDue \{ return true \}/);
  assert.match(coverRule, /if scenePhase != \.active \{ return true \}/);
  assert.ok(coverRule.indexOf('if splashDue { return true }') < coverRule.indexOf('if scenePhase != .active { return true }'));
  assert.match(coverRule, /return false/);

  const splash = read('targets/watch/WatchSplash.swift');
  assert.match(splash, /static let resource = "WatchSplash"/);
  assert.match(splash, /static let fileExtension = "mov"/);
  assert.match(splash, /static let firstFrame = "WatchSplashFirstFrame"/);
  assert.match(splash, /isMuted = true/);
  // Contain on the Watch too — never fill or crop the owner art.
  assert.match(splash, /contentMode: \.fit/);
  assert.doesNotMatch(splash, /contentMode: \.fill/);
  // Tap skips; end, failure, missing file and a safety timeout all dismiss.
  assert.match(splash, /onTapGesture \{ dismiss\(fade: true, reason: "tap"\) \}/);
  assert.match(splash, /AVPlayerItemDidPlayToEndTime/);
  assert.match(splash, /AVPlayerItemFailedToPlayToEndTime/);
  assert.match(splash, /safetyNanoseconds/);
  assert.match(splash, /accessibilityReduceMotion/);
  assert.match(splash, /reduceMotionNanoseconds: UInt64 = 1_200_000_000/);
  assert.match(splash, /splash pending \(scene not active\)/);
  assert.match(splash, /playback started/);
  assert.match(splash, /resource missing/);
  assert.match(splash, /reduce motion still/);
  assert.match(app, /skipped for live round/);
  assert.match(splash, /dismissed \(reason:/);
  assert.match(splash, /reason: "scene left"/);
  assert.match(splash, /reason: "safety"/);
  assert.match(splash, /reason: "failed"/);
  assert.match(splash, /reason: "ended"/);
  // Player and timers start only after the scene is active.
  const apply = splash.slice(splash.indexOf('private func applyPhase'), splash.indexOf('private func run'));
  assert.match(apply, /phase == \.active/);
  assert.ok(apply.indexOf('playbackStarted = true') > apply.indexOf('phase == .active'));
  assert.match(apply, /splash pending/);
  const run = splash.slice(splash.indexOf('private func run'), splash.indexOf('private func tryStart'));
  assert.doesNotMatch(run, /safetyNanoseconds/);
  assert.doesNotMatch(run, /player\.play\(\)/);
  const tryStart = splash.slice(splash.indexOf('private func tryStart'), splash.indexOf('private func startSafety'));
  assert.match(tryStart, /guard box\.sceneActive else \{ return \}/);
  assert.match(tryStart, /guard box\.item\.status == \.readyToPlay else \{ return \}/);
  assert.ok(tryStart.indexOf('sceneActive') < tryStart.indexOf('player.play()'));
  assert.ok(tryStart.indexOf('readyToPlay') < tryStart.indexOf('player.play()'));
  assert.match(tryStart, /300_000_000/);
  assert.match(tryStart, /timeControlStatus != \.playing/);
  const safety = splash.slice(splash.indexOf('private func startSafety'), splash.indexOf('private func logPlayback'));
  assert.match(safety, /playback started/);
  assert.match(safety, /safetyNanoseconds/);
  assert.ok(safety.indexOf('playback started') < safety.indexOf('safetyNanoseconds'));
  assert.match(splash, /status=/);
  assert.match(splash, /timeControlStatus=/);
  assert.match(splash, /reasonForWaitingToPlay/);
  assert.match(splash, /item\.error/);
  assert.match(splash, /392×584/);
  assert.match(splash, /392\.0 \/ 584\.0/);
  assert.match(splash, /static let poster: UIImage = loadPoster\(\) \?\? UIImage\(\)/);
  assert.match(splash, /struct WatchSplashCover/);
  assert.match(splash, /Image\(uiImage: poster\)/);
  assert.match(splash, /VideoPlayer\(player: player\)/);
  assert.match(splash, /concealedPlayerOpacity = 0\.001/);
  assert.match(splash, /allowsHitTesting\(false\)/);
  assert.match(splash, /revealSettleNanoseconds: UInt64 = 150_000_000/);
  // Logo cover is in the file before the player view, and on top of it in the stack
  // until playback has settled. The player is never the top view while paused.
  assert.ok(splash.indexOf('Image(uiImage: poster)') < splash.indexOf('VideoPlayer(player: player)'));
  const stack = splash.slice(splash.indexOf('var body: some View'), splash.indexOf('.onTapGesture'));
  assert.ok(stack.indexOf('VideoPlayer(player: player)') < stack.indexOf('WatchSplashCover()'));
  assert.match(stack, /if !videoVisible/);
  assert.match(stack, /opacity\(videoVisible \? 1 : WatchSplashClip\.concealedPlayerOpacity\)/);
  const control = splash.slice(splash.indexOf('case .control'), splash.indexOf('case .sceneActive'));
  assert.match(control, /control == \.playing/);
  assert.ok(control.indexOf('armReveal()') > control.indexOf('control == .playing'));
  assert.match(control, /concealPlayback\(\)/);
  const dismissFn = splash.slice(splash.indexOf('private func dismiss'), splash.indexOf('private func armReveal'));
  assert.ok(dismissFn.indexOf('concealPlayback()') < dismissFn.indexOf('player?.pause()'));
  assert.ok(dismissFn.indexOf('player?.pause()') < dismissFn.indexOf('opacity = 0'));
  const appear = splash.slice(splash.indexOf('.onAppear'), splash.indexOf('.onChange(of: scenePhase)'));
  assert.doesNotMatch(appear, /loadPoster|poster =/);
  assert.doesNotMatch(splash, /@State private var poster/);
});

test('background launch does not start the splash until the first active scene', () => {
  assert.equal(
    watchSplashPlayback({ scene: 'background', started: false, liveHoleInProgress: false }),
    'pending',
  );
  assert.equal(
    watchSplashPlayback({ scene: 'inactive', started: false, liveHoleInProgress: false }),
    'pending',
  );
  assert.equal(
    watchSplashPlayback({ scene: 'active', started: false, liveHoleInProgress: false }),
    'start',
  );
  assert.equal(
    watchSplashPlayback({ scene: 'active', started: true, liveHoleInProgress: false }),
    'playing',
  );
  assert.equal(
    watchSplashPlayback({ scene: 'background', started: true, liveHoleInProgress: false }),
    'dismiss-left',
  );
  assert.equal(
    watchSplashPlayback({ scene: 'inactive', started: true, liveHoleInProgress: false }),
    'dismiss-left',
  );
  // A later active does not start it again once it has been dismissed by leaving.
  assert.equal(
    watchSplashPlayback({ scene: 'active', started: true, liveHoleInProgress: false }),
    'playing',
  );
});

test('the logo cover is up before playback, and the snapshot is the logo unless a live round is on the hole', () => {
  assert.equal(
    watchLaunchCoverVisible({ scene: 'background', splashDue: true, liveHoleInProgress: false }),
    true,
  );
  assert.equal(
    watchLaunchCoverVisible({ scene: 'inactive', splashDue: true, liveHoleInProgress: false }),
    true,
  );
  assert.equal(
    watchLaunchCoverVisible({ scene: 'active', splashDue: true, liveHoleInProgress: false }),
    true,
  );
  assert.equal(
    watchSplashPlayback({ scene: 'background', started: false, liveHoleInProgress: false }),
    'pending',
  );
  assert.equal(
    watchLaunchCoverVisible({ scene: 'background', splashDue: false, liveHoleInProgress: false }),
    true,
  );
  assert.equal(
    watchLaunchCoverVisible({ scene: 'inactive', splashDue: false, liveHoleInProgress: false }),
    true,
  );
  assert.equal(
    watchLaunchCoverVisible({ scene: 'active', splashDue: false, liveHoleInProgress: false }),
    false,
  );
  assert.equal(
    watchLaunchCoverVisible({ scene: 'active', splashDue: true, liveHoleInProgress: true }),
    false,
  );
  assert.equal(
    watchLaunchCoverVisible({ scene: 'background', splashDue: false, liveHoleInProgress: true }),
    false,
  );
  assert.equal(
    watchLaunchCoverVisible({ scene: 'background', splashDue: true, liveHoleInProgress: true }),
    false,
  );

  const session = read('targets/watch/WatchClubSession.swift');
  const raise = session.slice(session.indexOf('func raiseSnapshotCover'), session.indexOf('func lowerSnapshotCover'));
  assert.match(raise, /guard !liveHoleInProgress else \{ return \}/);
  assert.match(raise, /snapshot cover/);
  const app = read('targets/watch/index.swift');
  assert.match(app, /phase == \.active \{\s*session\.lowerSnapshotCover\(\)/);
  assert.match(app, /session\.raiseSnapshotCover\(\)/);
});

test('a fresh live round skips the splash and does not hold the location prompt', () => {
  assert.equal(
    watchSplashPlayback({ scene: 'active', started: false, liveHoleInProgress: true }),
    'skip-live',
  );
  assert.equal(
    watchSplashPlayback({ scene: 'background', started: false, liveHoleInProgress: true }),
    'skip-live',
  );
  assert.equal(watchLocationAuthorizationWaitsForSplash({ splashShowing: true, liveHoleInProgress: false }), true);
  assert.equal(watchLocationAuthorizationWaitsForSplash({ splashShowing: false, liveHoleInProgress: false }), false);
  assert.equal(watchLocationAuthorizationWaitsForSplash({ splashShowing: true, liveHoleInProgress: true }), false);
  assert.equal(watchLocationAuthorizationWaitsForSplash({ splashShowing: false, liveHoleInProgress: true }), false);

  const app = read('targets/watch/index.swift');
  const session = read('targets/watch/WatchClubSession.swift');
  assert.match(app, /if !WatchClubSession\.shared\.liveHoleInProgress \{\s*WatchClubSession\.shared\.prepareLaunchSplash\(\)/);
  const ask = session.slice(
    session.indexOf('private func requestLiveLocationAuthorizationIfNeeded'),
    session.indexOf('private func syncLiveLocation'),
  );
  assert.match(ask, /guard !splashShowing else/);
  assert.ok(ask.indexOf('guard !splashShowing else') < ask.indexOf('location.requestWhenInUseAuthorization()'));
  assert.doesNotMatch(ask, /requestAuthorization\(toShare:/);
  const finish = session.slice(session.indexOf('func splashDidFinish'), session.indexOf('private func requestLiveLocationAuthorizationIfNeeded'));
  assert.match(finish, /splashShowing = false/);
  assert.match(finish, /requestLiveLocationAuthorizationIfNeeded\(\)/);
  const png = readFileSync(
    new URL('targets/watch/Assets.xcassets/WatchSplashFirstFrame.imageset/WatchSplashFirstFrame.png', root),
  );
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  // Contained on the largest Apple Watch screen (Ultra 3, 422×514). Same aspect as the 392×584 clip.
  assert.equal(png.readUInt32BE(16), 345);
  assert.equal(png.readUInt32BE(20), 514);
  assert.equal(png[24], 8);
  assert.equal(png[25], 2);
  assert.ok(png.length < 150_000, `poster is ${png.length} bytes`);
  assert.ok(Math.abs(345 / 514 - 392 / 584) < 0.001);
  assert.equal(existsSync(new URL('targets/watch/WatchSplashFirstFrame.png', root)), false);
  const catalog = read('targets/watch/Assets.xcassets/WatchSplashFirstFrame.imageset/Contents.json');
  assert.match(catalog, /WatchSplashFirstFrame\.png/);
  assert.match(read('targets/watch/WatchSplash.swift'), /UIImage\(named: firstFrame\)/);
});

test('play() waits for a ready item and an active scene; safety starts when the clip is moving', () => {
  assert.equal(watchSplashPlayGate({ scene: 'active', itemStatus: 'unknown', playCalled: false }), 'wait');
  assert.equal(watchSplashPlayGate({ scene: 'background', itemStatus: 'readyToPlay', playCalled: false }), 'wait');
  assert.equal(watchSplashPlayGate({ scene: 'inactive', itemStatus: 'readyToPlay', playCalled: false }), 'wait');
  assert.equal(watchSplashPlayGate({ scene: 'active', itemStatus: 'readyToPlay', playCalled: false }), 'play');
  assert.equal(watchSplashPlayGate({ scene: 'active', itemStatus: 'readyToPlay', playCalled: true }), 'wait');
  assert.equal(watchSplashPlayGate({ scene: 'active', itemStatus: 'failed', playCalled: false }), 'failed');
  assert.equal(watchSplashShouldReplay({ timeControlStatus: 'paused', retried: false }), true);
  assert.equal(watchSplashShouldReplay({ timeControlStatus: 'waiting', retried: false }), true);
  assert.equal(watchSplashShouldReplay({ timeControlStatus: 'playing', retried: false }), false);
  assert.equal(watchSplashShouldReplay({ timeControlStatus: 'paused', retried: true }), false);
  assert.equal(watchSplashVideoShown({ playing: false, settled: false, dismissing: false }), false);
  assert.equal(watchSplashVideoShown({ playing: false, settled: true, dismissing: false }), false);
  assert.equal(watchSplashVideoShown({ playing: true, settled: false, dismissing: false }), false);
  assert.equal(watchSplashVideoShown({ playing: true, settled: true, dismissing: false }), true);
  assert.equal(watchSplashVideoShown({ playing: true, settled: true, dismissing: true }), false);
  assert.equal(WATCH_SPLASH_REVEAL_SETTLE_NS, 150_000_000);
  assert.ok(WATCH_SPLASH_REVEAL_SETTLE_NS >= 100_000_000 && WATCH_SPLASH_REVEAL_SETTLE_NS <= 150_000_000);
  assert.equal(watchSplashSafetyStarts('playing', false), true);
  assert.equal(watchSplashSafetyStarts('playing', true), false);
  assert.equal(watchSplashSafetyStarts('paused', false), false);
  assert.equal(watchSplashSafetyStarts('waiting', false), false);
  assert.equal(WATCH_SPLASH_SAFETY_NS, 5_000_000_000);
  assert.equal(WATCH_SPLASH_STALL_NS, 6_000_000_000);
  assert.ok(WATCH_SPLASH_STALL_NS > WATCH_SPLASH_SAFETY_NS);
});

test('a clip that never plays still dismisses on the stall ceiling', () => {
  assert.equal(
    watchSplashStallCeilingStarts({ scene: 'active', playbackStarted: true, reduceMotion: false, dismissing: false }),
    true,
  );
  assert.equal(
    watchSplashStallCeilingStarts({ scene: 'background', playbackStarted: false, reduceMotion: false, dismissing: false }),
    false,
  );
  assert.equal(
    watchSplashStallCeilingStarts({ scene: 'inactive', playbackStarted: false, reduceMotion: false, dismissing: false }),
    false,
  );
  assert.equal(
    watchSplashStallCeilingStarts({ scene: 'active', playbackStarted: false, reduceMotion: false, dismissing: false }),
    false,
  );
  assert.equal(
    watchSplashStallCeilingStarts({ scene: 'active', playbackStarted: true, reduceMotion: true, dismissing: false }),
    false,
  );
  assert.equal(
    watchSplashStallCeilingStarts({ scene: 'active', playbackStarted: true, reduceMotion: false, dismissing: true }),
    false,
  );

  const splash = read('targets/watch/WatchSplash.swift');
  assert.match(splash, /stallNanoseconds: UInt64 = 6_000_000_000/);
  assert.match(splash, /reason: "stall"/);
  const reduce = splash.slice(splash.indexOf('if reduceMotion'), splash.indexOf('startStallCeiling()'));
  assert.doesNotMatch(reduce, /stallNanoseconds/);
  const stall = splash.slice(splash.indexOf('private func startStallCeiling'), splash.indexOf('private func startSafety'));
  assert.match(stall, /stallNanoseconds/);
  assert.match(stall, /guard !dismissing else \{ return \}/);
  assert.match(stall, /dismiss\(fade: false, reason: "stall"/);
  assert.match(stall, /timeControlStatus/);
  assert.match(stall, /playbackDetail/);
  const detail = splash.slice(splash.indexOf('private func playbackDetail'), splash.indexOf('private func dismiss'));
  assert.match(detail, /status=/);
  assert.match(detail, /timeControlStatus=/);
  assert.match(detail, /reasonForWaitingToPlay=/);
});

test('Watch target links the video frameworks the splash imports', () => {
  const config = read('targets/watch/expo-target.config.js');
  assert.match(config, /'AVFoundation'/);
  assert.match(config, /'AVKit'/);
});
