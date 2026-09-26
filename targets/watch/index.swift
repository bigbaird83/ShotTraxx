import HealthKit
import SwiftUI
import WatchKit

final class ShotTraxxWatchDelegate: NSObject, WKApplicationDelegate {
  /// watchOS relaunches the app to reclaim an HKWorkoutSession that outlived
  /// the process. Hand that session back so a second one is never created.
  func handleActiveWorkoutRecovery() {
    let club = WatchClubSession.shared
    club.beginGolfWorkoutRecovery()
    // recoverActiveWorkoutSession is the one call that returns the session
    // still active after a crash. Creating another one throws.
    guard HKHealthStore.isHealthDataAvailable() else {
      DispatchQueue.main.async {
        club.finishGolfWorkoutRecovery(
          nil,
          error: NSError(
            domain: "com.shottrax.app.watch",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "HealthKit unavailable"]
          )
        )
      }
      return
    }
    HKHealthStore().recoverActiveWorkoutSession { recovered, error in
      DispatchQueue.main.async {
        club.finishGolfWorkoutRecovery(recovered, error: error)
      }
    }
  }
}

@main
struct ShotTraxxWatchApp: App {
  @WKApplicationDelegateAdaptor(ShotTraxxWatchDelegate.self) private var appDelegate
  @StateObject private var session = WatchClubSession.shared

  init() {
    // Background launch (complication transfer / application context): the
    // session delegate must exist before any view does, or the widget stays stale.
    _ = appDelegate
    _ = WatchClubSession.shared
    // Cover the first open before any scene callback can raise When In Use.
    // A fresh live round skips the clip, so it does not wait.
    if !WatchClubSession.shared.liveHoleInProgress {
      WatchClubSession.shared.prepareLaunchSplash()
    }
  }

  var body: some Scene {
    WindowGroup {
      ShotTraxxWatchRoot(session: session)
    }
    .backgroundTask(.watchConnectivity) {
      // Not the main actor. drainConnectivity applies session state on MainActor.
      await WatchClubSession.drainConnectivity()
    }
    .backgroundTask(.snapshot) { _ in
      // watchOS shows the last snapshot while launching. Capture the logo
      // still, unless a fresh live round should come back on the hole.
      await MainActor.run {
        let session = WatchClubSession.shared
        if session.liveHoleInProgress {
          session.lowerSnapshotCover()
        } else {
          session.raiseSnapshotCover()
        }
      }
      // Let the cover (or the hole, when a live round is up) commit before
      // watchOS captures the launch image.
      try? await Task.sleep(nanoseconds: 50_000_000)
      return SnapshotResponse(
        restoredDefaultState: true,
        estimatedSnapshotExpiration: .distantFuture
      )
    }
  }
}

/// Cold start overlay. A background launch must not play or time out the clip.
private struct ShotTraxxWatchRoot: View {
  @ObservedObject var session: WatchClubSession
  @Environment(\.scenePhase) private var scenePhase
  /// Clip still owed this process. Starts true so the cover is in the first
  /// frame. False after it finishes, is skipped, or the scene leaves mid-clip.
  @State private var splashDue = !WatchClubSession.shared.liveHoleInProgress
  @State private var loggedLiveSkip = false

  /// Logo still while the clip is due, and while the scene is not active with
  /// no fresh live round (the snapshot watchOS shows on the next launch).
  /// Active after the clip is Home, on that same frame.
  private var showLaunchCover: Bool {
    if session.liveHoleInProgress { return false }
    if splashDue { return true }
    if scenePhase != .active { return true }
    return false
  }

  var body: some View {
    ZStack {
      ContentView()
        .environmentObject(session)
      if showLaunchCover {
        if splashDue {
          WatchSplash(scenePhase: scenePhase) { splashDue = false }
        } else {
          WatchSplashCover()
        }
      }
    }
    .onAppear { skipSplashForLiveRound() }
    .onChange(of: scenePhase) { _, phase in
      if phase == .active {
        session.lowerSnapshotCover()
      } else if !session.liveHoleInProgress {
        session.raiseSnapshotCover()
      }
      skipSplashForLiveRound()
    }
    .onChange(of: session.liveHoleInProgress) { _, live in
      // A round the phone starts while the clip plays takes the screen at once.
      if live {
        session.lowerSnapshotCover()
        skipSplashForLiveRound()
      }
    }
  }

  private func skipSplashForLiveRound() {
    guard session.liveHoleInProgress else { return }
    if !loggedLiveSkip {
      loggedLiveSkip = true
      WatchSplashClip.splashLog.info("skipped for live round")
    }
    splashDue = false
    session.splashDidFinish()
  }
}
