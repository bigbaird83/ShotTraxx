import CoreLocation
import Foundation
import HealthKit
import os
import WatchKit
import WatchConnectivity
#if canImport(WidgetKit)
import WidgetKit
#endif

// Club-pick only. No motion detection, no mic, no sensor auto-mark.
// Tap → phone club=mark GPS. Edit shot sends shotUndo or shotClubChange; the
// phone edits only the shot it named (never putts, penalties, or other holes).

struct ClubListState {
  var top3: [String] = []
  var bag: [String] = []
  var labels: [String: String] = [:]
  var holeNumber: Int = 1
  var yardsToGreen: Int? = nil
  var yardsQuality: String = "none"
  var lastClubId: String? = nil
  var selectedClubId: String? = nil
  /// Hole-map yards for the complication. 0 means no hole — never invent Hole 1.
  var complicationHole: Int = 0
  var complicationYards: Int? = nil
  var complicationQuality: String = "none"
  /// Epoch ms of the live yards now shown (Watch fix or an accepted phone fix).
  var liveAtMs: Double = 0
  /// Fixed tee-to-green length from course data. Not the walking number.
  var teeLengthYards: Int? = nil
  /// Course cup the phone uses for planLiveGpsToPin. Nil → Watch does not invent yards.
  var greenLat: Double? = nil
  var greenLng: Double? = nil
  /// Play-wheel carry by club id. The strip ranks with these, not a stock guess.
  var clubCarry: [String: Int] = [:]
  /// Last good/soft live D on this hole so a poor fix does not reshuffle clubs.
  var rankHoldYards: Int? = nil
  var rankHoldHole: Int = 0
  /// Phone finished the last hole (Made it / Hole Out). Round complete, not the putt sheet.
  var roundComplete: Bool = false
  /// False when the phone is showing a finished round. Missing on the wire means live.
  var roundLive: Bool = true
  /// Shots on this hole, copied from the phone. Zero dims Edit shot.
  var shotCount: Int = 0
  /// Shot Edit shot would change or delete on this hole. Nil → the button is dim.
  var lastShotId: String? = nil
  /// Club on that shot. Change club highlights this, not the strip selection.
  var lastShotClubId: String? = nil
  /// Phone club-list generation. A lower number is a late delivery and is ignored.
  var listSeq: Int = 0

  /// Top-right live yards. Same gate as the phone: good/soft and a positive number, else —.
  var liveYardsTrusted: Bool {
    (complicationQuality == "good" || complicationQuality == "soft") && (complicationYards ?? 0) > 0
  }

  /// Tee length line under Hole N on the Watch face ("412 yd"). Nil when unknown.
  var teeLengthLabel: String? {
    guard let yards = teeLengthYards, yards > 0 else { return nil }
    return "\(yards) yd"
  }

  /// Hole N · fixed tee length, or Hole N when course data has no length.
  /// Live GPS stays on `liveYardsLabel` and the complication.
  var statusLine: String {
    if let yards = teeLengthYards, yards > 0 {
      return "Hole \(holeNumber) · \(yards) yd"
    }
    return "Hole \(holeNumber)"
  }

  /// Yards the three club buttons rank against. Last good/soft live distance on this hole,
  /// else the phone's complication yards until the Watch has its own fix.
  var rankYards: Int? {
    if rankHoldHole == holeNumber, let yards = rankHoldYards, yards > 0 { return yards }
    if liveYardsTrusted, let yards = complicationYards { return yards }
    if let yards = yardsToGreen, yards > 0 { return yards }
    return nil
  }

  /// Approximate only beside a live soft yardage. Never SOFT. Never on a dash.
  var showSoft: Bool { liveYardsTrusted && complicationQuality == "soft" }

  var liveYardsLabel: String {
    if liveYardsTrusted, let yards = complicationYards {
      return "\(yards) yd"
    }
    return "—"
  }

  func label(for clubId: String) -> String {
    labels[clubId] ?? clubId
  }
}

struct NearbyCourse: Identifiable, Equatable {
  var id: String
  var name: String
}

struct NearbyTee: Identifiable, Equatable {
  var id: String { name }
  var name: String
}

/// One Watch Home row. `favorite` mirrors the phone favorites list.
struct HomeCourse: Identifiable, Equatable {
  var id: String
  var name: String
  var favorite: Bool
  var distanceMeters: Int?

  var distanceLabel: String? {
    guard let meters = distanceMeters else { return nil }
    return String(format: "%.1f mi", Double(meters) / 1609.344)
  }
}

/// Watch Home: phone favorites + phone nearby search. Watch never keeps its
/// own favorites list — the star sends a toggle and the phone list wins.
struct WatchHomeState {
  var favorites: [HomeCourse] = []
  var nearby: [HomeCourse] = []
  var line: String = ""
  var liveCourseName: String?
  var liveCourseId: String?
  var loading = false
  /// True while the last homeRequest is on `transferUserInfo` because the phone
  /// is not interactively reachable. Loud "Queued · will sync" — not a spinner
  /// and not Phone unavailable.
  var queued = false

  var refreshLabel: String {
    if queued { return "Queued · will sync" }
    return loading ? "Updating…" : "Refresh"
  }

  /// Favorites, each id once, in the order the phone sent. The phone sorts
  /// nearest-first when it has an authorized fix; this view does not re-sort.
  var favoriteRows: [HomeCourse] {
    var seen = Set<String>()
    return favorites.filter { seen.insert($0.id).inserted }
  }

  /// Nearby minus anything already under Favorites — a course shows once.
  /// Shown on the pushed Search nearby screen, not as the Home body.
  var nearbyRows: [HomeCourse] {
    var seen = Set(favorites.map { $0.id })
    return nearby.filter { seen.insert($0.id).inserted }
  }

  /// Search nearby screen: nearby favorites (they carry a distance) plus the
  /// rest of nearby, closest first. No nearby rows at all → the favorites, so
  /// the screen never dead-ends while there is a course to tap.
  /// Mirrors `watchNearbyScreenRows` in src/domain/watchHome.ts.
  var nearbyScreenRows: [HomeCourse] {
    var seen = Set<String>()
    var rows = (favorites.filter { $0.distanceMeters != nil } + nearby)
      .filter { seen.insert($0.id).inserted }
    rows.sort { ($0.distanceMeters ?? Int.max) < ($1.distanceMeters ?? Int.max) }
    return rows.isEmpty ? favoriteRows : rows
  }

  /// Empty-state copy for Search nearby. The phone sends it; an older cached
  /// Home with no line falls back to the no-location copy.
  var nearbyEmptyLine: String {
    line.isEmpty ? WatchHomeState.noLocationLine : line
  }

  static let noLocationLine = "No location on Watch or phone. Open ShotTraxx on your phone."

  func isFavorite(_ id: String) -> Bool {
    favorites.contains { $0.id == id }
  }

  /// Move a row between sections right away; the phone confirms after.
  func applyingStar(_ course: HomeCourse, starred: Bool) -> WatchHomeState {
    var next = self
    next.favorites.removeAll { $0.id == course.id }
    next.nearby.removeAll { $0.id == course.id }
    var row = course
    row.favorite = starred
    if starred {
      next.favorites.insert(row, at: 0)
    } else if row.distanceMeters != nil {
      next.nearby.append(row)
      next.nearby.sort { ($0.distanceMeters ?? Int.max) < ($1.distanceMeters ?? Int.max) }
    }
    return next
  }
}

struct NearbyState {
  var active: Bool = false
  /// True while Watch Home is up (no course tapped yet).
  var awaitingSelect: Bool = true
  var courses: [NearbyCourse] = []
  var tees: [NearbyTee] = []
  var courseId: String?
  var courseName: String?
  var holeCount: Int?
}

struct PuttSheetState {
  var open: Bool = false
  var holeNumber: Int = 1
  var lengths: [String] = []
  var labels: [String: String] = [
    "inside_3": "Under 3 ft",
    "3_to_10": "3–10",
    "10_to_20": "10–20",
    "over_20": "20+",
  ]
  var canAdd: Bool = true
  var canMake: Bool = true
  var pending: String? = nil

  func label(for lengthId: String) -> String {
    labels[lengthId] ?? lengthId
  }
}

/// `@Published` storage is Combine's lock. SwiftUI holds that lock during a
/// scene-create view update. A setter from the WCSession queue takes the same
/// lock and then waits on SwiftUI, so the two threads deadlock (0x8badf00d).
/// The class stays off `@MainActor`: it is an `NSObject` plus three system
/// delegates, and every `sendMessage` reply would have to be rewritten.
/// Callbacks hop, and the mutators trap if they are not on the main queue.
final class WatchClubSession: NSObject, ObservableObject, WCSessionDelegate, CLLocationManagerDelegate, HKWorkoutSessionDelegate {
  /// One session for the app and for background WatchConnectivity launches.
  static let shared = WatchClubSession()

  /// Background WatchConnectivity task: stay up until the delivered clubList
  /// (application context / complication userInfo) has been applied, so the app
  /// group and the ShotTraxxHole widget move while the Watch app is not in front.
  /// The task is not the main actor. Published state is applied only inside
  /// `MainActor.run`, after the delegate callbacks have queued their hops.
  static func drainConnectivity() async {
    await MainActor.run {
      _ = shared
    }
    for _ in 0..<40 {
      let settled = await MainActor.run { () -> Bool in
        guard WCSession.isSupported() else { return true }
        let wc = WCSession.default
        return wc.activationState == .activated && !wc.hasContentPending
      }
      if settled { break }
      try? await Task.sleep(nanoseconds: 250_000_000)
    }
    // Delegate callbacks enqueue applyClubList with DispatchQueue.main.async.
    // This turn is queued after those blocks, so the write finishes on main
    // before the background task returns. Do not hop synchronously onto main.
    await MainActor.run {
      _ = shared
    }
  }

  @Published var list = ClubListState()
  @Published var putt = PuttSheetState()
  @Published var nearby = NearbyState()
  @Published var feedback: String = ""
  /// Caption under the dash. Nil when a yardage is showing. Never an empty string.
  @Published private(set) var liveYardsReason: String? = nil
  /// Number drawn in the Watch app. Frozen while the wrist is down. The
  /// complication keeps `list` yards, which still update from GPS.
  @Published private(set) var appLiveYards: Int? = nil
  @Published private(set) var appLiveYardsQuality = "none"
  /// Shown on the club list when Health already denied workout share. Empty when hidden.
  @Published var workoutDeniedHint = ""
  static let workoutDeniedHintText = "Watch may sleep wrist-down. Turn on Workouts for ShotTraxx in the Health app on your iPhone."
  @Published var sending = false
  @Published var nearbyFromHome = false
  @Published var home = WatchHomeState()
  /// Penalty reasons are showing. Not a club mark and not the putt sheet.
  @Published var penaltyChoicesOpen = false
  /// Edit shot is showing. The hole face is both of these false.
  @Published var editShotOpen = false
  /// Change club list is showing. Picking a club clears this and Edit shot.
  @Published var changeClubOpen = false
  /// A penalty is still unconfirmed. Retry stays until the phone accepts the id.
  @Published var penaltyRetry = false
  /// Short line next to Retry. Empty once every pending penalty is confirmed.
  @Published var penaltyNotice = ""
  /// A shot undo is still unconfirmed. Retry resends it with the same id.
  @Published var undoRetry = false
  /// A club change is still unconfirmed. Retry resends it with the same id.
  @Published var clubChangeRetry = false
  /// Shots with an undo on the way, so one tap never sends a second undo.
  @Published var undoPendingShotIds: Set<String> = []
  /// Stars tapped on the Watch the phone has not echoed yet (id → starred, when).
  private var pendingFavorites: [String: (starred: Bool, at: Date)] = [:]
  private let homeKey = "watchHomeJSON"
  private let pendingFavoriteTTL: TimeInterval = 30
  /// Wrist-raise / reachability refresh. One transfer is enough; do not queue
  /// another (each delivery can wake the phone) while this window is open.
  private var lastAutomaticHomeAt = Date.distantPast
  private let automaticHomeInterval: TimeInterval = 60
  /// Collapse the launch burst (activate + Search nearby appear) into one transfer.
  private let homeRequestCoalesce: TimeInterval = 2
  private var receivedClubList = false
  /// Live clubList (`roundLive`, not complete) from WatchConnectivity this process.
  /// Loading the saved app-group club list does not set this.
  private var receivedLiveListThisLaunch = false
  /// Last complication snapshot written to the app group. Reload only when it changes.
  private var complicationStamp = ""
  /// Watch Back/Cancel on the putt sheet. Blocks phone keep-alive from reopening.
  private var userClosedPutt = false
  /// Hole the phone finished (puttSheet `done`). A late open:true for it must not
  /// bring the old putt sheet back. Cleared when the Watch opens putts itself.
  private var finishedPuttHole = 0

  var hasLiveHole: Bool {
    receivedClubList || !list.bag.isEmpty
  }

  /// Watch Home Continue. A finished or stale list still has a bag, so this is
  /// stricter than `hasLiveHole`. Home/Back does not hide it.
  var canContinueRound: Bool {
    list.roundLive && !list.roundComplete && hasLiveHole && roundIsFresh
  }

  var showsNearby: Bool {
    nearby.active && (!hasLiveHole || nearbyFromHome)
  }

  /// Watch Home is the face when no course has been tapped: Favorites, plus
  /// Search nearby (a push). Not the live hole and not holes/tees.
  var showsHome: Bool {
    showsNearby && nearby.courseId == nil
  }

  private var pendingPick: [String: Any]?
  private var pendingQueue: [[String: Any]] = []
  private let pendingKey = "pendingClubPick"
  private let pendingQueueKey = "pendingWatchQueue"
  private var golfWorkout: HKWorkoutSession?
  private var endingGolfWorkout = false
  /// The object already passed to `end()`. A second `end()` of it raises.
  private var endingSession: HKWorkoutSession?
  /// `handleActiveWorkoutRecovery` is in flight. Do not create another session.
  private var recoveringGolfWorkout = false
  /// True from init until the next main turn. `handleActiveWorkoutRecovery`
  /// runs during launch, before that turn, when a session outlived the process.
  private var workoutLaunchGate = false
  /// Set when the system asks us to recover. The launch gate must not start one.
  private var workoutRecoveryRequested = false
  /// Set around `HKWorkoutSession` init so a synchronous callback cannot start another.
  private var creatingGolfWorkout = false
  private var loggedBlockedGolfStart = false
  private var loggedStaleRoundSkip = false
  private var golfAuthInFlight = false
  /// Bumped when a stuck request is discarded so its callback cannot clear a newer sheet.
  private var golfAuthTicket = 0
  private var suppressGolfStart = false
  private var loggedGolfDenial = false
  private var loggedHealthUnavailable = false
  /// Tap dismiss lasts until this round ends or share becomes authorized.
  private var dismissedWorkoutDeniedHint = false
  private var loggedWorkoutDeniedHint = false
  private let healthStore = HKHealthStore()
  private let workoutLog = Logger(subsystem: "com.shottrax.app.watch", category: "round-workout")
  private let liveYardsLog = Logger(subsystem: "com.shottrax.app.watch", category: "liveYards")
  private var wantsStay = false
  private var userLeftApp = false
  /// Frontmost. `requestAuthorization` only presents the sheet while this is true.
  private var sceneIsActive = false
  /// Dimmed always-on. The scene can stay active while this is true.
  private var luminanceReduced = false
  /// Wrist-down: do not redraw the in-app yards caption until the wrist is up.
  private var appLiveYardsFrozen = false
  /// Share sheet from a request issued while `sceneIsActive`, until its callback.
  private var golfAuthSheetUp = false
  /// Course picked from Watch Home after Home/Back. The next fresh live club list
  /// is that round, not a yardage update of the round they left.
  private var watchRoundStartPending = false
  private var hadLiveRoundAtHomePick = false
  private var holeAtHomePick = 0
  private let location = CLLocationManager()
  private var lastFix: CLLocation?
  /// True after a foreground `startUpdatingLocation`. watchOS will not start a
  /// fresh stream from the background, so wrist-down must not clear this while
  /// a live hole is in progress.
  private var locationUpdatesStarted = false
  /// Avoid asking again while a When In Use sheet from this active scene is up.
  private var locationAuthRequestInFlight = false
  /// Launch splash is covering the UI. When In Use waits so it does not cover the clip.
  private var splashShowing = false
  /// Logo cover while watchOS takes the launch snapshot. The view ignores this
  /// once the scene is active and the clip is not due.
  @Published var snapshotCover = false
  /// Walking filter once the wrist is down. Wrist-up stays unfiltered so a
  /// stationary club mark still has a fix younger than 3 seconds.
  private static let liveDistanceFilterM: CLLocationDistance = 3
  /// After a Watch shot mark: no live-yard change for 30 s, then only after
  /// moving 10 yd from the mark. Mirrors `watchShotHoldDecision`.
  private static let shotHoldSec: TimeInterval = 30
  private static let shotHoldMinMoveYd = 10.0
  private var shotHold: (hole: Int, at: Date, anchor: CLLocation?)?

  override init() {
    super.init()
    location.delegate = self
    location.desiredAccuracy = kCLLocationAccuracyBest
    location.activityType = .fitness
    location.distanceFilter = Self.liveDistanceFilterM
    // watchOS has no automatic-pause switch and no pause callback.
    // A stop at the ball keeps delivering fixes.
    location.allowsBackgroundLocationUpdates = false
    let launchStatus = location.authorizationStatus
    let launchLabel = locationAuthLabel(launchStatus)
    liveYardsLog.info("launch authorization=\(launchLabel, privacy: .public)")
    // Do not request here. A complication push or workout often launches this
    // process in the background, and watchOS will not show the sheet then.

    // Defaults before activate(). The activation callback can otherwise mutate
    // `list` while this init and the first body are still reading it.
    loadFromDefaults()
    seedAppLiveYardsFromList()
    loadHome()
    if !hasLiveHole {
      // Open straight onto Watch Home from the cached rows.
      nearby.active = true
    }
    loadPending()
    if pendingQueue.contains(where: { ($0["type"] as? String) == "penaltyPick" }) {
      penaltyRetry = true
      penaltyNotice = "Queued · will sync"
    }
    syncUndoPending()
    // A crashed launch can leave an HKWorkoutSession. Do not create another
    // until watchOS has had a chance to hand that one back.
    holdWorkoutLaunchGate()
    syncRoundStay()
    syncLiveYardsReason()
    appLiveYardsFrozen = true

    if WCSession.isSupported() {
      let session = WCSession.default
      session.delegate = self
      session.activate()
    }
    // After activate(), so a callback queued inside activate() applies the
    // live club list before this turn is allowed to start a workout.
    scheduleWorkoutLaunchGateRelease()
  }

  /// Top-right live yards in the Watch app. Not the complication.
  var appLiveYardsTrusted: Bool {
    (appLiveYardsQuality == "good" || appLiveYardsQuality == "soft") && (appLiveYards ?? 0) > 0
  }

  var appLiveYardsLabel: String {
    if appLiveYardsTrusted, let yards = appLiveYards {
      return "\(yards) yd"
    }
    return "—"
  }

  /// Mirrors `watchAppLiveYardsDisplay`. Wrist-down keeps `shown`. A raise
  /// shows `current` unless a shot hold is still on.
  private static func appLiveYardsDisplay(
    sceneActive: Bool,
    luminanceReduced: Bool,
    holdActive: Bool,
    shownYards: Int?,
    shownQuality: String,
    currentYards: Int?,
    currentQuality: String
  ) -> (yards: Int?, quality: String) {
    let showing = sceneActive && !luminanceReduced
    if !showing || holdActive {
      return (shownYards, shownQuality)
    }
    return (currentYards, currentQuality)
  }

  private func seedAppLiveYardsFromList() {
    appLiveYards = list.liveYardsTrusted ? list.complicationYards : nil
    appLiveYardsQuality = list.liveYardsTrusted ? list.complicationQuality : "none"
  }

  /// Copy the latest yards into the on-screen number only while the app is
  /// showing and no shot hold is on. GPS and `persist` are not touched.
  private func syncAppLiveYards() {
    let showing = sceneIsActive && !luminanceReduced
    let holdActive = shotHold.map { $0.hole == list.holeNumber } ?? false
    let next = Self.appLiveYardsDisplay(
      sceneActive: sceneIsActive,
      luminanceReduced: luminanceReduced,
      holdActive: holdActive,
      shownYards: appLiveYards,
      shownQuality: appLiveYardsQuality,
      currentYards: list.liveYardsTrusted ? list.complicationYards : nil,
      currentQuality: list.liveYardsTrusted ? list.complicationQuality : "none"
    )
    appLiveYardsFrozen = !showing
    if next.yards != appLiveYards || next.quality != appLiveYardsQuality {
      appLiveYards = next.yards
      appLiveYardsQuality = next.quality
    }
  }

  private func refreshAppLiveYardsFace() {
    syncAppLiveYards()
    syncLiveYardsReason()
  }

  /// Ask the phone for a fresh Watch Home. Cached rows stay up meanwhile.
  /// A pocketed / backgrounded phone is often not `isReachable` while
  /// `transferUserInfo` still delivers, same path as `sendReliableQueued`.
  /// Loading stays until `watchHome` arrives (live reply or phone push).
  /// A missed interactive reply does not fail the refresh: the wrist shows
  /// Queued · will sync and keeps waiting on the transfer.
  /// `interactive` is false for wrist-raise and reachability flaps so those
  /// do not `sendMessage` (that wakes the phone). The transfer still goes out.
  func requestHome(interactive: Bool = true) {
    guard WCSession.isSupported(), WCSession.default.activationState == .activated else { return }
    let session = WCSession.default
    // A pocketed phone already has a transfer in flight. Do not queue another
    // wake for the launch burst. A later Refresh still sends.
    if home.queued && home.loading && !session.isReachable &&
       Date().timeIntervalSince(lastAutomaticHomeAt) < homeRequestCoalesce {
      return
    }
    lastAutomaticHomeAt = Date()
    home.loading = true
    var payload: [String: Any] = [
      "type": "homeRequest",
      "at": isoNow(),
      // Favorites sort uses this. Nearby still follows attachHomeFix as before.
      "locationAuth": liveAuthBucket(location.authorizationStatus),
    ]
    attachHomeFix(&payload)
    session.transferUserInfo(payload)
    if session.isReachable {
      home.queued = false
      if interactive {
        session.sendMessage(payload, replyHandler: { [weak self] reply in
          DispatchQueue.main.async {
            guard let self else { return }
            if let fresh = reply["home"] as? [String: Any] {
              self.applyWatchHome(fresh)
            }
          }
        }, errorHandler: { [weak self] _ in
          DispatchQueue.main.async {
            // Transfer is already queued. Stay loud — do not mark unavailable.
            self?.home.queued = true
          }
        })
      }
    } else {
      home.queued = true
    }
  }

  /// Wrist raise and reachability changes. Prefer the transfer already in
  /// flight over another live wake. A new transfer waits out the interval
  /// so a flapping session does not wake the phone on every raise.
  func refreshHomeIfShowing() {
    guard showsHome else { return }
    if home.loading { return }
    if Date().timeIntervalSince(lastAutomaticHomeAt) < automaticHomeInterval { return }
    requestHome(interactive: false)
  }

  /// Nearby search point. Watch GPS when fresh; otherwise the phone uses its own
  /// fix or its last location. Never a mark and never an accuracy gate.
  private func attachHomeFix(_ payload: inout [String: Any]) {
    guard let loc = lastFix else { return }
    let age = Date().timeIntervalSince(loc.timestamp)
    guard age <= 30, loc.horizontalAccuracy > 0, CLLocationCoordinate2DIsValid(loc.coordinate) else { return }
    payload["lat"] = loc.coordinate.latitude
    payload["lng"] = loc.coordinate.longitude
    payload["accuracyM"] = loc.horizontalAccuracy
    let fmt = ISO8601DateFormatter()
    fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    payload["fixAt"] = fmt.string(from: loc.timestamp)
  }

  func isLiveCourse(_ course: HomeCourse) -> Bool {
    guard hasLiveHole else { return false }
    if let id = home.liveCourseId, id == course.id { return true }
    guard let name = home.liveCourseName else { return false }
    return name.trimmingCharacters(in: .whitespaces).lowercased()
      == course.name.trimmingCharacters(in: .whitespaces).lowercased()
  }

  /// Row tap: the live round's course continues it; anything else starts the
  /// phone flow (course → 9/18 → tee → Start), same as the phone Home.
  func openHomeCourse(_ course: HomeCourse) {
    if isLiveCourse(course) {
      dismissNearbyToHole()
      return
    }
    pickCourse(courseId: course.id, name: course.name)
  }

  /// Star: update the phone favorites list. Never starts a round.
  func toggleFavorite(_ course: HomeCourse) {
    let starred = !home.isFavorite(course.id)
    pendingFavorites[course.id] = (starred: starred, at: Date())
    home = home.applyingStar(course, starred: starred)
    saveHome()
    haptic(.click)
    let payload: [String: Any] = [
      "type": "favoriteToggle",
      "courseId": course.id,
      "name": course.name,
      "starred": starred,
      "at": uniquePuttAt(),
    ]
    guard WCSession.isSupported(), WCSession.default.activationState == .activated else { return }
    let session = WCSession.default
    // Queued transfer survives an asleep phone; the live message makes it
    // instant when the phone is awake. The toggle is a target state and the
    // phone drops an older `at`, so double delivery is harmless.
    session.transferUserInfo(payload)
    if session.isReachable {
      session.sendMessage(payload, replyHandler: { [weak self] reply in
        DispatchQueue.main.async {
          guard let self else { return }
          if reply["ok"] as? Bool == true {
            self.pendingFavorites[course.id] = nil
          }
          if let fresh = reply["home"] as? [String: Any] {
            self.applyWatchHome(fresh)
          }
        }
      }, errorHandler: nil)
    }
  }

  /// Course pick → back to Watch Home.
  func backToHome() {
    clearWatchRoundStartPending()
    nearby.courseId = nil
    nearby.courseName = nil
    nearby.tees = []
    nearby.holeCount = nil
    nearby.awaitingSelect = true
    feedback = ""
    requestHome()
  }

  func pickHoleCount(_ count: Int) {
    guard count == 9 || count == 18 else { return }
    nearby.holeCount = count
    if nearby.tees.isEmpty {
      startPickedRound(teeName: nil)
    }
  }

  func pickCourse(courseId: String, name rowName: String? = nil) {
    sending = true
    feedback = ""
    nearby.awaitingSelect = false
    nearby.courseId = courseId
    nearby.tees = []
    nearby.holeCount = nil
    if let name = rowName ?? nearby.courses.first(where: { $0.id == courseId })?.name {
      nearby.courseName = name
    }
    // A later live club list is the round they just picked, once it is actually new.
    watchRoundStartPending = true
    hadLiveRoundAtHomePick = hasLiveHole && list.roundLive && !list.roundComplete
    holeAtHomePick = list.holeNumber
    sendPick([
      "type": "nearbyCoursePick",
      "courseId": courseId,
      "at": isoNow(),
    ], keepPending: false)
  }

  func pickTee(name: String) {
    startPickedRound(teeName: name)
  }

  private func startPickedRound(teeName: String?) {
    sending = true
    feedback = ""
    guard let courseId = nearby.courseId else {
      feedback = "open the phone"
      sending = false
      return
    }
    let holeCount = nearby.holeCount == 9 ? 9 : 18
    var payload: [String: Any] = [
      "type": "startRound",
      "courseId": courseId,
      "holeCount": holeCount,
      "at": isoNow(),
    ]
    if let teeName, !teeName.isEmpty {
      payload["teeName"] = teeName
    }
    sendPick(payload, keepPending: false)
    // Home-course start. Do not wait for the reply — Home/Back left userLeftApp
    // set, and that blocks the golf-workout prompt until the next scene change.
    resumeRoundStayAfterWatchStart()
  }

  private var lastClubTapAt = Date.distantPast
  private var lastClubTapId: String?
  private let clubTapDebounce: TimeInterval = 0.3

  func pick(clubId: String) {
    sending = false
    feedback = ""
    if clubId != "club_putter",
       clubId == lastClubTapId,
       Date().timeIntervalSince(lastClubTapAt) < clubTapDebounce {
      return
    }
    if clubId != "club_putter" {
      lastClubTapId = clubId
      lastClubTapAt = Date()
    }
    var next = list
    next.selectedClubId = clubId
    list = next
    persist(next)
    // Putter opens the putt sheet locally so Made is on-screen without
    // waiting on a phone push (TF 53/56: Doc never saw Made).
    if clubId == "club_putter" {
      userClosedPutt = false
      finishedPuttHole = 0
      var sheet = putt
      sheet.open = true
      if sheet.holeNumber < 1 {
        sheet.holeNumber = list.holeNumber
      }
      sheet.canMake = true
      sheet.canAdd = sheet.lengths.count < 5
      putt = sheet
      syncRoundStay()
    }
    var payload: [String: Any] = [
      "type": "clubPick",
      "clubId": clubId,
      "at": uniqueClubAt(),
      "holeNumber": list.holeNumber,
    ]
    // Putter opens the putt sheet / select only — never attach Watch GPS.
    if clubId != "club_putter" {
      attachWatchFix(&payload)
      beginShotHold()
    }
    sendPick(payload)
  }

  func select(_ clubId: String) {
    list.selectedClubId = clubId
    sendPick([
      "type": "clubSelect",
      "clubId": clubId,
      "at": isoNow(),
    ], keepPending: false)
  }

  /// Dedicated Putt control — opens the sheet without selecting putter on the wheel.
  func openPuttSheet() {
    userClosedPutt = false
    finishedPuttHole = 0
    var sheet = putt
    sheet.open = true
    if sheet.holeNumber < 1 {
      sheet.holeNumber = list.holeNumber
    }
    sheet.canMake = true
    sheet.canAdd = sheet.lengths.count < 5
    putt = sheet
    syncRoundStay()
    sendPick([
      "type": "clubPick",
      "clubId": "club_putter",
      "at": isoNow(),
    ], keepPending: false)
  }

  /// Back/Cancel — return to hole play. No Made/Add and no invent GPS.
  func closePuttSheet() {
    userClosedPutt = true
    var sheet = putt
    sheet.open = false
    sheet.pending = nil
    putt = sheet
    syncRoundStay()
  }

  func pickPuttLength(_ lengthId: String) {
    guard putt.canAdd else { return }
    var next = putt
    next.pending = lengthId
    next.canMake = true
    putt = next
  }

  func addPutt(lengthId: String? = nil) {
    guard let lengthId = lengthId ?? putt.pending else { return }
    sending = false
    feedback = ""
    if putt.lengths.count < 5 {
      var next = putt
      next.lengths.append(lengthId)
      next.canAdd = next.lengths.count < 5
      next.pending = nil
      next.canMake = true
      putt = next
    }
    sendPick([
      "type": "puttPick",
      "action": "add",
      "lengthId": lengthId,
      "at": uniquePuttAt(),
    ])
  }

  func undoPutt() {
    sending = false
    feedback = ""
    sendPick([
      "type": "puttPick",
      "action": "undo",
      "at": uniquePuttAt(),
    ])
  }

  func madeIt() {
    dropStaleClubPicks(liveHole: -1)
    sending = false
    feedback = ""
    var payload: [String: Any] = [
      "type": "puttPick",
      "action": "made",
      "at": uniquePuttAt(),
    ]
    if let pending = putt.pending {
      payload["lengthId"] = pending
    }
    sendPick(payload)
  }

  /// Stretch: attach Watch GPS only when the sample is fresh and accurate. Never invent.
  private func attachWatchFix(_ payload: inout [String: Any]) {
    guard let loc = lastFix else { return }
    let age = Date().timeIntervalSince(loc.timestamp)
    let acc = loc.horizontalAccuracy
    guard age <= 3, acc > 0, CLLocationCoordinate2DIsValid(loc.coordinate) else { return }
    payload["lat"] = loc.coordinate.latitude
    payload["lng"] = loc.coordinate.longitude
    payload["accuracyM"] = acc
  }

  /// Freeze live yards where the shot was marked. The anchor is the mark's fix
  /// when one is fresh; otherwise the first fix after 30 s.
  private func beginShotHold() {
    var anchor: CLLocation?
    if let loc = lastFix,
       Date().timeIntervalSince(loc.timestamp) <= 10,
       loc.horizontalAccuracy > 0,
       loc.horizontalAccuracy <= 25,
       CLLocationCoordinate2DIsValid(loc.coordinate) {
      anchor = loc
    }
    shotHold = (hole: list.holeNumber, at: Date(), anchor: anchor)
    let anchored = anchor == nil ? "false" : "true"
    liveYardsLog.info("shot hold started anchor=\(anchored, privacy: .public)")
  }

  /// Edit shot is live when the phone named a last shot on this hole, no undo for
  /// that shot is already on the way, and no club tap is still queued (the
  /// phone's last shot would be out of date until that tap lands).
  var canEditShot: Bool { canUndoShot }

  var canUndoShot: Bool {
    guard list.roundLive, !list.roundComplete, list.shotCount > 0, let shotId = list.lastShotId, !shotId.isEmpty else { return false }
    if undoPendingShotIds.contains(shotId) { return false }
    return !pendingQueue.contains { isClubPick($0) && ($0["clubId"] as? String) != "club_putter" }
  }

  /// Delete shot. The phone runs its own Undo last shot on the shot named here,
  /// so a resend can never remove a second shot.
  /// Not a swing: no shot hold, no Watch GPS, no yards. Never putts or penalties.
  func undoLastShot() {
    guard canUndoShot, let shotId = list.lastShotId else { return }
    let payload: [String: Any] = [
      "type": "shotUndo",
      "id": UUID().uuidString,
      "shotId": shotId,
      "holeNumber": list.holeNumber,
      "at": uniqueClubAt(),
    ]
    sendUndoReliable(payload)
  }

  /// Reassign the club on the last shot. Location and distance stay on the phone.
  /// Not a swing: no shot hold, no Watch GPS, no yards. Never putts or penalties.
  func changeShotClub(_ clubId: String) {
    guard canEditShot, let shotId = list.lastShotId, !clubId.isEmpty else { return }
    let payload: [String: Any] = [
      "type": "shotClubChange",
      "id": UUID().uuidString,
      "shotId": shotId,
      "clubId": clubId,
      "holeNumber": list.holeNumber,
      "at": uniqueClubAt(),
    ]
    sendClubChangeReliable(payload)
  }

  /// Resend each unconfirmed club change with its original id. Never a second shot.
  func retryClubChange() {
    let pending = pendingQueue.filter { isShotClubChange($0) }
    if pending.isEmpty {
      syncClubChangePending()
      return
    }
    for payload in pending {
      sendClubChangeReliable(payload)
    }
  }

  /// Resend each unconfirmed undo with its original id. Never a second shot.
  func retryUndo() {
    let pending = pendingQueue.filter { isShotUndo($0) }
    if pending.isEmpty {
      syncUndoPending()
      return
    }
    for payload in pending {
      sendUndoReliable(payload)
    }
  }

  /// Leave Edit shot and Change club. The hole face shows the confirmation flash.
  func closeEditScreens() {
    editShotOpen = false
    changeClubOpen = false
  }

  /// Back on Edit shot. Not a swing.
  func backFromEditShot() {
    closeEditScreens()
  }

  /// Back on the club list. Returns to the hole. Not a swing.
  func backFromChangeClub() {
    closeEditScreens()
  }

  func openChangeClub() {
    editShotOpen = true
    changeClubOpen = true
  }

  func openEditShot() {
    editShotOpen = true
    changeClubOpen = false
  }

  /// A club was picked. Both edit screens close immediately. The hole screen
  /// shows "Club changed ✓" when the phone confirms. Not a swing.
  func pickEditClub(_ clubId: String) {
    changeShotClub(clubId)
    closeEditScreens()
  }

  /// Delete shot. The edit screen closes immediately. The hole screen shows
  /// "Shot deleted ✓" when the phone confirms. Not a swing.
  func deleteEditedShot() {
    undoLastShot()
    closeEditScreens()
  }

  /// Opens Water / OB / Unplayable / Other. Does not mark a shot.
  func openPenaltyChoices() {
    penaltyChoicesOpen = true
  }

  /// Leave the reason list without a stroke.
  func closePenaltyChoices() {
    penaltyChoicesOpen = false
  }

  /// One penalty stroke after the last shot. The phone writes the row.
  /// No shot hold, no Watch GPS, no par, no yards.
  func pickPenalty(_ reason: String) {
    guard reason == "water" || reason == "ob" || reason == "unplayable" || reason == "other" else { return }
    penaltyChoicesOpen = false
    let payload: [String: Any] = [
      "type": "penaltyPick",
      "id": UUID().uuidString,
      "reason": reason,
      "strokes": 1,
      "holeNumber": list.holeNumber,
      "at": uniqueClubAt(),
    ]
    sendPenaltyReliable(payload)
  }

  /// Resend each unconfirmed penalty with its original id. Never a new stroke.
  func retryPenalty() {
    let pending = pendingQueue.filter { ($0["type"] as? String) == "penaltyPick" }
    if pending.isEmpty {
      penaltyRetry = false
      penaltyNotice = ""
      return
    }
    for payload in pending {
      sendPenaltyReliable(payload)
    }
  }

  private enum ShotHoldDecision { case update, hold, anchor, release }

  private static func shotHoldDecision(
    hold: (hole: Int, at: Date, anchor: CLLocation?)?,
    hole: Int,
    now: Date,
    fix: CLLocation
  ) -> ShotHoldDecision {
    guard let hold, hold.hole == hole else { return .update }
    if now.timeIntervalSince(hold.at) < shotHoldSec { return .hold }
    // GPS scatter on a weak fix is not a walk, and it is no place to measure from.
    let accuracy = fix.horizontalAccuracy
    guard accuracy.isFinite, accuracy > 0, accuracy <= 25 else { return .hold }
    guard let anchor = hold.anchor else { return .anchor }
    let moved = haversineYards(
      lat1: anchor.coordinate.latitude,
      lng1: anchor.coordinate.longitude,
      lat2: fix.coordinate.latitude,
      lng2: fix.coordinate.longitude
    )
    return moved >= shotHoldMinMoveYd ? .release : .hold
  }

  /// A phone push must not move a held number either. Without Watch location
  /// no fix can release the hold, so it then ends after the 30 s.
  private func shotHoldBlocksPhone(hole: Int) -> Bool {
    guard let hold = shotHold, hold.hole == hole else { return false }
    if Date().timeIntervalSince(hold.at) < Self.shotHoldSec { return true }
    let status = location.authorizationStatus
    return status == .authorizedWhenInUse || status == .authorizedAlways
  }

  func pickSameClub() {
    guard let clubId = list.lastClubId else { return }
    pick(clubId: clubId)
  }

  func leave(_ action: String) {
    sending = true
    feedback = ""
    userLeftApp = true
    clearWatchRoundStartPending()
    putt.open = false
    stopRoundStay()
    if action == "home", hasLiveHole {
      nearbyFromHome = true
      nearby.active = true
      nearby.awaitingSelect = true
      nearby.courseId = nil
      nearby.courseName = nil
      nearby.tees = []
      nearby.courses = []
      nearby.holeCount = nil
    }
    sendPick([
      "type": "clubNav",
      "action": action,
      "at": isoNow(),
    ], keepPending: false)
    if action == "home" {
      requestHome()
    }
  }

  /// Round complete → Watch Home. Local only: no clubNav, nothing sent to the phone.
  func homeAfterRound() {
    feedback = ""
    clearWatchRoundStartPending()
    putt.open = false
    nearbyFromHome = true
    nearby.active = true
    nearby.awaitingSelect = true
    nearby.courseId = nil
    nearby.courseName = nil
    nearby.tees = []
    nearby.courses = []
    nearby.holeCount = nil
    syncRoundStay()
    requestHome()
  }

  func dismissNearbyToHole() {
    nearbyFromHome = false
    nearby.active = false
    clearWatchRoundStartPending()
    userLeftApp = false
    feedback = ""
    syncRoundStay()
  }

  private func isoNow() -> String {
    let fmt = ISO8601DateFormatter()
    fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return fmt.string(from: Date())
  }

  /// Distinct `at` per club / putt tap so WCSession replay cannot share a stamp.
  private var lastPuttAt = Date.distantPast
  private func uniqueClubAt() -> String {
    uniquePuttAt()
  }
  private func uniquePuttAt() -> String {
    var now = Date()
    if now.timeIntervalSince(lastPuttAt) < 0.002 {
      now = lastPuttAt.addingTimeInterval(0.002)
    }
    lastPuttAt = now
    let fmt = ISO8601DateFormatter()
    fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return fmt.string(from: now)
  }

  private func isPuttPick(_ payload: [String: Any]) -> Bool {
    payload["type"] as? String == "puttPick"
  }

  private func isClubPick(_ payload: [String: Any]) -> Bool {
    payload["type"] as? String == "clubPick"
  }

  private func sendPick(_ payload: [String: Any], keepPending: Bool = true) {
    if isPuttPick(payload) {
      sendPuttPickReliable(payload)
      return
    }
    if isClubPick(payload) {
      sendClubMarkReliable(payload)
      return
    }
    if isPenaltyPick(payload) {
      sendPenaltyReliable(payload)
      return
    }
    if isHomeCourseStart(payload) {
      sendHomeCourseReliable(payload)
      return
    }
    guard WCSession.isSupported() else {
      failUnavailable(payload, keepPending: keepPending)
      return
    }
    let session = WCSession.default
    if session.isReachable {
      session.sendMessage(payload, replyHandler: { [weak self] reply in
        DispatchQueue.main.async {
          self?.clearPending()
          self?.handleReply(
            reply,
            fallbackClubId: payload["clubId"] as? String,
            type: payload["type"] as? String
          )
        }
      }, errorHandler: { [weak self] _ in
        DispatchQueue.main.async {
          self?.failUnavailable(payload, keepPending: keepPending)
        }
      })
    } else {
      failUnavailable(payload, keepPending: keepPending)
    }
  }

  /// TF 58: club mark uses Watch GPS (already on payload) and queues when
  /// the phone is unreachable. Never freeze on PHONE_UNAVAILABLE.
  private func sendClubMarkReliable(_ payload: [String: Any]) {
    sendReliableQueued(payload)
  }

  private func isPenaltyPick(_ payload: [String: Any]) -> Bool {
    payload["type"] as? String == "penaltyPick"
  }

  /// Same queue as a club mark. Dequeue only after the phone confirms `ok`,
  /// so a failed save or a retry cannot drop or double the stroke.
  /// Does not start the shot hold.
  private func sendPenaltyReliable(_ payload: [String: Any], transfer: Bool = true) {
    enqueuePending(payload)
    sending = false
    guard WCSession.isSupported() else {
      showPenaltyRetry("Couldn’t save")
      return
    }
    let session = WCSession.default
    if transfer {
      session.transferUserInfo(payload)
    }
    if session.isReachable {
      session.sendMessage(payload, replyHandler: { [weak self] reply in
        DispatchQueue.main.async {
          let ok = self?.replyIsOk(reply) ?? false
          if ok {
            self?.dequeuePending(at: payload["at"] as? String)
            self?.acceptConfirmed(kind: "penalty", id: payload["id"] as? String)
            self?.finishPenaltySend()
            self?.handleReply(reply, fallbackClubId: nil, type: payload["type"] as? String)
          } else if self?.stillQueued(kind: "penalty", id: payload["id"] as? String, at: payload["at"] as? String) == true {
            self?.showPenaltyRetry("Couldn’t save")
          } else {
            self?.finishPenaltySend()
          }
        }
      }, errorHandler: { [weak self] _ in
        DispatchQueue.main.async {
          // A watchConfirm may already have removed this id. Do not put Retry back.
          if self?.stillQueued(kind: "penalty", id: payload["id"] as? String, at: payload["at"] as? String) == true {
            self?.showPenaltyRetry("Couldn’t save")
          } else {
            self?.finishPenaltySend()
          }
        }
      })
    } else {
      showPenaltyRetry("Queued · will sync")
    }
  }

  private func isShotUndo(_ payload: [String: Any]) -> Bool {
    payload["type"] as? String == "shotUndo"
  }

  private func isShotClubChange(_ payload: [String: Any]) -> Bool {
    payload["type"] as? String == "shotClubChange"
  }

  /// Same queue as a penalty. Dequeue only after the phone confirms `ok`, so a
  /// failed save or a retry cannot drop the undo or remove a second shot.
  /// Does not start the shot hold.
  private func sendUndoReliable(_ payload: [String: Any], transfer: Bool = true) {
    enqueuePending(payload)
    if let shotId = payload["shotId"] as? String { undoPendingShotIds.insert(shotId) }
    sending = false
    guard WCSession.isSupported() else {
      showUndoRetry("Couldn’t undo")
      return
    }
    let session = WCSession.default
    if transfer {
      session.transferUserInfo(payload)
    }
    if session.isReachable {
      session.sendMessage(payload, replyHandler: { [weak self] reply in
        DispatchQueue.main.async {
          let ok = self?.replyIsOk(reply) ?? false
          if ok {
            self?.dequeuePending(at: payload["at"] as? String)
            self?.acceptConfirmed(kind: "undo", id: payload["id"] as? String)
            self?.finishUndoSend(shotId: payload["shotId"] as? String)
            self?.handleReply(reply, fallbackClubId: nil, type: payload["type"] as? String)
          } else if self?.stillQueued(kind: "undo", id: payload["id"] as? String, at: payload["at"] as? String) == true {
            self?.showUndoRetry("Couldn’t undo")
          } else {
            self?.finishUndoSend(shotId: nil)
          }
        }
      }, errorHandler: { [weak self] _ in
        DispatchQueue.main.async {
          if self?.stillQueued(kind: "undo", id: payload["id"] as? String, at: payload["at"] as? String) == true {
            self?.showUndoRetry("Couldn’t undo")
          } else {
            self?.finishUndoSend(shotId: nil)
          }
        }
      })
    } else {
      showUndoRetry("Queued · will sync")
    }
  }

  private func showUndoRetry(_ notice: String) {
    sending = false
    undoRetry = true
    feedback = notice
    haptic(notice == "Queued · will sync" ? .click : .failure)
  }

  /// The phone answered for this undo id. Shot count and lastShotId stay as the
  /// last club list left them. The next phone push overwrites both.
  private func finishUndoSend(shotId _: String?) {
    syncUndoPending()
  }

  /// Same queue as undo. Dequeue only after the phone confirms `ok`.
  /// Does not start the shot hold, and does not clear the shot — only its club.
  private func sendClubChangeReliable(_ payload: [String: Any], transfer: Bool = true) {
    enqueuePending(payload)
    sending = false
    guard WCSession.isSupported() else {
      showClubChangeRetry("Couldn’t change club")
      return
    }
    let session = WCSession.default
    if transfer {
      session.transferUserInfo(payload)
    }
    if session.isReachable {
      session.sendMessage(payload, replyHandler: { [weak self] reply in
        DispatchQueue.main.async {
          let ok = self?.replyIsOk(reply) ?? false
          if ok {
            self?.dequeuePending(at: payload["at"] as? String)
            self?.acceptConfirmed(kind: "club", id: payload["id"] as? String)
            let changed = (reply["feedback"] as? String) == "Club changed ✓"
            self?.finishClubChangeSend(clubId: changed ? payload["clubId"] as? String : nil)
            self?.handleReply(reply, fallbackClubId: nil, type: payload["type"] as? String)
          } else if self?.stillQueued(kind: "club", id: payload["id"] as? String, at: payload["at"] as? String) == true {
            self?.showClubChangeRetry("Couldn’t change club")
          } else {
            self?.finishClubChangeSend(clubId: nil)
          }
        }
      }, errorHandler: { [weak self] _ in
        DispatchQueue.main.async {
          if self?.stillQueued(kind: "club", id: payload["id"] as? String, at: payload["at"] as? String) == true {
            self?.showClubChangeRetry("Couldn’t change club")
          } else {
            self?.finishClubChangeSend(clubId: nil)
          }
        }
      })
    } else {
      showClubChangeRetry("Queued · will sync")
    }
  }

  private func showClubChangeRetry(_ notice: String) {
    sending = false
    clubChangeRetry = true
    feedback = notice
    haptic(notice == "Queued · will sync" ? .click : .failure)
  }

  /// The phone answered for this club change. The shot stays; only the club moves.
  private func finishClubChangeSend(clubId: String?) {
    if let clubId, !clubId.isEmpty {
      list.lastShotClubId = clubId
      persist(list)
    }
    syncClubChangePending()
  }

  private func syncClubChangePending() {
    clubChangeRetry = pendingQueue.contains { isShotClubChange($0) }
  }

  /// Rebuild the undo state from the saved queue (launch, confirm, dropped hole).
  private func syncUndoPending() {
    let pending = pendingQueue.filter { isShotUndo($0) }
    undoPendingShotIds = Set(pending.compactMap { $0["shotId"] as? String })
    undoRetry = !pending.isEmpty
  }

  private func showPenaltyRetry(_ notice: String) {
    sending = false
    penaltyRetry = true
    penaltyNotice = notice
    feedback = notice
    haptic(notice == "Queued · will sync" ? .click : .failure)
  }

  private func finishPenaltySend() {
    let stillPending = pendingQueue.contains { ($0["type"] as? String) == "penaltyPick" }
    penaltyRetry = stillPending
    if !stillPending {
      penaltyNotice = ""
    }
  }

  /// JSON true may arrive as Bool or as an NSNumber. Either one is a confirm.
  private func replyIsOk(_ reply: [String: Any]) -> Bool {
    if let flag = reply["ok"] as? Bool { return flag }
    if let number = reply["ok"] as? NSNumber { return number.boolValue }
    return false
  }

  /// Combine's `@Published` lock must be taken on the main queue. A setter from
  /// a WCSession or location callback deadlocks the scene-create view update.
  private func requireMainForPublishedState() {
    dispatchPrecondition(condition: .onQueue(.main))
  }

  /// Phone → Watch. sendMessage can reply; transferUserInfo cannot, so the
  /// phone also pushes `watchConfirm` with the accepted id. A duplicate id
  /// confirms again and removes nothing else. `ok` false leaves the queue.
  private func applyWatchAck(_ message: [String: Any]) -> Bool {
    requireMainForPublishedState()
    guard (message["type"] as? String) == "watchConfirm" else { return false }
    guard replyIsOk(message) else { return true }
    let id = message["id"] as? String
    let kind = message["kind"] as? String
    if kind == "penalty" {
      acceptConfirmed(kind: "penalty", id: id)
      finishPenaltySend()
    } else if kind == "undo" {
      let shotId = pendingQueue.first(where: { isShotUndo($0) && ($0["id"] as? String) == id })?["shotId"] as? String
      let flash = message["feedback"] as? String
      acceptConfirmed(kind: "undo", id: id)
      finishUndoSend(shotId: shotId)
      if let flash, !flash.isEmpty, !undoRetry { feedback = flash }
    } else if kind == "club" {
      let clubId = pendingQueue.first(where: { isShotClubChange($0) && ($0["id"] as? String) == id })?["clubId"] as? String
      let flash = message["feedback"] as? String
      acceptConfirmed(kind: "club", id: id)
      let changed = flash == "Club changed ✓"
      finishClubChangeSend(clubId: changed ? clubId : nil)
      if let flash, !flash.isEmpty, !clubChangeRetry { feedback = flash }
    }
    return true
  }

  /// Drop one accepted id. Matching `at` is not required: the confirm names the id.
  private func acceptConfirmed(kind: String, id: String?) {
    guard let id, !id.isEmpty else { return }
    pendingQueue.removeAll { payload in
      guard (payload["id"] as? String) == id else { return false }
      let type = payload["type"] as? String
      if kind == "penalty" { return type == "penaltyPick" }
      if kind == "undo" { return type == "shotUndo" }
      if kind == "club" { return type == "shotClubChange" }
      return false
    }
    savePendingQueue()
  }

  private func stillQueued(kind: String, id: String?, at: String?) -> Bool {
    pendingQueue.contains { payload in
      let type = payload["type"] as? String
      let matchesKind = (kind == "penalty" && type == "penaltyPick") || (kind == "undo" && type == "shotUndo") || (kind == "club" && type == "shotClubChange")
      guard matchesKind else { return false }
      if let id, !id.isEmpty, (payload["id"] as? String) == id { return true }
      if let at, !at.isEmpty, (payload["at"] as? String) == at { return true }
      return false
    }
  }

  /// TF 53 D: puttPick must not depend on isReachable / one pendingClubPick slot.
  /// transferUserInfo queues in order; sendMessage is extra when the phone is awake.
  private func sendPuttPickReliable(_ payload: [String: Any]) {
    sendReliableQueued(payload)
  }

  /// Course pick, round start, and Home/Back must not freeze on PHONE_UNAVAILABLE
  /// when the phone is only background-reachable. Same queue as a club mark.
  private func isHomeCourseStart(_ payload: [String: Any]) -> Bool {
    switch payload["type"] as? String {
    case "nearbyCoursePick", "startRound", "clubNav":
      return true
    default:
      return false
    }
  }

  private func sendHomeCourseReliable(_ payload: [String: Any]) {
    sendReliableQueued(payload)
  }

  private func sendReliableQueued(_ payload: [String: Any], transfer: Bool = true) {
    enqueuePending(payload)
    sending = false
    guard WCSession.isSupported() else {
      noteQueued()
      return
    }
    let session = WCSession.default
    if transfer {
      session.transferUserInfo(payload)
    }
    if session.isReachable {
      session.sendMessage(payload, replyHandler: { [weak self] reply in
        DispatchQueue.main.async {
          self?.dequeuePending(at: payload["at"] as? String)
          self?.handleReply(
            reply,
            fallbackClubId: payload["clubId"] as? String,
            type: payload["type"] as? String
          )
        }
      }, errorHandler: { [weak self] _ in
        DispatchQueue.main.async {
          self?.noteQueued()
        }
      })
    } else {
      noteQueued()
    }
  }

  private func noteQueued() {
    sending = false
    feedback = "Queued · will sync"
    haptic(.click)
  }

  private func handleReply(_ reply: [String: Any], fallbackClubId: String?, type: String? = nil) {
    requireMainForPublishedState()
    sending = false
    let ok = reply["ok"] as? Bool ?? false
    let text: String
    if ok {
      text = reply["feedback"] as? String ?? "marked ✓"
    } else {
      text = "Phone unavailable"
    }
    feedback = text
    haptic(ok ? .success : .failure)
    if ok, type == "startRound" || text.hasPrefix("Started") {
      nearbyFromHome = false
      nearby.active = false
      // startRound, and a favorite that replies "Started…", are a new round
      // from Watch Home. nearbyFromHome alone still left userLeftApp set.
      resumeRoundStayAfterWatchStart()
    }
    if ok, let clubId = fallbackClubId, clubId != "club_putter" {
      list.lastClubId = clubId
      UserDefaults.standard.set(clubId, forKey: "lastClubId")
    }
    if ok, (reply["feedback"] as? String)?.contains("Hole Out") == true {
      closePuttForAdvance(finishedHole: putt.holeNumber)
    }
  }

  private func failUnavailable(_ payload: [String: Any], keepPending: Bool = false) {
    sending = false
    feedback = "Phone unavailable"
    haptic(.failure)
    if keepPending {
      storePending(payload)
    }
  }

  private func storePending(_ payload: [String: Any]) {
    pendingPick = payload
    UserDefaults.standard.set(payload, forKey: pendingKey)
    enqueuePending(payload)
  }

  private func enqueuePending(_ payload: [String: Any]) {
    if let at = payload["at"] as? String,
       pendingQueue.contains(where: { $0["at"] as? String == at }) {
      return
    }
    pendingQueue.append(payload)
    savePendingQueue()
  }

  private func dequeuePending(at: String?) {
    guard let at, !at.isEmpty else { return }
    pendingQueue.removeAll { $0["at"] as? String == at }
    savePendingQueue()
  }

  private func savePendingQueue() {
    UserDefaults.standard.set(pendingQueue, forKey: pendingQueueKey)
  }

  private func clearPending() {
    pendingPick = nil
    UserDefaults.standard.removeObject(forKey: pendingKey)
  }

  private func loadPending() {
    if let rows = UserDefaults.standard.array(forKey: pendingQueueKey) as? [[String: Any]] {
      pendingQueue = rows
    }
    if let legacy = UserDefaults.standard.dictionary(forKey: pendingKey) {
      enqueuePending(legacy)
      pendingPick = nil
      UserDefaults.standard.removeObject(forKey: pendingKey)
    }
  }

  private func haptic(_ type: WKHapticType) {
    WKInterfaceDevice.current().play(type)
  }

  /// Phone list reply (e.g. a pick the phone could not open). Land back on
  /// Watch Home with the phone's line instead of a dead end.
  private func applyNearbyCourses(_ message: [String: Any]) {
    requireMainForPublishedState()
    if hasLiveHole && !nearbyFromHome { return }
    var next = nearby
    next.active = true
    next.awaitingSelect = true
    next.courseId = nil
    next.courseName = nil
    next.tees = []
    next.holeCount = nil
    var courses: [NearbyCourse] = []
    if let rows = message["courses"] as? [[String: Any]] {
      for row in rows {
        guard let id = row["id"] as? String, !id.isEmpty,
              let name = row["name"] as? String, !name.isEmpty else { continue }
        courses.append(NearbyCourse(id: id, name: name))
      }
    }
    next.courses = courses
    if (message["status"] as? String ?? "open_phone") != "ok" {
      feedback = (message["line"] as? String) ?? "open the phone"
    }
    nearby = next
    sending = false
    putt.open = false
  }

  private func parseHomeRows(_ value: Any?, favorite: Bool) -> [HomeCourse] {
    guard let rows = value as? [[String: Any]] else { return [] }
    var out: [HomeCourse] = []
    var seen = Set<String>()
    for row in rows {
      guard let id = row["id"] as? String, !id.isEmpty,
            let name = row["name"] as? String, !name.isEmpty,
            seen.insert(id).inserted else { continue }
      var distance: Int?
      if let meters = row["distanceMeters"] as? Int {
        distance = meters
      } else if let meters = row["distanceMeters"] as? NSNumber {
        distance = meters.intValue
      }
      out.append(HomeCourse(id: id, name: name, favorite: favorite, distanceMeters: distance))
    }
    return out
  }

  /// Phone → Watch Home. Phone favorites win, except a Watch star the phone
  /// has not seen yet (kept for a short window so the row does not flicker).
  private func applyWatchHome(_ message: [String: Any], save: Bool = true) {
    requireMainForPublishedState()
    var next = WatchHomeState()
    next.favorites = parseHomeRows(message["favorites"], favorite: true)
    next.nearby = parseHomeRows(message["nearby"], favorite: false)
    next.line = message["line"] as? String ?? ""
    if let live = message["live"] as? [String: Any] {
      next.liveCourseName = live["courseName"] as? String
      next.liveCourseId = live["courseId"] as? String
    }
    // A delivered home ends Finding courses… / Updating… / Queued · will sync.
    // Never keep the spinner just because an older request was still in flight.
    next.loading = false
    next.queued = false
    let now = Date()
    for (id, pending) in pendingFavorites {
      let phoneHas = next.isFavorite(id)
      if phoneHas == pending.starred || now.timeIntervalSince(pending.at) > pendingFavoriteTTL {
        pendingFavorites[id] = nil
        continue
      }
      let known = home.favorites.first(where: { $0.id == id })
        ?? home.nearby.first(where: { $0.id == id })
        ?? next.nearby.first(where: { $0.id == id })
      if let known {
        next = next.applyingStar(known, starred: pending.starred)
      }
    }
    home = next
    if save {
      saveHome(message)
    }
  }

  private func saveHome(_ message: [String: Any]? = nil) {
    let obj: [String: Any] = message ?? [
      "type": "watchHome",
      "favorites": home.favorites.map { homeRowDict($0) },
      "nearby": home.nearby.map { homeRowDict($0) },
      "line": home.line,
    ]
    if let data = try? JSONSerialization.data(withJSONObject: obj),
       let text = String(data: data, encoding: .utf8) {
      UserDefaults.standard.set(text, forKey: homeKey)
    }
  }

  private func homeRowDict(_ course: HomeCourse) -> [String: Any] {
    var row: [String: Any] = ["id": course.id, "name": course.name]
    if let meters = course.distanceMeters { row["distanceMeters"] = meters }
    return row
  }

  private func loadHome() {
    guard let text = UserDefaults.standard.string(forKey: homeKey),
          let data = text.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
    applyWatchHome(obj, save: false)
  }

  private func applyNearbyTees(_ message: [String: Any]) {
    requireMainForPublishedState()
    if hasLiveHole && !nearbyFromHome { return }
    var next = nearby
    next.active = true
    next.awaitingSelect = false
    if let id = message["courseId"] as? String {
      next.courseId = id
    }
    if let name = message["courseName"] as? String {
      next.courseName = name
    }
    var tees: [NearbyTee] = []
    if let rows = message["tees"] as? [[String: Any]] {
      for row in rows {
        guard let name = row["name"] as? String, !name.isEmpty else { continue }
        tees.append(NearbyTee(name: name))
      }
    }
    next.tees = tees
    nearby = next
  }

  private func applyClubList(_ message: [String: Any], fromPhone: Bool = false) {
    requireMainForPublishedState()
    let type = message["type"] as? String
    // Application context carries the latest Watch Home next to clubList.
    if let nested = message["watchHome"] as? [String: Any] {
      applyWatchHome(nested)
    }
    if type == "watchHome" {
      applyWatchHome(message)
      return
    }
    if type == "puttSheet" {
      applyPuttSheet(message)
      return
    }
    if type == "nearbyCourses" {
      applyNearbyCourses(message)
      return
    }
    if type == "nearbyTees" {
      applyNearbyTees(message)
      return
    }
    guard type == "clubList" else { return }
    let incomingSeq = Self.complicationInt(message["listSeq"]) ?? 0
    let incomingLive = (message["roundLive"] as? Bool) ?? true
    let incomingComplete = (message["roundComplete"] as? Bool) ?? false
    // A late Hole Out placeholder or complication transfer must not rewind the
    // hole or clear the last shot the phone already named. A round end still
    // applies when this launch has not accepted a live list, so a phone
    // relaunch (its listSeq starts over) can clear a saved round.
    if list.listSeq > 0 && incomingSeq < list.listSeq {
      let endsRound = !incomingLive && incomingComplete
      if !(endsRound && !receivedLiveListThisLaunch) {
        return
      }
      workoutLog.info("round end applied despite older listSeq; no live list this launch")
    }
    receivedClubList = true
    if fromPhone && incomingLive && !incomingComplete {
      receivedLiveListThisLaunch = true
      workoutLog.info("live club list received this launch; round is fresh")
    }
    if !nearbyFromHome {
      nearby.active = false
    }
    var next = ClubListState()
    next.top3 = message["top3"] as? [String] ?? []
    next.bag = message["bag"] as? [String] ?? []
    next.labels = message["labels"] as? [String: String] ?? [:]
    if let hole = message["holeNumber"] as? Int {
      next.holeNumber = hole
    } else if let hole = message["holeNumber"] as? NSNumber {
      next.holeNumber = hole.intValue
    }
    if let yards = message["yardsToGreen"] as? Int {
      next.yardsToGreen = yards
    } else if let yards = message["yardsToGreen"] as? NSNumber {
      next.yardsToGreen = yards.intValue
    } else {
      next.yardsToGreen = nil
    }
    next.yardsQuality = message["yardsQuality"] as? String ?? "none"
    let tee = Self.complicationInt(message["teeLengthYards"])
    next.teeLengthYards = (tee ?? 0) > 0 ? tee : nil
    if let lat = Self.complicationDouble(message["greenLat"]),
       let lng = Self.complicationDouble(message["greenLng"]),
       Self.isCourseCoord(lat: lat, lng: lng) {
      next.greenLat = lat
      next.greenLng = lng
    } else {
      next.greenLat = nil
      next.greenLng = nil
      let hole = next.holeNumber
      liveYardsLog.info("clubList missing green hole=\(hole, privacy: .public) green=false")
    }
    if let rawCarry = message["clubCarry"] as? [String: Any] {
      var carry: [String: Int] = [:]
      for (id, value) in rawCarry {
        if let yards = Self.complicationInt(value), yards > 0 { carry[id] = yards }
      }
      next.clubCarry = carry
    } else {
      next.clubCarry = [:]
    }
    let phoneAt = Self.complicationDouble(message["complicationAt"])
    if let hold = shotHold, hold.hole != next.holeNumber {
      shotHold = nil
    }
    let replaceLive = !shotHoldBlocksPhone(hole: next.holeNumber) && Self.phoneLiveShouldReplace(
      phoneHole: next.holeNumber,
      phoneAtMs: phoneAt,
      watchHole: list.liveAtMs > 0 ? list.holeNumber : nil,
      watchAtMs: list.liveAtMs
    )
    if replaceLive {
      if message["complicationQuality"] != nil {
        let quality = message["complicationQuality"] as? String ?? "none"
        next.complicationHole = next.holeNumber >= 1 ? next.holeNumber : 0
        let yards = Self.complicationInt(message["complicationYards"])
        if (quality == "good" || quality == "soft"), let yards, yards > 0 {
          next.complicationYards = yards
          next.complicationQuality = quality
          next.rankHoldHole = next.holeNumber
          next.rankHoldYards = yards
        } else {
          next.complicationYards = nil
          next.complicationQuality = "none"
          if next.holeNumber == list.rankHoldHole {
            next.rankHoldYards = list.rankHoldYards
            next.rankHoldHole = list.rankHoldHole
          } else {
            next.rankHoldYards = nil
            next.rankHoldHole = 0
          }
        }
        next.liveAtMs = phoneAt ?? 0
      } else if next.holeNumber != list.holeNumber {
        next.complicationYards = nil
        next.complicationQuality = "none"
        next.complicationHole = 0
        next.liveAtMs = 0
        next.rankHoldYards = nil
        next.rankHoldHole = 0
      } else {
        next.complicationHole = list.complicationHole
        next.complicationYards = list.complicationYards
        next.complicationQuality = list.complicationQuality
        next.liveAtMs = list.liveAtMs
        next.rankHoldYards = list.rankHoldYards
        next.rankHoldHole = list.rankHoldHole
      }
    } else {
      next.complicationHole = list.complicationHole
      next.complicationYards = list.complicationYards
      next.complicationQuality = list.complicationQuality
      next.liveAtMs = list.liveAtMs
      next.rankHoldYards = list.rankHoldYards
      next.rankHoldHole = list.rankHoldHole
    }
    if next.greenLat == nil {
      next.rankHoldYards = nil
      next.rankHoldHole = 0
    }
    if let last = message["lastClubId"] as? String, !last.isEmpty {
      next.lastClubId = last
    } else {
      next.lastClubId = nil
    }
    if let selected = message["selectedClubId"] as? String, !selected.isEmpty {
      next.selectedClubId = selected
    } else {
      next.selectedClubId = nil
    }
    next.roundComplete = message["roundComplete"] as? Bool ?? false
    next.roundLive = message["roundLive"] as? Bool ?? true
    next.listSeq = incomingSeq > 0 ? incomingSeq : list.listSeq
    let holeChanged = list.holeNumber > 0 && next.holeNumber != list.holeNumber
    // Shot count and last shot come from this push. A push that names them
    // replaces the Watch's copy, including a stale id. A push that omits them
    // does not clear what the phone last sent.
    if let count = Self.complicationInt(message["shotCount"]) {
      let shotId = (message["lastShotId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      if count > 0, !shotId.isEmpty {
        next.shotCount = count
        next.lastShotId = shotId
        let clubId = (message["lastShotClubId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        next.lastShotClubId = clubId.isEmpty ? nil : clubId
      } else {
        next.shotCount = max(0, count)
        next.lastShotId = nil
        next.lastShotClubId = nil
      }
    } else if message["lastShotId"] != nil {
      let shotId = (message["lastShotId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      if shotId.isEmpty {
        next.shotCount = 0
        next.lastShotId = nil
        next.lastShotClubId = nil
      } else {
        next.shotCount = max(list.shotCount, 1)
        next.lastShotId = shotId
        let clubId = (message["lastShotClubId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        next.lastShotClubId = clubId.isEmpty ? list.lastShotClubId : clubId
      }
    } else {
      next.shotCount = list.shotCount
      next.lastShotId = list.lastShotId
      next.lastShotClubId = list.lastShotClubId
    }
    if holeChanged {
      // Cypress H10→H11: leftover 56° must not stay armed on the new hole.
      next.selectedClubId = nil
      next.lastClubId = nil
      lastClubTapId = nil
      lastClubTapAt = Date.distantPast
      userClosedPutt = false
    }
    // Made it on hole N → the next clubList is Hole N+1 (or Round complete).
    // Leave the old putt sheet so the wrist shows Suggested clubs.
    if putt.open, next.roundComplete || (holeChanged && putt.holeNumber != next.holeNumber) {
      closePuttForAdvance(finishedHole: putt.holeNumber)
    }
    list = next
    persist(next)
    refreshAppLiveYardsFace()
    if holeChanged {
      dropStaleClubPicks(liveHole: next.holeNumber)
    }
    if freshLiveListAfterHomeCoursePick(next) {
      workoutLog.info("fresh live club list after Watch Home course pick; resuming round stay")
      resumeRoundStayAfterWatchStart()
    } else {
      syncRoundStay()
    }
  }

  private func applyPuttSheet(_ message: [String: Any]) {
    requireMainForPublishedState()
    let priorPending = putt.pending
    let priorLengths = putt.lengths
    var next = PuttSheetState()
    if let hole = message["holeNumber"] as? Int {
      next.holeNumber = hole
    } else if let hole = message["holeNumber"] as? NSNumber {
      next.holeNumber = hole.intValue
    }
    next.lengths = message["lengths"] as? [String] ?? []
    if let labels = message["labels"] as? [String: String] {
      next.labels = labels
    }
    next.canAdd = message["canAdd"] as? Bool ?? (next.lengths.count < 5)
    next.canMake = true
    let incomingOpen = message["open"] as? Bool ?? false
    // Made it / Hole Out finished this hole on the phone: always close.
    if message["done"] as? Bool == true {
      closePuttForAdvance(finishedHole: next.holeNumber)
      return
    }
    // A late open:true for the hole the phone just finished must not reopen it.
    if finishedPuttHole > 0, next.holeNumber == finishedPuttHole, !putt.open {
      return
    }
    // Phone add/undo can race puttOpen=false and close a Watch-opened sheet
    // (dedicated Putt does not select putter on the wheel). Keep it up.
    // Watch Back/Cancel stays closed — no Made/Add, no invent GPS.
    if userClosedPutt {
      next.open = false
    } else {
      next.open = incomingOpen || putt.open
    }
    if next.canAdd, next.lengths == priorLengths {
      next.pending = priorPending
    }
    putt = next
    syncRoundStay()
  }

  private static let widgetReloadMinYd = 1
  private static let widgetReloadMinSec = 45.0
  private var widgetReload: (hole: Int, yards: Int?, at: Date)?

  private static func complicationInt(_ value: Any?) -> Int? {
    if let yards = value as? Int { return yards }
    if let yards = value as? NSNumber { return yards.intValue }
    if let yards = value as? Double { return Int(yards.rounded()) }
    return nil
  }

  private static func complicationDouble(_ value: Any?) -> Double? {
    if let number = value as? Double { return number }
    if let number = value as? NSNumber { return number.doubleValue }
    if let number = value as? Int { return Double(number) }
    return nil
  }

  /// Course-card coordinate. Rejects missing and 0,0. Mirrors `isCourseCardLatLng`.
  private static func isCourseCoord(lat: Double, lng: Double) -> Bool {
    if !lat.isFinite || !lng.isFinite { return false }
    if lat < -90 || lat > 90 || lng < -180 || lng > 180 { return false }
    if abs(lat) < 0.01 && abs(lng) < 0.01 { return false }
    return true
  }

  /// Phone fix wins only when it is newer than the Watch's own yards for this hole.
  /// Mirrors `phoneLiveShouldReplaceWatch` in src/domain/watchLive.ts.
  private static func phoneLiveShouldReplace(phoneHole: Int, phoneAtMs: Double?, watchHole: Int?, watchAtMs: Double) -> Bool {
    if watchHole == nil || watchAtMs <= 0 || phoneHole != watchHole { return true }
    guard let phoneAtMs, phoneAtMs > 0 else { return false }
    return phoneAtMs > watchAtMs
  }

  /// `planLiveGpsToPin`: good < 15 m, soft ≤ 25 m, else none. Over 600 yd → none.
  private static func liveYards(lat: Double, lng: Double, accuracyM: Double, greenLat: Double, greenLng: Double) -> (yards: Int?, quality: String) {
    if !accuracyM.isFinite || accuracyM < 0 { return (nil, "none") }
    let quality: String
    if accuracyM < 15 { quality = "good" }
    else if accuracyM <= 25 { quality = "soft" }
    else { return (nil, "none") }
    let yards = Int(haversineYards(lat1: lat, lng1: lng, lat2: greenLat, lng2: greenLng).rounded())
    if yards <= 0 || yards > 600 { return (nil, "none") }
    return (yards, quality)
  }

  /// Same earth radius and meters-per-yard as src/domain/haversine.ts.
  private static func haversineYards(lat1: Double, lng1: Double, lat2: Double, lng2: Double) -> Double {
    let earth = 6_371_000.0
    let metersPerYard = 0.9144
    let dLat = (lat2 - lat1) * .pi / 180
    let dLng = (lng2 - lng1) * .pi / 180
    let lat1r = lat1 * .pi / 180
    let lat2r = lat2 * .pi / 180
    let h = sin(dLat / 2) * sin(dLat / 2) + cos(lat1r) * cos(lat2r) * sin(dLng / 2) * sin(dLng / 2)
    let meters = 2 * earth * asin(min(1, sqrt(h)))
    return meters / metersPerYard
  }

  /// Walking update. A locked phone sends nothing. This keeps the latest yards
  /// for the complication. The on-screen number stays put while the wrist is down.
  private func adoptWatchFix(_ fix: CLLocation) {
    requireMainForPublishedState()
    let accuracy = fix.horizontalAccuracy
    let accuracyText = String(format: "%.1f", accuracy)
    guard let greenLat = list.greenLat, let greenLng = list.greenLng else {
      liveYardsLog.info("fix rejected reason=noGreen accuracy=\(accuracyText, privacy: .public) quality=none green=false")
      return
    }
    let atMs = fix.timestamp.timeIntervalSince1970 * 1000
    if list.liveAtMs > 0, atMs <= list.liveAtMs, list.complicationHole == list.holeNumber {
      let quality = list.complicationQuality
      liveYardsLog.info("fix rejected reason=stale accuracy=\(accuracyText, privacy: .public) quality=\(quality, privacy: .public) green=true")
      return
    }
    switch Self.shotHoldDecision(hold: shotHold, hole: list.holeNumber, now: Date(), fix: fix) {
    case .update:
      shotHold = nil
    case .hold:
      return
    case .anchor:
      shotHold?.anchor = fix
      liveYardsLog.info("shot hold anchored after the wait")
      return
    case .release:
      shotHold = nil
      liveYardsLog.info("shot hold released after moving")
    }
    let live = Self.liveYards(
      lat: fix.coordinate.latitude,
      lng: fix.coordinate.longitude,
      accuracyM: accuracy,
      greenLat: greenLat,
      greenLng: greenLng
    )
    var next = list
    next.liveAtMs = atMs
    next.complicationHole = next.holeNumber >= 1 ? next.holeNumber : 0
    if let yards = live.yards {
      next.complicationYards = yards
      next.complicationQuality = live.quality
      next.rankHoldHole = next.holeNumber
      next.rankHoldYards = yards
    } else {
      next.complicationYards = nil
      next.complicationQuality = "none"
      if next.rankHoldHole != next.holeNumber {
        next.rankHoldYards = nil
        next.rankHoldHole = 0
      }
    }
    let yardsText = live.yards.map(String.init) ?? "none"
    let quality = live.quality
    liveYardsLog.info("fix accepted accuracy=\(accuracyText, privacy: .public) quality=\(quality, privacy: .public) yards=\(yardsText, privacy: .public) green=true")
    list = next
    persist(next)
    refreshAppLiveYardsFace()
  }

  private func persist(_ state: ClubListState) {
    let defaults = UserDefaults(suiteName: "group.com.shottrax.app")
    defaults?.set(state.holeNumber, forKey: "holeNumber")
    if let yards = state.yardsToGreen, state.yardsQuality != "none" {
      defaults?.set(yards, forKey: "yardsToGreen")
    } else {
      defaults?.removeObject(forKey: "yardsToGreen")
    }
    defaults?.set(state.yardsQuality, forKey: "yardsQuality")
    if state.complicationHole >= 1 {
      defaults?.set(state.complicationHole, forKey: "complicationHole")
    } else {
      defaults?.removeObject(forKey: "complicationHole")
    }
    if let yards = state.complicationYards, (state.complicationQuality == "good" || state.complicationQuality == "soft"), yards > 0 {
      defaults?.set(yards, forKey: "complicationYards")
      defaults?.set(state.complicationQuality, forKey: "complicationQuality")
    } else {
      defaults?.removeObject(forKey: "complicationYards")
      defaults?.set("none", forKey: "complicationQuality")
    }
    defaults?.set(state.bag, forKey: "bag")
    defaults?.set(state.top3, forKey: "top3")
    defaults?.set(state.labels, forKey: "labels")
    if let last = state.lastClubId {
      defaults?.set(last, forKey: "lastClubId")
    } else {
      defaults?.removeObject(forKey: "lastClubId")
    }
    if let selected = state.selectedClubId {
      defaults?.set(selected, forKey: "selectedClubId")
    } else {
      defaults?.removeObject(forKey: "selectedClubId")
    }
    var obj: [String: Any] = [
      "type": "clubList",
      "top3": state.top3,
      "bag": state.bag,
      "labels": state.labels,
      "holeNumber": state.holeNumber,
      "yardsQuality": state.yardsQuality,
    ]
    if let yards = state.yardsToGreen, state.yardsQuality != "none" {
      obj["yardsToGreen"] = yards
    }
    obj["complicationQuality"] = state.complicationQuality
    if let yards = state.complicationYards, (state.complicationQuality == "good" || state.complicationQuality == "soft"), yards > 0 {
      obj["complicationYards"] = yards
    }
    if state.liveAtMs > 0 { obj["complicationAt"] = state.liveAtMs }
    if let tee = state.teeLengthYards, tee > 0 { obj["teeLengthYards"] = tee }
    if let lat = state.greenLat, let lng = state.greenLng {
      obj["greenLat"] = lat
      obj["greenLng"] = lng
    }
    if !state.clubCarry.isEmpty { obj["clubCarry"] = state.clubCarry }
    if let last = state.lastClubId { obj["lastClubId"] = last }
    if let selected = state.selectedClubId { obj["selectedClubId"] = selected }
    if state.roundComplete { obj["roundComplete"] = true }
    if !state.roundLive { obj["roundLive"] = false }
    obj["shotCount"] = state.shotCount
    if let shotId = state.lastShotId { obj["lastShotId"] = shotId }
    if let clubId = state.lastShotClubId { obj["lastShotClubId"] = clubId }
    if state.listSeq > 0 { obj["listSeq"] = state.listSeq }
    if let data = try? JSONSerialization.data(withJSONObject: obj),
       let text = String(data: data, encoding: .utf8) {
      defaults?.set(text, forKey: "clubListJSON")
    }
    defaults?.synchronize()
    reloadWidgetIfNeeded(state)
  }

  /// WidgetKit budget (~40–70 refreshes/day). Hole changes reload immediately.
  /// While this app is on screen the face is hidden, so nothing else reloads;
  /// leaving the app re-checks. Otherwise the displayed yards must move by ≥1
  /// and the last reload must be at least 45s ago. The in-app wrist-down freeze
  /// does not run here — the complication still follows `list`.
  /// Mirrors `watchWidgetShouldReload`.
  private func reloadWidgetIfNeeded(_ state: ClubListState) {
    let shown: Int? = state.liveYardsTrusted ? state.complicationYards : nil
    let now = Date()
    if let previous = widgetReload, previous.hole == state.holeNumber {
      if sceneIsActive { return }
      if now.timeIntervalSince(previous.at) < Self.widgetReloadMinSec { return }
      let moved: Bool
      switch (previous.yards, shown) {
      case let (prev?, next?):
        moved = abs(next - prev) >= Self.widgetReloadMinYd
      case (nil, nil):
        moved = false
      default:
        moved = true
      }
      if !moved { return }
    }
    widgetReload = (hole: state.holeNumber, yards: shown, at: now)
    ComplicationReloader.reload()
  }

  private func loadFromDefaults() {
    let defaults = UserDefaults(suiteName: "group.com.shottrax.app")
    if let text = defaults?.string(forKey: "clubListJSON"),
       let data = text.data(using: .utf8),
       let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
      applyClubList(obj)
      if receivedClubList { return }
    }
    var next = ClubListState()
    let hole = defaults?.integer(forKey: "holeNumber") ?? 0
    if hole > 0 { next.holeNumber = hole }
    if defaults?.object(forKey: "yardsToGreen") != nil {
      next.yardsToGreen = defaults?.integer(forKey: "yardsToGreen")
    }
    next.yardsQuality = defaults?.string(forKey: "yardsQuality") ?? "none"
    next.bag = defaults?.stringArray(forKey: "bag") ?? []
    next.top3 = defaults?.stringArray(forKey: "top3") ?? []
    next.labels = defaults?.dictionary(forKey: "labels") as? [String: String] ?? [:]
    next.lastClubId = defaults?.string(forKey: "lastClubId")
    next.selectedClubId = defaults?.string(forKey: "selectedClubId")
    let complicationHole = defaults?.integer(forKey: "complicationHole") ?? 0
    if complicationHole >= 1 { next.complicationHole = complicationHole }
    next.complicationQuality = defaults?.string(forKey: "complicationQuality") ?? "none"
    if defaults?.object(forKey: "complicationYards") != nil,
       next.complicationQuality == "good" || next.complicationQuality == "soft" {
      let yards = defaults?.integer(forKey: "complicationYards") ?? 0
      if yards > 0 { next.complicationYards = yards }
    }
    if hole > 0 || !next.bag.isEmpty {
      list = next
      receivedClubList = true
    }
  }

  /// Hole finished: drop the putt sheet (lengths, pending) and go back to club play.
  private func closePuttForAdvance(finishedHole: Int) {
    finishedPuttHole = finishedHole
    var sheet = PuttSheetState()
    sheet.holeNumber = finishedHole
    sheet.open = false
    putt = sheet
    if list.selectedClubId == "club_putter" {
      list.selectedClubId = nil
    }
    syncRoundStay()
  }

  private func dropStaleClubPicks(liveHole: Int) {
    pendingQueue.removeAll { payload in
      // An undo is for its own hole only. Once the round moves on it never
      // reaches back to an earlier hole.
      if isShotUndo(payload) || isShotClubChange(payload) {
        var hole: Int?
        if let value = payload["holeNumber"] as? Int { hole = value }
        else if let value = payload["holeNumber"] as? NSNumber { hole = value.intValue }
        return hole != liveHole
      }
      guard payload["type"] as? String == "clubPick" else { return false }
      if (payload["clubId"] as? String) == "club_putter" { return liveHole < 1 }
      var hole: Int?
      if let value = payload["holeNumber"] as? Int { hole = value }
      else if let value = payload["holeNumber"] as? NSNumber { hole = value.intValue }
      return hole != liveHole
    }
    savePendingQueue()
    syncUndoPending()
    finishPenaltySend()
    syncClubChangePending()
  }

  private func flushPending() {
    requireMainForPublishedState()
    guard WCSession.isSupported(), WCSession.default.isReachable else { return }
    dropStaleClubPicks(liveHole: list.holeNumber)
    if let legacy = pendingPick {
      clearPending()
      enqueuePending(legacy)
    }
    let batch = pendingQueue
    guard !batch.isEmpty else { return }
    sending = false
    for payload in batch {
      if isPenaltyPick(payload) {
        sendPenaltyReliable(payload, transfer: false)
      } else if isShotUndo(payload) {
        sendUndoReliable(payload, transfer: false)
      } else if isShotClubChange(payload) {
        sendClubChangeReliable(payload, transfer: false)
      } else if isPuttPick(payload) || isClubPick(payload) || isHomeCourseStart(payload) {
        sendReliableQueued(payload, transfer: false)
      } else {
        sendPick(payload, keepPending: true)
      }
    }
  }

  /// Saved phone `complicationAt` this recent still counts as a live round.
  /// Mirrors `WATCH_ROUND_FRESH_MS`.
  private static let roundFreshWindow: TimeInterval = 30 * 60

  /// Live hole or open putt sheet, before the freshness gate.
  private var roundLooksLive: Bool {
    !userLeftApp && list.roundLive && ((hasLiveHole && !list.roundComplete) || putt.open)
  }

  /// Saved flags alone are not a live round. Fresh only when this launch
  /// received a live club list, or `liveAtMs` is inside `roundFreshWindow`.
  private var roundIsFresh: Bool {
    if receivedLiveListThisLaunch { return true }
    guard list.liveAtMs > 0 else { return false }
    let ageMs = Date().timeIntervalSince1970 * 1000 - list.liveAtMs
    return ageMs <= Self.roundFreshWindow * 1000
  }

  private func logStaleRoundSkipIfNeeded() {
    guard roundLooksLive, !roundIsFresh else { return }
    guard !loggedStaleRoundSkip else { return }
    loggedStaleRoundSkip = true
    workoutLog.info("round stay skipped; saved round is not fresh")
  }

  private func syncRoundStay() {
    requireMainForPublishedState()
    let next = roundLooksLive && roundIsFresh
    if next && !wantsStay {
      suppressGolfStart = false
      loggedGolfDenial = false
      loggedHealthUnavailable = false
      // The app may already be on screen from before the round, with a request
      // marked in flight that never presented a sheet. Ask again now.
      if sceneIsActive {
        locationAuthRequestInFlight = false
      }
    }
    if next {
      loggedStaleRoundSkip = false
    } else {
      logStaleRoundSkipIfNeeded()
    }
    wantsStay = next
    if wantsStay {
      startRoundStay()
    } else {
      stopRoundStay()
    }
    syncWorkoutDeniedHint()
    syncLiveLocation()
  }

  /// One line on the club list when share is already denied. No new prompt and no retry.
  private func syncWorkoutDeniedHint() {
    if !list.roundLive || list.roundComplete {
      dismissedWorkoutDeniedHint = false
      loggedWorkoutDeniedHint = false
      if !workoutDeniedHint.isEmpty {
        workoutDeniedHint = ""
        workoutLog.info("round ended; clearing wrist-down hint")
      }
      return
    }
    let status: HKAuthorizationStatus = HKHealthStore.isHealthDataAvailable()
      ? healthStore.authorizationStatus(for: HKObjectType.workoutType())
      : .notDetermined
    if status == .sharingAuthorized {
      dismissedWorkoutDeniedHint = false
      loggedWorkoutDeniedHint = false
      if !workoutDeniedHint.isEmpty {
        workoutDeniedHint = ""
        workoutLog.info("authorization status=sharingAuthorized; clearing wrist-down hint")
      }
      return
    }
    guard wantsStay, status == .sharingDenied, !dismissedWorkoutDeniedHint else {
      if !workoutDeniedHint.isEmpty {
        workoutDeniedHint = ""
      }
      return
    }
    guard workoutDeniedHint.isEmpty else { return }
    workoutDeniedHint = Self.workoutDeniedHintText
    if !loggedWorkoutDeniedHint {
      loggedWorkoutDeniedHint = true
      workoutLog.info("workout share denied; status=sharingDenied; showing wrist-down hint")
    }
  }

  func dismissWorkoutDeniedHint() {
    dismissedWorkoutDeniedHint = true
    if !workoutDeniedHint.isEmpty {
      workoutDeniedHint = ""
      workoutLog.info("workout denied hint dismissed for this round")
    }
  }

  /// Home/Back sets `userLeftApp`, which keeps the golf sheet from being asked
  /// until the next scene change. A round started on the Watch asks now.
  private func resumeRoundStayAfterWatchStart() {
    clearWatchRoundStartPending()
    userLeftApp = false
    workoutLog.info("round started from Watch; userLeftApp cleared")
    syncRoundStay()
  }

  private func clearWatchRoundStartPending() {
    watchRoundStartPending = false
    hadLiveRoundAtHomePick = false
    holeAtHomePick = 0
  }

  /// Live club list for a round that was not already on the wrist when the
  /// course was picked. Yardage updates and the next hole of that round are not fresh.
  private func freshLiveListAfterHomeCoursePick(_ next: ClubListState) -> Bool {
    guard watchRoundStartPending else { return false }
    guard next.roundLive && !next.roundComplete else { return false }
    guard !next.bag.isEmpty || !next.top3.isEmpty else { return false }
    if !hadLiveRoundAtHomePick { return true }
    return next.holeNumber == 1 && holeAtHomePick != 1
  }

  /// True while a golf workout exists and has not ended, while end() is in flight,
  /// or while an active session is being recovered. A second start is ignored.
  private var golfWorkoutOccupied: Bool {
    if recoveringGolfWorkout || endingGolfWorkout { return true }
    guard let golfWorkout else { return false }
    switch golfWorkout.state {
    case .ended:
      return false
    default:
      return true
    }
  }

  private func startRoundStay() {
    guard wantsStay, roundIsFresh else { return }
    if golfWorkout?.state == .ended {
      golfWorkout = nil
      endingGolfWorkout = false
    }
    if golfWorkoutOccupied {
      if golfWorkout?.state == .running {
        enableWorkoutBackgroundLocation()
      }
      beginGolfWorkoutSession()
      return
    }
    guard HKHealthStore.isHealthDataAvailable() else {
      if !loggedHealthUnavailable {
        loggedHealthUnavailable = true
        workoutLog.info("HealthKit unavailable; status=unavailable; round continues in the foreground")
      }
      return
    }
    let status = healthStore.authorizationStatus(for: HKObjectType.workoutType())
    let statusLabel = workoutShareStatusLabel(status)
    let sceneLabel = sceneIsActive ? "true" : "false"
    workoutLog.info("authorization status=\(statusLabel, privacy: .public) sceneActive=\(sceneLabel, privacy: .public)")
    switch status {
    case .sharingDenied:
      if !loggedGolfDenial {
        loggedGolfDenial = true
        workoutLog.info("workout share not authorized; status=sharingDenied; round continues in the foreground")
      }
      return
    case .notDetermined:
      // The sheet cannot appear unless we are frontmost. Wait for the next active.
      requestGolfWorkoutAuthorization()
    case .sharingAuthorized:
      // Already allowed: starting from inactive or background keeps the wrist up.
      workoutLog.info("authorization status=sharingAuthorized; starting golf workout session")
      beginGolfWorkoutSession()
    @unknown default:
      workoutLog.info("unknown HealthKit authorization status=\(statusLabel, privacy: .public); round continues in the foreground")
    }
  }

  /// Share workout only. Read nothing — no heart rate, energy, or other types.
  /// Called only while the scene is active; a background request never shows and
  /// can leave `golfAuthInFlight` stuck for the rest of the launch.
  private func requestGolfWorkoutAuthorization() {
    let status = healthStore.authorizationStatus(for: HKObjectType.workoutType())
    let statusLabel = workoutShareStatusLabel(status)
    guard sceneIsActive else {
      workoutLog.info("requestAuthorization not sent; status=\(statusLabel, privacy: .public) sceneActive=false")
      return
    }
    if golfAuthInFlight || golfAuthSheetUp {
      let sheetLabel = golfAuthSheetUp ? "true" : "false"
      workoutLog.info("requestAuthorization not sent; already in flight status=\(statusLabel, privacy: .public) sheetUp=\(sheetLabel, privacy: .public)")
      return
    }
    golfAuthTicket += 1
    let ticket = golfAuthTicket
    golfAuthInFlight = true
    golfAuthSheetUp = true
    let typesToShare: Set<HKSampleType> = [HKObjectType.workoutType()]
    let typesToRead: Set<HKObjectType> = []
    workoutLog.info("requestAuthorization sent; status=\(statusLabel, privacy: .public) share=workoutType read=none")
    healthStore.requestAuthorization(toShare: typesToShare, read: typesToRead) { [weak self] success, error in
      DispatchQueue.main.async {
        guard let self else { return }
        guard self.golfAuthTicket == ticket else {
          self.workoutLog.info("requestAuthorization callback ignored; superseded by a later request")
          return
        }
        self.golfAuthInFlight = false
        self.golfAuthSheetUp = false
        let successLabel = success ? "true" : "false"
        if let error {
          self.workoutLog.info("requestAuthorization callback error: \(error.localizedDescription, privacy: .public) success=\(successLabel, privacy: .public)")
        } else {
          self.workoutLog.info("requestAuthorization callback success=\(successLabel, privacy: .public)")
        }
        let after = self.workoutShareStatusLabel(self.healthStore.authorizationStatus(for: HKObjectType.workoutType()))
        self.workoutLog.info("authorization status after callback=\(after, privacy: .public)")
        guard self.wantsStay else { return }
        // Do not ask again in this callback if the sheet is still unresolved.
        if self.healthStore.authorizationStatus(for: HKObjectType.workoutType()) == .notDetermined {
          self.workoutLog.info("requestAuthorization callback left status=notDetermined; not asking again in this callback")
          return
        }
        self.startRoundStay()
      }
    }
  }

  private func workoutShareStatusLabel(_ status: HKAuthorizationStatus) -> String {
    switch status {
    case .notDetermined:
      return "notDetermined"
    case .sharingDenied:
      return "sharingDenied"
    case .sharingAuthorized:
      return "sharingAuthorized"
    @unknown default:
      return "unknown"
    }
  }

  /// One HKWorkoutSession per process. Recovery, a create already in this
  /// function, and a session that has not ended all refuse another init:
  /// a second `HKWorkoutSession` throws, and a second `startActivity` raises.
  /// Mirrors `watchMayCreateGolfWorkout` in src/domain/watchColdLaunch.ts.
  private static func mayCreateGolfWorkout(
    launchGate: Bool,
    recovering: Bool,
    ending: Bool,
    creating: Bool,
    hasSession: Bool,
    sessionEnded: Bool
  ) -> Bool {
    if launchGate || recovering || ending || creating { return false }
    if hasSession && !sessionEnded { return false }
    return true
  }

  private func beginGolfWorkoutSession() {
    if golfWorkout?.state == .ended {
      golfWorkout = nil
      endingGolfWorkout = false
    }
    let allowed = Self.mayCreateGolfWorkout(
      launchGate: workoutLaunchGate,
      recovering: recoveringGolfWorkout,
      ending: endingGolfWorkout,
      creating: creatingGolfWorkout,
      hasSession: golfWorkout != nil,
      sessionEnded: false
    )
    if !allowed {
      if !loggedBlockedGolfStart {
        loggedBlockedGolfStart = true
        if recoveringGolfWorkout {
          workoutLog.info("golf workout not started; recoverActiveWorkoutSession in progress")
        } else if workoutLaunchGate {
          workoutLog.info("golf workout not started; waiting for workout recovery")
        } else {
          workoutLog.info("golf workout not started; a session is already running")
        }
      }
      return
    }
    if suppressGolfStart { return }
    loggedBlockedGolfStart = false
    creatingGolfWorkout = true
    defer { creatingGolfWorkout = false }
    let configuration = HKWorkoutConfiguration()
    configuration.activityType = .golf
    configuration.locationType = .outdoor
    do {
      let session = try HKWorkoutSession(healthStore: healthStore, configuration: configuration)
      session.delegate = self
      golfWorkout = session
      // end() writes nothing to Health. No builder and no extra sample types.
      // startActivity raises if this session is already running. A brand-new
      // session is prepared; running/paused/ended must not be started again.
      if session.state == .running || session.state == .paused {
        workoutLog.info("golf workout already running; startActivity not called again")
      } else if session.state == .ended {
        golfWorkout = nil
        suppressGolfStart = true
        workoutLog.info("golf workout session did not start: session already ended")
        return
      } else {
        session.startActivity(with: Date())
      }
      // Location background mode is in the watch Info.plist. The property and
      // that mode ship together; setting it without the mode crashes.
      enableWorkoutBackgroundLocation()
      startLiveLocationIfAuthorized()
    } catch {
      golfWorkout = nil
      suppressGolfStart = true
      disableWorkoutBackgroundLocation()
      workoutLog.info("golf workout session did not start: \(error.localizedDescription, privacy: .public)")
    }
  }

  /// `end()` raises unless the session is running or paused, and a second
  /// `end()` of the same object raises. Nil and already-ended are dropped.
  /// Mirrors `watchGolfWorkoutEnd` in src/domain/watchColdLaunch.ts.
  private enum GolfWorkoutEndAction {
    case dropNil
    case dropEnded
    case alreadyEnding
    case end
    case skipNotRunning
  }

  private static func golfWorkoutEndAction(
    hasSession: Bool,
    ended: Bool,
    runningOrPaused: Bool,
    endingThisSession: Bool
  ) -> GolfWorkoutEndAction {
    if !hasSession { return .dropNil }
    if ended { return .dropEnded }
    if endingThisSession { return .alreadyEnding }
    if runningOrPaused { return .end }
    return .skipNotRunning
  }

  private func endGolfWorkout(_ session: HKWorkoutSession?) {
    let endingThisSession = session.map { endingSession === $0 } ?? false
    let action = Self.golfWorkoutEndAction(
      hasSession: session != nil,
      ended: session?.state == .ended,
      runningOrPaused: session?.state == .running || session?.state == .paused,
      endingThisSession: endingThisSession
    )
    switch action {
    case .dropNil:
      if endingSession == nil { endingGolfWorkout = false }
    case .dropEnded:
      if let session {
        if golfWorkout === session { golfWorkout = nil }
        if endingSession === session {
          endingSession = nil
          endingGolfWorkout = false
        }
      }
    case .alreadyEnding:
      break
    case .end:
      guard let session else { return }
      endingSession = session
      endingGolfWorkout = true
      session.end()
    case .skipNotRunning:
      workoutLog.info("golf workout not ended; session is not running")
      if let session, golfWorkout === session { golfWorkout = nil }
      if endingSession == nil { endingGolfWorkout = false }
    }
  }

  private func stopRoundStay() {
    disableWorkoutBackgroundLocation()
    endGolfWorkout(golfWorkout)
  }

  func workoutSession(
    _ workoutSession: HKWorkoutSession,
    didChangeTo toState: HKWorkoutSessionState,
    from _: HKWorkoutSessionState,
    date _: Date
  ) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      guard self.golfWorkout == nil || self.golfWorkout === workoutSession else { return }
      if toState == .running {
        self.endingGolfWorkout = false
        if self.wantsStay {
          self.enableWorkoutBackgroundLocation()
          self.startLiveLocationIfAuthorized()
        }
      }
      if toState == .ended {
        if self.endingSession === workoutSession {
          self.endingSession = nil
          self.endingGolfWorkout = false
        }
        if self.golfWorkout === workoutSession {
          self.golfWorkout = nil
        }
        self.disableWorkoutBackgroundLocation()
        self.syncLiveLocation()
      }
    }
  }

  func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      if self.golfWorkout === workoutSession {
        self.golfWorkout = nil
      }
      self.endingGolfWorkout = false
      self.suppressGolfStart = true
      self.disableWorkoutBackgroundLocation()
      self.syncLiveLocation()
      self.workoutLog.info("golf workout session failed: \(error.localizedDescription, privacy: .public)")
    }
  }

  /// Block workout creation until `scheduleWorkoutLaunchGateRelease` runs.
  /// Init's `syncRoundStay` happens while this is held.
  private func holdWorkoutLaunchGate() {
    workoutLaunchGate = true
  }

  /// Next main turn. Queued after `WCSession.activate()` so a club list
  /// delivered inside activate is applied before a workout can start.
  /// If the system is recovering, that callback starts or keeps the session.
  private func scheduleWorkoutLaunchGateRelease() {
    DispatchQueue.main.async { [weak self] in
      self?.releaseWorkoutLaunchGateIfIdle()
    }
  }

  private func releaseWorkoutLaunchGateIfIdle() {
    guard workoutLaunchGate else { return }
    if workoutRecoveryRequested || recoveringGolfWorkout {
      workoutLaunchGate = false
      return
    }
    workoutLaunchGate = false
    loggedBlockedGolfStart = false
    workoutLog.info("no recoverActiveWorkoutSession this launch; golf session may start")
    syncRoundStay()
  }

  /// Called from `handleActiveWorkoutRecovery` before `recoverActiveWorkoutSession`.
  func beginGolfWorkoutRecovery() {
    workoutRecoveryRequested = true
    recoveringGolfWorkout = true
    workoutLaunchGate = false
    loggedBlockedGolfStart = false
    workoutLog.info("recoverActiveWorkoutSession requested")
  }

  /// Store the system's session as the current one. End it when the round is
  /// not fresh. This app does not use a workout builder.
  func finishGolfWorkoutRecovery(_ session: HKWorkoutSession?, error: Error?) {
    recoveringGolfWorkout = false
    workoutLaunchGate = false
    if let error {
      workoutLog.info("recoverActiveWorkoutSession failed: \(error.localizedDescription, privacy: .public)")
      syncRoundStay()
      return
    }
    guard let session else {
      workoutLog.info("recoverActiveWorkoutSession returned no session")
      syncRoundStay()
      return
    }
    if session.state == .ended {
      workoutLog.info("recoverActiveWorkoutSession returned an ended session")
      syncRoundStay()
      return
    }
    if let created = golfWorkout, created !== session {
      workoutLog.info("recovered golf workout; ending the session started this launch")
      endGolfWorkout(created)
    }
    // No workout builder is used. Reattach the delegate only.
    session.delegate = self
    golfWorkout = session
    workoutLog.info("recovered golf workout; delegate reattached; no builder")
    if roundIsFresh {
      endingGolfWorkout = false
      // The kept session is not a blocked start. Don't log "already running" for it.
      loggedBlockedGolfStart = true
      workoutLog.info("recovered golf workout kept; round is fresh")
    } else {
      workoutLog.info("recovered golf workout ended; round is not fresh")
    }
    // Fresh: the stored session blocks a second start. Stale: this ends it.
    syncRoundStay()
  }

  // WCSession, CLLocationManager, and HKWorkoutSession callbacks are not the
  // main thread. Hop with DispatchQueue.main.async before any @Published write.
  // A synchronous hop onto main from these queues can deadlock the same way.
  // Activation runs on every cold launch — a live round, a round that just
  // ended, or no round — and overlaps the scene-create view update.
  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    // Last context from any launch — not a receive during this process.
    let context = session.receivedApplicationContext
    let activated = activationState == .activated
    DispatchQueue.main.async {
      self.applyClubList(context)
      guard activated else { return }
      self.flushPending()
      self.syncRoundStay()
      if self.hasLiveHole && !self.nearbyFromHome {
        self.nearby.active = false
        return
      }
      self.nearby.active = true
      self.nearby.awaitingSelect = true
      self.requestHome()
    }
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    DispatchQueue.main.async {
      self.applyClubList(applicationContext, fromPhone: true)
    }
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    DispatchQueue.main.async {
      if self.applyWatchAck(message) { return }
      self.applyClubList(message, fromPhone: true)
    }
  }

  func session(
    _ session: WCSession,
    didReceiveMessage message: [String: Any],
    replyHandler: @escaping ([String: Any]) -> Void
  ) {
    // Reply after the hop. A synchronous hop from this queue deadlocks scene creation.
    DispatchQueue.main.async {
      if self.applyWatchAck(message) {
        replyHandler([:])
        return
      }
      self.applyClubList(message, fromPhone: true)
      replyHandler([:])
    }
  }

  /// Phone `transferCurrentComplicationUserInfo` arrives here on watchOS.
  /// The iOS-only complication receive callback is not part of this delegate.
  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    DispatchQueue.main.async {
      if self.applyWatchAck(userInfo) { return }
      self.applyClubList(userInfo, fromPhone: true)
    }
  }

  func session(_ session: WCSession, didFinish userInfoTransfer: WCSessionUserInfoTransfer, error: Error?) {
    DispatchQueue.main.async {
      // Outgoing transfer finished. Published state changes when the phone's
      // watchConfirm arrives, not from this callback.
      _ = userInfoTransfer
      _ = error
    }
  }

  func session(_ session: WCSession, didReceive file: WCSessionFile) {
    DispatchQueue.main.async {
      // The phone does not send files. Do not touch @Published state.
      _ = file
    }
  }

  func session(_ session: WCSession, didFinish fileTransfer: WCSessionFileTransfer, error: Error?) {
    DispatchQueue.main.async {
      _ = fileTransfer
      _ = error
    }
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    let reachable = session.isReachable
    DispatchQueue.main.async {
      guard reachable else { return }
      self.flushPending()
      self.refreshHomeIfShowing()
    }
  }

  /// Same gate as the golf round stay, including freshness. Wrist-down is still
  /// a live hole when the round is fresh, so the launch splash is skipped.
  /// A stale saved round is not: the clip plays, and wrist-down location stops.
  /// An active scene still starts foreground location through `syncLiveLocation`.
  var liveHoleInProgress: Bool {
    roundLooksLive && roundIsFresh
  }

  private func locationAuthLabel(_ status: CLAuthorizationStatus) -> String {
    switch status {
    case .notDetermined:
      return "notDetermined"
    case .restricted:
      return "restricted"
    case .denied:
      return "denied"
    case .authorizedAlways:
      return "authorizedAlways"
    case .authorizedWhenInUse:
      return "authorizedWhenInUse"
    @unknown default:
      return "unknown"
    }
  }

  /// The built Info.plist has UIBackgroundModes `location`. Without it,
  /// setting allowsBackgroundLocationUpdates terminates the app.
  private static let hasBackgroundLocationMode: Bool = {
    let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
    return modes.contains("location")
  }()

  /// Requires UIBackgroundModes `location`. Never set at launch.
  private func enableWorkoutBackgroundLocation() {
    guard !location.allowsBackgroundLocationUpdates else { return }
    // A plist missing the mode loses wrist-down yards instead of crashing.
    guard Self.hasBackgroundLocationMode else {
      liveYardsLog.error("background location not enabled: UIBackgroundModes has no location")
      return
    }
    location.allowsBackgroundLocationUpdates = true
    liveYardsLog.info("background location enabled for the golf workout")
  }

  private func disableWorkoutBackgroundLocation() {
    guard location.allowsBackgroundLocationUpdates else { return }
    location.allowsBackgroundLocationUpdates = false
    liveYardsLog.info("background location disabled")
  }

  /// Foreground start, or a repeat start of a stream that is already running.
  /// A stopped stream cannot be started again until the scene is active.
  private func startLiveLocationIfAuthorized() {
    let status = location.authorizationStatus
    guard status == .authorizedWhenInUse || status == .authorizedAlways else {
      let label = locationAuthLabel(status)
      liveYardsLog.info("location waiting for authorization status=\(label, privacy: .public)")
      return
    }
    if !sceneIsActive && !locationUpdatesStarted {
      liveYardsLog.info("location start deferred until the scene is active")
      return
    }
    location.distanceFilter = sceneIsActive ? kCLDistanceFilterNone : Self.liveDistanceFilterM
    location.startUpdatingLocation()
    if !locationUpdatesStarted {
      locationUpdatesStarted = true
      liveYardsLog.info("location updates started")
    }
  }

  /// Round ended and the wrist is down. Does not run on wrist-down during a hole.
  private func endLiveLocation() {
    disableWorkoutBackgroundLocation()
    guard locationUpdatesStarted else { return }
    location.stopUpdatingLocation()
    locationUpdatesStarted = false
    liveYardsLog.info("location updates stopped")
  }

  /// Mirrors `watchLiveYardsReason`. Dash stays the number. Nil keeps "to hole".
  private static func liveYardsReason(hasTrustedYards: Bool, hasGreen: Bool, authorization: String, accuracyM: Double?) -> String? {
    if hasTrustedYards { return nil }
    if !hasGreen { return "No green" }
    if authorization == "denied" || authorization == "restricted" { return "Location off" }
    if let accuracyM, accuracyM.isFinite, accuracyM > 25 { return "Weak GPS" }
    let usable = accuracyM.map { $0.isFinite && $0 >= 0 && $0 <= 25 } ?? false
    if !usable && authorization == "authorized" { return "Finding GPS" }
    return nil
  }

  private func liveAuthBucket(_ status: CLAuthorizationStatus) -> String {
    switch status {
    case .denied:
      return "denied"
    case .restricted:
      return "restricted"
    case .authorizedWhenInUse, .authorizedAlways:
      return "authorized"
    default:
      return "notDetermined"
    }
  }

  private func syncLiveYardsReason() {
    guard !appLiveYardsFrozen else { return }
    let next = Self.liveYardsReason(
      hasTrustedYards: list.liveYardsTrusted,
      hasGreen: list.greenLat != nil && list.greenLng != nil,
      authorization: liveAuthBucket(location.authorizationStatus),
      accuracyM: lastFix?.horizontalAccuracy
    )
    if next != liveYardsReason {
      liveYardsReason = next
    }
  }

  /// The splash will cover the first open. Set before any scene callback.
  func prepareLaunchSplash() {
    splashShowing = true
  }

  /// Put the logo still up for the system snapshot. A fresh live round keeps the hole.
  func raiseSnapshotCover() {
    guard !liveHoleInProgress else { return }
    guard !snapshotCover else { return }
    snapshotCover = true
    WatchSplashClip.splashLog.info("snapshot cover")
  }

  /// Warm resume. The clip is not replayed; Home shows on the active frame.
  func lowerSnapshotCover() {
    guard snapshotCover else { return }
    snapshotCover = false
  }

  /// Splash left the screen. Ask for When In Use when the scene is active.
  func splashDidFinish() {
    guard splashShowing else { return }
    splashShowing = false
    requestLiveLocationAuthorizationIfNeeded()
  }

  /// Mirrors `watchShouldRequestLocationAuthorization`. Only an active scene
  /// can present the sheet. The next active scene asks again if status is
  /// still notDetermined (`locationAuthRequestInFlight` clears on wrist-down).
  /// The launch splash holds the sheet until the clip is gone. A fresh live
  /// round never sets `splashShowing`, so yards are not delayed.
  private func requestLiveLocationAuthorizationIfNeeded() {
    guard sceneIsActive else { return }
    guard location.authorizationStatus == .notDetermined else {
      locationAuthRequestInFlight = false
      return
    }
    guard !splashShowing else {
      liveYardsLog.info("requestWhenInUseAuthorization waits; splash showing")
      return
    }
    guard !locationAuthRequestInFlight else { return }
    locationAuthRequestInFlight = true
    liveYardsLog.info("requestWhenInUseAuthorization; scene active")
    location.requestWhenInUseAuthorization()
  }

  private func syncLiveLocation() {
    if liveHoleInProgress {
      requestLiveLocationAuthorizationIfNeeded()
      startLiveLocationIfAuthorized()
      return
    }
    if sceneIsActive {
      location.distanceFilter = kCLDistanceFilterNone
      startLiveLocationIfAuthorized()
      return
    }
    endLiveLocation()
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    let status = manager.authorizationStatus
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      let label = self.locationAuthLabel(status)
      self.liveYardsLog.info("authorization=\(label, privacy: .public)")
      switch status {
      case .authorizedWhenInUse, .authorizedAlways:
        self.locationAuthRequestInFlight = false
        self.startLiveLocationIfAuthorized()
      case .denied, .restricted:
        self.disableWorkoutBackgroundLocation()
        self.endLiveLocation()
      case .notDetermined:
        break
      @unknown default:
        break
      }
      self.syncLiveYardsReason()
    }
  }

  func locationManager(_: CLLocationManager, didFailWithError error: Error) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      let ns = error as NSError
      let domain = ns.domain
      let code = ns.code
      self.liveYardsLog.info("location failed domain=\(domain, privacy: .public) code=\(code, privacy: .public)")
      if let clError = error as? CLError, clError.code == .denied {
        self.disableWorkoutBackgroundLocation()
        self.endLiveLocation()
      }
      self.syncLiveYardsReason()
    }
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let fix = locations.last else { return }
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.lastFix = fix
      self.adoptWatchFix(fix)
      self.refreshAppLiveYardsFace()
    }
  }

  /// Wrist-down is inactive, then background. The golf workout keeps the round
  /// up through both, so neither one is a leave and neither ends the session.
  /// The Health sheet is requested only from active. An already-authorized
  /// workout may still start from inactive or background.
  func noteScenePhase(_ phase: String) {
    if phase == "active" {
      sceneIsActive = true
      userLeftApp = false
      let locationLabel = locationAuthLabel(location.authorizationStatus)
      liveYardsLog.info("scene active authorization=\(locationLabel, privacy: .public)")
      // A start that failed while the app was not in front can run now.
      suppressGolfStart = false
      let status = HKHealthStore.isHealthDataAvailable()
        ? healthStore.authorizationStatus(for: HKObjectType.workoutType())
        : HKAuthorizationStatus.notDetermined
      let statusLabel = workoutShareStatusLabel(status)
      if status == .notDetermined && !golfAuthSheetUp {
        let wasInFlight = golfAuthInFlight
        if wasInFlight {
          golfAuthTicket += 1
          golfAuthInFlight = false
          workoutLog.info("scene active; status=\(statusLabel, privacy: .public); no authorization sheet up; resetting golfAuthInFlight")
        } else {
          workoutLog.info("scene active; status=\(statusLabel, privacy: .public); no authorization sheet up")
        }
      } else {
        let sheetLabel = golfAuthSheetUp ? "true" : "false"
        workoutLog.info("scene active; status=\(statusLabel, privacy: .public) sheetUp=\(sheetLabel, privacy: .public)")
      }
      syncRoundStay()
      // Player may have turned Workouts on in Health while we were away.
      syncWorkoutDeniedHint()
      noteLocationScene(active: true)
      requestLiveLocationAuthorizationIfNeeded()
      refreshAppLiveYardsFace()
      return
    }
    if phase == "inactive" || phase == "background" {
      sceneIsActive = false
      locationAuthRequestInFlight = false
      // Wrist-down finishes in background. The system sheet is gone, and a
      // request whose callback never arrives must not block the next active.
      if phase == "background" {
        golfAuthSheetUp = false
      }
      let phaseLabel = phase
      workoutLog.info("scene \(phaseLabel, privacy: .public); requestAuthorization waits until active")
      logStaleRoundSkipIfNeeded()
      if roundLooksLive && roundIsFresh {
        startRoundStay()
      }
      noteLocationScene(active: false)
      // The face is visible again. Catch it up now (same 45s rule); if that
      // is too soon, the next wrist-down fix or the 60s timeline does it.
      reloadWidgetIfNeeded(list)
      refreshAppLiveYardsFace()
    }
  }

  /// Dimmed always-on keeps the scene active. The in-app number still freezes.
  /// Location updates are unchanged.
  func noteLuminanceReduced(_ reduced: Bool) {
    luminanceReduced = reduced
    refreshAppLiveYardsFace()
  }

  /// Wrist-down keeps a running stream. It does not start a stopped one, and
  /// it does not stop updates while a live hole is in progress.
  private func noteLocationScene(active: Bool) {
    if active {
      location.distanceFilter = kCLDistanceFilterNone
      startLiveLocationIfAuthorized()
      return
    }
    guard !liveHoleInProgress else {
      location.distanceFilter = Self.liveDistanceFilterM
      liveYardsLog.info("wrist down; keeping location updates for the live hole")
      return
    }
    endLiveLocation()
  }
}

enum ComplicationReloader {
  /// Ask WidgetKit to read the app group. No location fix and no phone session.
  static func reload() {
    #if canImport(WidgetKit)
    if #available(watchOS 9.0, *) {
      WidgetCenter.shared.reloadTimelines(ofKind: "ShotTraxxHoleYards")
    }
    #endif
  }
}
