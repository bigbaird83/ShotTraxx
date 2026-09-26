import AVFoundation
import AVKit
import os
import SwiftUI
import UIKit

/// Watch open splash. Same brand clip as the phone, bundled in this target.
enum WatchSplashClip {
  /// 3.0s, portrait 392×584, H.264 Main, yuv420p, 24 fps, about 1 Mbps. No audio, no cover art.
  static let resource = "WatchSplash"
  static let fileExtension = "mov"
  /// Frame 0 of the clip, for the logo cover and Reduce Motion.
  /// Contained on the largest Apple Watch screen (Ultra 3 is 422×514 px): 345×514,
  /// the same 392:584 art. Asset catalog, so the first frame does not decode the 784×1168 still.
  static let firstFrame = "WatchSplashFirstFrame"
  static let aspectRatio = 392.0 / 584.0
  /// VideoPlayer stays this faint under the logo until the clip is actually showing.
  /// Opacity 0 can skip drawing the first frame; this still hides the transport chrome.
  static let concealedPlayerOpacity = 0.001
  /// After `timeControlStatus == .playing`, wait so the first decoded frame is up
  /// before the logo lifts. watchOS draws transport chrome only while paused.
  static let revealSettleNanoseconds: UInt64 = 150_000_000
  /// Field behind the contained clip — the clip's own near-black edge.
  static let background = Color(red: 0, green: 1.0 / 255, blue: 1.0 / 255)
  /// Fade after the clip ends or a tap.
  static let fadeNanoseconds: UInt64 = 200_000_000
  /// 5 s ceiling once the clip is actually playing.
  static let safetyNanoseconds: UInt64 = 5_000_000_000
  /// 6 s ceiling from the first active playback attempt, even if the item never plays.
  static let stallNanoseconds: UInt64 = 6_000_000_000
  /// Reduce Motion holds the first-frame still this long instead of playing.
  static let reduceMotionNanoseconds: UInt64 = 1_200_000_000

  static let splashLog = Logger(subsystem: "com.shottrax.app.watch", category: "splash")

  /// Decoded before the first frame that shows the cover. Not loaded in onAppear, .task, or after the player starts.
  static let poster: UIImage = loadPoster() ?? UIImage()

  static func loadPoster() -> UIImage? {
    if let named = UIImage(named: firstFrame) { return named }
    guard let url = Bundle.main.url(forResource: firstFrame, withExtension: "png") else { return nil }
    return UIImage(contentsOfFile: url.path)
  }
}

/// Brand field and the frame-0 logo. No phase, player, or session gate.
struct WatchSplashCover: View {
  var body: some View {
    let poster = WatchSplashClip.poster
    ZStack {
      WatchSplashClip.background
      Image(uiImage: poster)
        .resizable()
        .aspectRatio(WatchSplashClip.aspectRatio, contentMode: .fit)
    }
    .ignoresSafeArea()
  }
}

private enum SplashPlayEvent {
  case status(Int, String)
  case control(Int, String)
  case sceneActive
}

/// Owns the player so status and timeControlStatus can be observed off the view value.
private final class SplashPlaybackBox {
  let player: AVPlayer
  let item: AVPlayerItem
  var sceneActive = false
  var playCalled = false
  var retried = false
  var safetyStarted = false
  let events: AsyncStream<SplashPlayEvent>
  private let continuation: AsyncStream<SplashPlayEvent>.Continuation
  private var statusObs: NSKeyValueObservation?
  private var controlObs: NSKeyValueObservation?
  private var waitingObs: NSKeyValueObservation?

  init(url: URL) {
    let item = AVPlayerItem(url: url)
    let player = AVPlayer(playerItem: item)
    player.isMuted = true
    player.actionAtItemEnd = .pause
    self.item = item
    self.player = player
    var continuation: AsyncStream<SplashPlayEvent>.Continuation!
    self.events = AsyncStream { continuation = $0 }
    self.continuation = continuation
  }

  /// Observe after the caller is ready to consume `events`, so the initial status is not dropped.
  func start() {
    statusObs = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
      self?.continuation.yield(.status(item.status.rawValue, Self.errorText(item)))
    }
    controlObs = player.observe(\.timeControlStatus, options: [.initial, .new]) { [weak self] player, _ in
      self?.continuation.yield(.control(player.timeControlStatus.rawValue, Self.waitingText(player)))
    }
    waitingObs = player.observe(\.reasonForWaitingToPlay, options: [.new]) { [weak self] player, _ in
      self?.continuation.yield(.control(player.timeControlStatus.rawValue, Self.waitingText(player)))
    }
  }

  static func waitingText(_ player: AVPlayer) -> String {
    player.reasonForWaitingToPlay?.rawValue ?? ""
  }

  func setSceneActive(_ active: Bool) {
    sceneActive = active
    continuation.yield(.sceneActive)
  }

  static func errorText(_ item: AVPlayerItem) -> String {
    guard let error = item.error else { return "" }
    let text = error.localizedDescription
    if !text.isEmpty { return text }
    let ns = error as NSError
    return "\(ns.domain) \(ns.code)"
  }

  deinit {
    statusObs?.invalidate()
    controlObs?.invalidate()
    waitingObs?.invalidate()
    continuation.finish()
  }
}

/// Full-screen overlay on the first time this process is actually on screen.
/// A background launch keeps the still up and does not start a player or a timer.
/// The app is mounted underneath. Tap skips.
struct WatchSplash: View {
  /// Scene phase from the Watch app. Playback starts on the first `.active`.
  var scenePhase: ScenePhase
  let onDone: () -> Void

  init(scenePhase: ScenePhase, onDone: @escaping () -> Void) {
    self.scenePhase = scenePhase
    self.onDone = onDone
  }

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var player: AVPlayer?
  @State private var playbackBox: SplashPlaybackBox?
  @State private var dismissing = false
  @State private var opacity = 1.0
  @State private var playbackStarted = false
  @State private var loggedPending = false
  @State private var loggedMissingPoster = false
  /// True only after playback has settled. False again when the player leaves `.playing`.
  @State private var videoVisible = false
  @State private var revealArmed = false
  @State private var revealTicket = 0

  var body: some View {
    ZStack {
      if let player {
        // Contain, never fill: the clip is taller than any Watch screen.
        // Under the logo until the clip is playing. watchOS VideoPlayer paints a
        // pause glyph while paused or loading, and AVKit has no controls-free
        // surface on watchOS. Near-zero opacity lets the first frame decode
        // without that chrome showing through the cover.
        VideoPlayer(player: player)
          .aspectRatio(WatchSplashClip.aspectRatio, contentMode: .fit)
          .allowsHitTesting(false)
          .accessibilityHidden(true)
          .opacity(videoVisible ? 1 : WatchSplashClip.concealedPlayerOpacity)
      }
      if !videoVisible {
        // Still is in this tree on the first frame. Playback is the only part that waits.
        WatchSplashCover()
      }
    }
    .ignoresSafeArea()
    .opacity(opacity)
    .contentShape(Rectangle())
    .onTapGesture { dismiss(fade: true, reason: "tap") }
    .accessibilityElement()
    .accessibilityLabel("ShotTraxx")
    .accessibilityHint("Tap to skip")
    .accessibilityAddTraits(.isButton)
    .onAppear {
      applyPhase(scenePhase)
    }
    .onChange(of: scenePhase) { _, phase in
      playbackBox?.setSceneActive(phase == .active)
      applyPhase(phase)
    }
    .task(id: playbackStarted) {
      guard playbackStarted else { return }
      await run()
    }
    .onReceive(NotificationCenter.default.publisher(for: .AVPlayerItemDidPlayToEndTime)) { note in
      guard let item = note.object as? AVPlayerItem, item === player?.currentItem else { return }
      dismiss(fade: true, reason: "ended")
    }
    .onReceive(NotificationCenter.default.publisher(for: .AVPlayerItemFailedToPlayToEndTime)) { note in
      guard let item = note.object as? AVPlayerItem, item === player?.currentItem else { return }
      dismiss(fade: false, reason: "failed")
    }
    .onDisappear {
      WatchClubSession.shared.splashDidFinish()
    }
  }

  /// No player and no timer until the scene is active. Leaving active after
  /// that dismisses the clip; it does not start again.
  private func applyPhase(_ phase: ScenePhase) {
    if phase == .active {
      guard !playbackStarted, !dismissing else { return }
      playbackStarted = true
      return
    }
    if playbackStarted {
      dismiss(fade: false, reason: "scene left")
      return
    }
    guard !loggedPending else { return }
    loggedPending = true
    WatchSplashClip.splashLog.info("splash pending (scene not active)")
  }

  private func run() async {
    guard !dismissing else { return }
    if WatchSplashClip.poster.size.width <= 0, !loggedMissingPoster {
      loggedMissingPoster = true
      WatchSplashClip.splashLog.info("resource missing")
    }
    if reduceMotion {
      WatchSplashClip.splashLog.info("reduce motion still")
      try? await Task.sleep(nanoseconds: WatchSplashClip.reduceMotionNanoseconds)
      if Task.isCancelled || dismissing { return }
      dismiss(fade: true, reason: "ended")
      return
    }
    startStallCeiling()
    guard let url = Bundle.main.url(
      forResource: WatchSplashClip.resource,
      withExtension: WatchSplashClip.fileExtension
    ) else {
      if !loggedMissingPoster {
        WatchSplashClip.splashLog.info("resource missing")
      }
      dismiss(fade: false, reason: "failed")
      return
    }
    let box = SplashPlaybackBox(url: url)
    playbackBox = box
    player = box.player
    box.sceneActive = scenePhase == .active
    box.start()
    for await event in box.events {
      if Task.isCancelled || dismissing { return }
      switch event {
      case .status(let raw, let error):
        let status = AVPlayerItem.Status(rawValue: raw) ?? .unknown
        logPlayback(status: status, control: box.player.timeControlStatus, waiting: SplashPlaybackBox.waitingText(box.player), error: error)
        if status == .failed {
          dismiss(fade: false, reason: "failed")
          return
        }
        tryStart(box)
      case .control(let raw, let waiting):
        let control = AVPlayer.TimeControlStatus(rawValue: raw) ?? .paused
        logPlayback(status: box.item.status, control: control, waiting: waiting, error: SplashPlaybackBox.errorText(box.item))
        if control == .playing {
          startSafety(box)
          armReveal()
        } else {
          concealPlayback()
        }
      case .sceneActive:
        tryStart(box)
      }
    }
  }

  /// `play()` only after the item is ready and this scene is active.
  /// watchOS pauses media that starts before the app is really in front.
  private func tryStart(_ box: SplashPlaybackBox) {
    guard box.sceneActive else { return }
    guard box.item.status == .readyToPlay else { return }
    guard !box.playCalled else { return }
    box.playCalled = true
    box.player.play()
    logPlayback(status: box.item.status, control: box.player.timeControlStatus, waiting: SplashPlaybackBox.waitingText(box.player), error: SplashPlaybackBox.errorText(box.item))
    Task { @MainActor in
      try? await Task.sleep(nanoseconds: 300_000_000)
      guard !dismissing, !box.retried else { return }
      if box.player.timeControlStatus != .playing {
        box.retried = true
        box.player.play()
        logPlayback(status: box.item.status, control: box.player.timeControlStatus, waiting: SplashPlaybackBox.waitingText(box.player), error: SplashPlaybackBox.errorText(box.item))
      }
    }
  }

  /// 6 s from the first active `run()`, independent of item status. Ignored once dismissed.
  /// Reduce Motion returns before this. A background launch never reaches `run()`.
  private func startStallCeiling() {
    Task { @MainActor in
      try? await Task.sleep(nanoseconds: WatchSplashClip.stallNanoseconds)
      guard !dismissing else { return }
      let status = playbackBox?.item.status ?? .unknown
      let control = playbackBox?.player.timeControlStatus ?? .paused
      let waiting = playbackBox.map { SplashPlaybackBox.waitingText($0.player) } ?? ""
      let detail = playbackDetail(status: status, control: control, waiting: waiting, error: playbackBox.map { SplashPlaybackBox.errorText($0.item) } ?? "")
      dismiss(fade: false, reason: "stall", detail: detail)
    }
  }

  /// 5 s ceiling from the moment the clip is actually moving, not from view creation.
  private func startSafety(_ box: SplashPlaybackBox) {
    guard !box.safetyStarted else { return }
    box.safetyStarted = true
    WatchSplashClip.splashLog.info("playback started")
    Task { @MainActor in
      try? await Task.sleep(nanoseconds: WatchSplashClip.safetyNanoseconds)
      guard !dismissing else { return }
      dismiss(fade: false, reason: "safety")
    }
  }

  private func logPlayback(status: AVPlayerItem.Status, control: AVPlayer.TimeControlStatus, waiting: String, error: String) {
    let detailLabel = playbackDetail(status: status, control: control, waiting: waiting, error: error)
    WatchSplashClip.splashLog.info("\(detailLabel, privacy: .public)")
  }

  private func playbackDetail(status: AVPlayerItem.Status, control: AVPlayer.TimeControlStatus, waiting: String, error: String) -> String {
    let statusLabel: String
    switch status {
    case .unknown: statusLabel = "unknown"
    case .readyToPlay: statusLabel = "readyToPlay"
    case .failed: statusLabel = "failed"
    @unknown default: statusLabel = "unknown"
    }
    let controlLabel: String
    switch control {
    case .paused: controlLabel = "paused"
    case .waitingToPlayAtSpecifiedRate: controlLabel = "waiting"
    case .playing: controlLabel = "playing"
    @unknown default: controlLabel = "paused"
    }
    let waitingLabel = waiting.isEmpty ? "none" : waiting
    return "status=\(statusLabel) timeControlStatus=\(controlLabel) reasonForWaitingToPlay=\(waitingLabel) error=\(error)"
  }

  private func dismiss(fade: Bool, reason: String, detail: String = "") {
    guard !dismissing else { return }
    dismissing = true
    let reasonLabel = reason
    if detail.isEmpty {
      WatchSplashClip.splashLog.info("dismissed (reason: \(reasonLabel, privacy: .public))")
    } else {
      let detailLabel = detail
      WatchSplashClip.splashLog.info("dismissed (reason: \(reasonLabel, privacy: .public)) \(detailLabel, privacy: .public)")
    }
    // Cover the player before pause. watchOS paints the pause glyph as soon as
    // playback stops, including the fade at the end of the clip.
    concealPlayback()
    player?.pause()
    guard fade else {
      onDone()
      return
    }
    withAnimation(.easeOut(duration: Double(WatchSplashClip.fadeNanoseconds) / 1_000_000_000)) {
      opacity = 0
    }
    Task {
      try? await Task.sleep(nanoseconds: WatchSplashClip.fadeNanoseconds)
      onDone()
    }
  }

  /// Lift the logo once `.playing` has been observed and the first frame has settled.
  /// Another `.playing` event does not restart that wait.
  private func armReveal() {
    guard !dismissing, !videoVisible, !revealArmed else { return }
    revealArmed = true
    revealTicket += 1
    let ticket = revealTicket
    Task { @MainActor in
      try? await Task.sleep(nanoseconds: WatchSplashClip.revealSettleNanoseconds)
      guard ticket == revealTicket, !dismissing else { return }
      guard playbackBox?.player.timeControlStatus == .playing else {
        revealArmed = false
        return
      }
      var transaction = Transaction()
      transaction.disablesAnimations = true
      withTransaction(transaction) {
        videoVisible = true
        revealArmed = false
      }
    }
  }

  /// Logo back on top, with no animation, so a pause glyph cannot appear.
  private func concealPlayback() {
    revealTicket += 1
    revealArmed = false
    guard videoVisible else { return }
    var transaction = Transaction()
    transaction.disablesAnimations = true
    withTransaction(transaction) {
      videoVisible = false
    }
  }
}
