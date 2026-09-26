/** Player-facing copy. Accuracy / API / OSM rules stay in code, not on screen. */

/** Published mark (USPTO SN 50113482). ™ only. Not ®. */
export const SHOTTRAXX_BRAND = 'ShotTraxx™' as const;

export const COPY = {
  homeLede: 'Find a course, pick your tee, start the round.',
  homeHeroTitle: 'Ready to tee off?',
  home: 'Home',
  back: 'Back',
  nearbyHint: 'Courses near you — pull to refresh.',
  nearbyEmpty: 'No courses found.',
  nearbyUnavailable: 'Courses aren’t available right now. Pull to refresh or try again.',
  nearbyBusy: 'Looking nearby…',
  nearbyRefresh: 'Pull to refresh',
  courseNamePlaceholder: 'Search by name, city, state, or zip',
  pickTee: 'Pick your tee',
  start18: 'Start 18 holes',
  start9: 'Start 9 holes',
  continueRound: 'Continue round',
  finishRound: 'Finish round',
  edit: 'Edit',
  deleteRound: 'Delete round',
  deleteRoundConfirm: 'Delete this round? Shots and scores go with it.',
  deleteShot: 'Delete shot',
  deleteShotConfirm: 'Delete this shot?',
  roundHistory: 'Round history',
  roundsTransfer: 'Export / Restore rounds',
  roundsTransferHint:
    'Save a copy of your rounds or put them back on this phone. CSV is rounds and shots. Restore adds favorites. The bag changes only after you confirm. Stored only on the device unless you export.',
  exportRounds: 'Export rounds',
  exportRoundsEmpty: 'No rounds to export.',
  exportRoundsDone: 'Rounds exported.',
  exportRoundsFailed: 'Couldn’t export rounds.',
  exportCsv: 'Export CSV',
  exportCsvDone: 'CSV exported.',
  exportCsvFailed: 'Couldn’t export CSV.',
  /** iOS share sheet shows the file name. `Share.share` title is not shown there. */
  exportCsvSheetRounds: '1 of 2 · rounds.csv',
  exportCsvSheetShots: '2 of 2 · shots.csv',
  exportCsvSavedRoundsOnly: 'Saved rounds.csv. Couldn’t open shots.csv.',
  restoreRounds: 'Restore rounds',
  restoreRoundsConfirm:
    'Restore rounds from this file? Existing rounds with the same id will be replaced. Favorites are added. The bag changes only after you confirm the list.',
  restoreRoundsFailed: 'Couldn’t restore rounds.',
  restoreRoundsNotFile:
    'That isn’t a ShotTraxx™ rounds file. Pick the .json from Export rounds. CSV can’t be restored.',
  restoreRoundsCsv: 'CSV can’t be restored. Pick the .json from Export rounds.',
  restoreRoundsEmpty: 'Nothing to restore in that file.',
  restoreRoundsUnreadable: 'Couldn’t read that file.',
  restoreRoundsSaveFailed: 'Couldn’t save the restored rounds.',
  bagRestoreTitle: 'Update bag?',
  bagRestoreHint: 'These are the only bag changes. Cancel leaves the bag as it is.',
  bagRestoreConfirm: 'Update bag',
  bagRestoreDone: 'Bag updated.',
  noRounds: 'Your first round will show up here.',
  firstRoundHint: 'Pick a course and start 9 or 18.',
  nearbyEmptyHint: 'Pull to refresh, or search by name, city, state, or zip.',
  nearbyNeedsLocation: 'Nearby needs location',
  zipGeocodeMiss: 'Couldn’t find that zip.',
  zipGeocodeMissHint: 'Try a city or course name.',
  lastPlayedChip: 'Played',
  roundInProgress: 'Round in progress',
  clearCourse: 'Clear course',
  clearSearch: 'Clear search',
  waitingOnGreen: 'Waiting on green location.',
  waitingOnLocation: 'Waiting on your location.',
  courseCardMissingFrame: 'Need the course tee and green for this hole.',
  hardMissNeedPins: 'HARD-MISS — need pins.',
  hardMissNeedPinsDetail: 'Tee and green are not on file.',
  /** Quiet catalog card. Not a blank map. */
  catalogOnlyHardMiss: 'Catalog only · HARD-MISS',
  /** Worker down or no sane paint. Loud so it is not a GPS bug. */
  paintMissLoud: 'Course map missed.',
  paintMissLoudDetail: 'No saved tee and green. Not a GPS problem.',
  pinSheet: 'Pin sheet',
  approximate: 'Approximate',
  /** Club-mark confidence cue. Bands stay in code — not shown as meters. */
  gpsConfidenceGood: 'good',
  gpsConfidenceOk: 'ok',
  gpsConfidenceWeak: 'weak',
  unavailable: 'Unavailable',
  share: 'Share',
  shareFail: "Couldn't open share",
  shareScorecardFail: 'Couldn’t share scorecard.',
  shareScorecardAndroid: 'Can’t share the scorecard image on Android.',
  shareLive: 'Share live',
  shareScorecard: 'Share scorecard',
  shareLiveRound: 'Share live round',
  liveBoard: 'Live board',
  liveBoardLede: 'Hole scores for friends. No map.',
  liveBoardPrivacy: 'Scores only — no map.',
  liveBoardCode: 'Board code',
  liveBoardWatch: 'Watch a live board',
  liveBoardCodeHint: 'Enter the 6-character code.',
  liveBoardNeedsHost: 'Live refresh on other phones needs the share host.',
  liveFollowSameDevice: 'Following on this phone. Live refresh on other phones needs the share host.',
  paceOfPlay: 'Pace of play',
  liveFollowOpen: 'Follow on this phone',
  liveFollowRefresh: 'Updates after each finished hole.',
  spectatorTitle: SHOTTRAXX_BRAND,
  spectatorLive: 'Live',
  spectatorFinished: 'Finished',
  spectatorNeedsNoLocation: 'Spectator view — no location needed.',
  spectatorEmpty: 'Nothing to show yet.',
  spectatorLoading: 'Loading board…',
  spectatorLoadFail: "Couldn't load this board",
  longPressGreen: 'Long-press to set the green',
  toGreen: 'To green',
  mark: 'Mark',
  marked: 'Marked',
  markWithoutClub: 'Mark without club',
  drop: 'Drop',
  penalty: 'Penalty',
  penaltySaveFailed: 'Couldn’t save the penalty. Try again.',
  changePenalty: 'Change penalty',
  deletePenalty: 'Delete',
  savePenaltyReason: 'Save',
  penaltyNote: 'Note (optional)',
  afterShot: 'After shot',
  sayClub: 'Say a club',
  bag: 'Bag',
  fullBag: 'Full bag',
  allClubs: 'All clubs',
  top3: 'Top 3',
  top3Unlock: 'Top clubs unlock after a few shots',
  pickClub: 'Pick a club',
  pickClubLede: 'Picking a club marks where you hit from.',
  firstLaunchTip: 'Pick a club → walk → press to mark',
  dismissFirstLaunchTip: 'Got it',
  stickyClub: 'Same club',
  undoLast: 'Undo last',
  undoLastShot: 'Undo last shot',
  endShot: 'End last shot',
  prevHole: 'Prev hole',
  nextHole: 'Next hole',
  previousHole: 'Previous hole',
  menu: 'Menu',
  settings: 'Settings',
  credits: 'Credits',
  courseDataCredits: 'Hole maps © OpenStreetMap contributors and OpenGolf (ODbL).',
  osmOverlayCredit: '© OpenStreetMap contributors',
  courseDistance: 'Course distance',
  courseDistanceSetting: 'Course distance: Miles / Kilometers',
  colorTheme: 'Color theme',
  themeDarkLime: 'Dark lime',
  themeLight: 'Light',
  themeHighContrast: 'High contrast',
  miles: 'Miles',
  kilometers: 'Kilometers',
  madeIt: 'Made it',
  holeDone: 'Hole Out',
  finishHole: 'Hole Out',
  holeOut: 'Hole Out',
  putt: 'Putt',
  putts: 'Putts',
  puttSheetLede: 'How long was the putt?',
  puttSheetHint: 'Pick a length, then Made it — or Add putt if you miss.',
  noLength: 'No length',
  noLengthCue: 'No length — pick a distance',
  addPutt: 'Add a putt',
  undoPutt: 'Undo putt',
  forgotShot: 'Log a missed shot',
  addShot: 'Add shot',
  shot: 'Shot',
  placed: 'Placed',
  placeFromHint: 'Tap where you hit from.',
  placeToHint: 'Tap or drag where it landed.',
  cancelPlace: 'Cancel',
  confirmPlace: 'Confirm shot',
  openPhone: 'open the phone',
  /** Watch Search nearby: no Watch fix, no phone location, no cached list. */
  watchNearbyNoLocation: 'No location on Watch or phone. Open ShotTraxx on your phone.',
  /** Watch Search nearby: a location is known, the 40 mi search came back empty. */
  watchNearbyNoneInRadius: 'No courses within 40 mi',
  selectCourse: 'Select course',
  score: 'Score',
  shots: 'Shots',
  noShots: 'Tap your club after hitting to mark your shot.',
  inPlay: 'In play',
  logged: 'Logged',
  suggested: 'Suggested',
  changeClub: 'Change club',
  editShot: 'Edit shot',
  moveSpot: 'Move spot',
  moveSpotHint: 'Drag the pin, then confirm.',
  moveFrom: 'Move from',
  moveTo: 'Move to',
  undoEdit: 'Undo edit',
  editFromHint: 'Tap the new from pin.',
  editToHint: 'Tap the new landing pin.',
  weakLocation: 'Location is weak. Mark anyway?',
  tooFar: 'That looks too far. Mark anyway?',
  markAnyway: 'Mark anyway',
  dropAnyway: 'Drop anyway',
  cancel: 'Cancel',
  locationOff: 'Turn on location to mark.',
  simulator: 'Simulator — move the location pin between shots.',
  restoreBag: 'Restore stock bag',
  bagLede: 'Your bag. Turn off what you don’t carry. Carry is on each row.',
  bagCustomizeTitle: 'Your bag',
  bagCustomizeLede:
    'Type carry on any 3 clubs to estimate the rest, or calculate from actual play.',
  bagCustomizeSkip: 'Calculate from actual play',
  bagCustomizeDone: 'Done',
  averagesLede: 'How far you hit each club — from marked shots.',
  noClosedShots: 'No marked shots yet. Play a hole and they land here.',
  typicalCarry: 'Typical',
  typedCarry: 'Your number',
  typicalCarryYards: 'Carry (yd)',
  clearTypicalCarry: 'Clear carry',
  estimated: 'Estimated',
  bagCarrySuggestionUpdate: 'Update',
  bagCarrySuggestionNotNow: 'Not now',
  averagesDisclaimer:
    'Averages are only as good as the numbers you enter and the GPS data from your rounds.',
  insertShot: 'Insert shot',
  nerdOut: 'Nerd out',
  nerdOutLede: 'Score vs par, putts, fairways, and greens from saved rounds.',
  nerdOutLimits: 'Fairways count par 4s and 5s you tapped. GIR comes from score and putts. No strokes gained.',
  fairways: 'Fairways',
  fairwayMisses: 'Fairway misses',
  gir: 'Greens in reg',
  fairwayPrompt: 'Fairway?',
  scorecardFairway: 'FW',
  scorecardGir: 'GIR',
  nerdOutThisRound: 'This round',
  nerdOutLifetime: 'Saved rounds',
  nerdOutVsPar: 'Vs par',
  nerdOutPuttsPerHole: 'Putts / hole',
  nerdOutPuttsPerRound: 'Putts / round',
  nerdOutFinishedRounds: 'Finished rounds',
  nerdOutLastRound: 'Last round',
  nerdOutHolesScored: 'Holes scored',
  reviewRounds: 'Review previous rounds',
  reviewRoundsEmpty: 'No finished rounds yet.',
  review: 'Review',
  clubData: 'Club data',
  shotReview: 'Shot review',
  stats: 'Stats',
  shotReviewNoMap: 'No tee or green saved for this hole.',
  statsHolesPlayed: 'Holes played',
  statsLongestShot: 'Longest shot',
  statsShortestShot: 'Shortest full swing',
  statsClubAverages: 'Clubs this round',
  statsParAverages: 'Scoring average',
  statsHoleTimes: 'Hole times',
  statsPenaltyStrokes: 'Penalty strokes',
  statsFairwayGir: 'Fairways & greens',
  statsDifferential: 'Score differential',
  strokesGained: 'Strokes gained',
  shotLie: 'Lie',
  shotLieAuto: 'Auto',
  shotLieUnknown: 'Unknown',
  strokesGainedTotal: 'Total',
  strokesGainedUnsplit: 'Not split',
  strokesGainedLede: 'Against a tour pro. Negative is normal — look for the biggest loss.',
  strokesGainedLimits:
    'Lie comes from the course map or your tap in Shot review; unknown lies average fairway and rough. Distance is to the saved green, not the flag. Shots with no GPS start, no green, or no first-putt length land in Not split.',
  strokesGainedEmpty: 'Finish a hole with Made it or Hole Out to see strokes gained.',
  strokesGainedWeakest: 'Most strokes lost:',
  handicap: 'Handicap',
  trends: 'Trends',
  dispersion: 'Dispersion',
  dispersionLede: 'Where each club finishes, measured from where you hit it toward that hole’s green.',
  dispersionLimits:
    'GPS and placed shots with a start, a finish, and a saved green count. Placed shots may be less accurate. Doglegs off the tee can read as misses toward the corner.',
  dispersionEmpty: 'No measured shots yet. Mark shots on holes with a green pin and they land here.',
  dispersionAvg: 'Average',
  dispersionOffLine: 'Off line',
  dispersionDistance: 'Distance (middle 80%)',
  dispersionWidth: 'Left / right (middle 80%)',
  trendsLede: 'How your last rounds compare. 9-hole rounds count per 18.',
  trendsEmpty: 'Finish two rounds to see trends.',
  trendsNoData: 'Nothing saved for this yet.',
  trendsCarry: 'Carry by club',
  trendsStrokesGainedHint: 'Average per 18 holes · vs a tour pro · higher is better',
  trendsStrokesGainedShort: 'Rounds under 9 holes aren’t counted',
  hcpIndex: 'Handicap index',
  handicapLede: 'World Handicap System math on your saved rounds with a rated tee.',
  handicapLimits:
    'Each hole caps at net double bogey. Two 9-hole rounds pair into one score. No playing-conditions adjustment — not an official index.',
  handicapScores: 'Scores',
  handicapUsed: 'Counts',
  handicapEmpty: 'No rounds count yet. A round counts when it is finished, every hole has a score and par, and the tee has a rating and slope.',
  handicapPendingNine: 'A 9-hole round is waiting for another 9 to pair with.',
  statsNoShots: 'No marked shots this round.',
  favorites: 'Favorites',
  favoritesBanner: 'Add your favorite courses here to play without internet.',
  favorite: 'Favorite',
  unfavorite: 'Unfavorite',
  downloadForOffline: 'Download for offline',
  offlineDownloading: 'Downloading',
  offlineReady: 'Ready offline',
  offlineMiss: 'Miss (no map)',
  requestThisCourse: 'Request this course',
  requestCourseTitle: 'Request this course',
  requestCourseLede: `Tell us the course. This opens your email app — ${SHOTTRAXX_BRAND} does not send it for you.`,
  /** TEMP Settings switch for the Yard Test course. Hidden until unlocked outside __DEV__. */
  yardTestCourse: 'Yard test course',
  /** History and CSV label for a round played on the yard test course. */
  testRound: 'Test',
  contributeCourse: 'Contribute a course',
  contributeCourseTitle: 'Add this course',
  contributeOnTee: 'I’m on this tee',
  contributeOnGreen: 'I’m on this green',
  contributeTakePhoto: 'Take scorecard photo',
  contributePickPhoto: 'Pick scorecard photo',
  contributeLocation: 'City or town',
  contributeReviewNote: 'We check every course by hand before it shows up in play.',
  contributeThanks: 'Thanks — if we accept and publish your map, you get 1 free year.',
  contributeGrant: `I grant ${SHOTTRAXX_BRAND} commercial use of this map under terms compatible with ODbL.`,
  contributeEmailButton: 'Email this course',
  requestEmailButton: 'Email this request',
  requestCourseEmailBrand: SHOTTRAXX_BRAND,
  contactEmail: 'ShotTraxx@gmail.com',
  contactHandle: '@ShotTraxx',
  contactLine: 'ShotTraxx@gmail.com · X @ShotTraxx',
  courseName: 'Course name',
  city: 'City',
  notes: 'Notes',
  yourEmail: 'Your email',
  holeCount: 'Holes',
  sheet: 'Tee and green sheet',
  scorecard: 'Scorecard',
  scorecardPar: 'Par',
  summaryHome: 'Home',
} as const;

/**
 * Dispersion summary when some included shots were placed by hand.
 * Null when none were — the screen shows nothing in that case.
 */
export function formatDispersionPlacedNote(count: number): string | null {
  const n = Math.round(count);
  if (!Number.isFinite(n) || n <= 0) return null;
  const shots = n === 1 ? '1 placed shot' : `${n} placed shots`;
  return `Includes ${shots}. Placed shots are set by hand and may be less accurate than GPS-marked ones.`;
}

/** Sheet label for one CSV file. The two export sheets use the COPY lines above. */
export function csvExportSheetTitle(position: number, total: number, filename: string): string {
  if (position === 1 && total === 2 && filename === 'rounds.csv') return COPY.exportCsvSheetRounds;
  if (position === 2 && total === 2 && filename === 'shots.csv') return COPY.exportCsvSheetShots;
  return `${position} of ${total} · ${filename}`;
}

/** Toast for a restore that did not save. CSV is decided by the caller before this. */
export function restoreFailureCopy(reason: string): string {
  if (reason === 'not_shottrax') return COPY.restoreRoundsNotFile;
  if (reason === 'empty') return COPY.restoreRoundsEmpty;
  if (reason === 'unreadable') return COPY.restoreRoundsUnreadable;
  if (reason === 'save_failed') return COPY.restoreRoundsSaveFailed;
  return COPY.restoreRoundsFailed;
}

/** Bag row when the last five dropped shots agree and the typed number does not. */
export function formatBagCarrySuggestion(clubLabel: string, yards: number): string {
  const n = Math.round(yards);
  return `Your last five ${clubLabel} shots averaged ${n}. Update your ${clubLabel} to ${n}?`;
}

/** Suggested chip: that club's carry, not yards-to-green. */
export function formatSuggestedClubChip(shortName: string, carryYards: number | null | undefined): string {
  return carryYards != null && Number.isFinite(carryYards) ? `${shortName} · ${Math.round(carryYards)}` : `${shortName} · —`;
}

/** Picker remaining yards. Pass the planned to-green display. Never invent. */
export function formatPickerLeftYards(result: {
  yards: number | null;
  quality: string;
}): string {
  if (
    (result.quality === 'good' || result.quality === 'soft') &&
    result.yards != null &&
    Number.isFinite(result.yards)
  ) {
    return `${Math.round(result.yards)} left`;
  }
  return '—';
}

export function formatPuttN(n: number): string {
  return `Putt ${n}`;
}

export function finishPuttsChip(holeNumber: number): string {
  return `Finish putts · Hole ${holeNumber}`;
}

export function finishShotChip(holeNumber: number): string {
  return `Finish shot · Hole ${holeNumber}`;
}

/** Hole summary: which real shot closed the hole. Never invented yards. */
export function holeOutClosedOnShot(seq: number): string {
  return `Hole Out · shot ${seq}`;
}

export function formatShotCount(n: number): string {
  const count = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  return count === 1 ? '1 shot' : `${count} shots`;
}

export function formatPuttCount(n: number): string {
  const count = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  return count === 1 ? '1 putt' : `${count} putts`;
}

/** In-round HUD: thru N holes and ±par from finished persisted scores. */
export function formatRunningParBadge(thru: number, toParLabel: string | null): string {
  return toParLabel ? `thru ${thru}, ${toParLabel}` : `thru ${thru}`;
}

export function markedSuggestedMessage(shortName: string): string {
  return `Marked ${shortName} (suggested) · Change club.`;
}

export function formatParLabel(par: number | null): string {
  return par == null ? 'Par unknown' : `Par ${par}`;
}

export function formatSiLabel(handicap: number | null): string {
  return handicap == null ? 'SI unknown' : `SI ${handicap}`;
}

export function formatHoleHeader(holeNumber: number, par: number | null): string {
  return `Hole ${holeNumber} · ${formatParLabel(par)}`;
}

export function formatPlayHeaderPrimary(holeNumber: number): string {
  return `Hole ${holeNumber}`;
}

export function formatPlayHeaderSecondary(
  par: number | null,
  teeName?: string | null,
): string {
  const tee = teeName?.trim();
  return tee ? `${formatParLabel(par)} · ${tee}` : formatParLabel(par);
}

/** Play header: Hole N · Par X plus the yards. No SI. No tee rating. */
export function formatPlayHeader(
  holeNumber: number,
  par: number | null,
  yards: number | null,
): string {
  const yardsBit =
    yards != null && Number.isFinite(yards) ? `${Math.round(yards)} yd` : '—';
  return `${formatHoleHeader(holeNumber, par)} · ${yardsBit}`;
}

/**
 * Visible play header. Tee length from course data (`holes.yards`) only.
 * Missing yardage adds nothing — no dash, no live GPS number.
 */
export function formatPlayHeaderCourseLength(
  holeNumber: number,
  par: number | null,
  teeName: string | null | undefined,
  courseYards: number | null | undefined,
): { primary: string; secondary: string; label: string } {
  const primary = formatPlayHeaderPrimary(holeNumber);
  const parBit = formatPlayHeaderSecondary(par, teeName);
  const yards =
    courseYards != null && Number.isFinite(courseYards) && courseYards > 0
      ? Math.round(courseYards)
      : null;
  const secondary = yards == null ? parBit : `${parBit} · ${yards} yd`;
  return { primary, secondary, label: `${primary} · ${secondary}` };
}

export function formatTeeMeta(tee: {
  name: string;
  rating: number | null;
  slope: number | null;
  totalYards: number | null;
}): string {
  const bits = [
    tee.rating != null ? `Rating ${tee.rating}` : null,
    tee.slope != null ? `Slope ${tee.slope}` : null,
    tee.totalYards != null ? `${tee.totalYards} yd` : null,
  ].filter(Boolean);
  return bits.length ? `${tee.name} · ${bits.join(' · ')}` : tee.name;
}

/** Card yards already on screen → never also say we are waiting on location. */
export function waitingOnLocationWhenYardsShown(): false {
  return false;
}

/** Lock-frame miss is a missing course tee/green. Never a GPS wait. */
export function lockFrameEmptyStateWaitsForPhone(): false {
  return false;
}

/** Hole-map credit. Hidden when this hole is not drawing OSM overlay features. */
export function osmOverlayCreditLabel(featureCount: number): string | null {
  if (!Number.isFinite(featureCount) || featureCount <= 0) return null;
  return COPY.osmOverlayCredit;
}

export function yardsAreOnTheCard(result: { yards: number | null; quality?: string } | null | undefined): boolean {
  return result?.yards != null && Number.isFinite(result.yards);
}

export function showWaitingOnLocationLine(args: {
  yards: number | null;
  quality?: string;
  hasFix?: boolean;
  hasGreen?: boolean;
}): boolean {
  if (yardsAreOnTheCard(args)) return false;
  if (!args.hasGreen) return false;
  return !args.hasFix;
}

export function yardsToGreenPlayerLabel(
  result: { yards: number | null; quality: string },
  ctx: { hasGreen?: boolean; hasFix?: boolean } = {},
): { heading: string; value: string; detail: string } {
  const heading = COPY.toGreen;
  if (result.yards != null && Number.isFinite(result.yards)) {
    return { heading, value: `${result.yards}`, detail: 'yd' };
  }
  const detail = !ctx.hasGreen
    ? COPY.waitingOnGreen
    : !ctx.hasFix
      ? COPY.waitingOnLocation
      : COPY.waitingOnGreen;
  return { heading, value: '—', detail };
}

export function scoreMismatchPlayerMessage(args: {
  score: number | null;
  shotCount: number;
  penaltyStrokes: number;
  puttCount?: number;
}): string {
  return `Score ${args.score} doesn’t match ${args.shotCount} shots + ${args.puttCount ?? 0} putts + ${args.penaltyStrokes} penalties.`;
}
