import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  COPY,
  courseListHeading,
  osmOverlayCreditLabel,
  csvExportSheetTitle,
  restoreFailureCopy,
  finishPuttsChip,
  formatPuttN,
  finishShotChip,
  holeOutClosedOnShot,
  formatPuttCount,
  formatShotCount,
  formatHoleHeader,
  formatPlayHeader,
  formatPlayHeaderCourseLength,
  formatPlayHeaderPrimary,
  formatPlayHeaderSecondary,
  formatRunningParBadge,
  formatParLabel,
  formatPickerLeftYards,
  formatSiLabel,
  formatSuggestedClubChip,
  formatTeeMeta,
  formatDispersionPlacedNote,
  markedSuggestedMessage,
  yardsToGreenPlayerLabel,
  showWaitingOnLocationLine,
  waitingOnLocationWhenYardsShown,
  lockFrameEmptyStateWaitsForPhone,
  yardsAreOnTheCard,
} from './playerCopy';

test('restore failure copy names each reason', () => {
  assert.equal(
    restoreFailureCopy('not_shottrax'),
    'That isn’t a ShotTraxx™ rounds file. Pick the .json from Export rounds. CSV can’t be restored.',
  );
  assert.equal(restoreFailureCopy('not_shottrax'), COPY.restoreRoundsNotFile);
  assert.equal(COPY.restoreRoundsCsv, 'CSV can’t be restored. Pick the .json from Export rounds.');
  assert.equal(restoreFailureCopy('empty'), 'Nothing to restore in that file.');
  assert.equal(restoreFailureCopy('empty'), COPY.restoreRoundsEmpty);
  assert.equal(restoreFailureCopy('unreadable'), 'Couldn’t read that file.');
  assert.equal(restoreFailureCopy('unreadable'), COPY.restoreRoundsUnreadable);
  assert.equal(restoreFailureCopy('save_failed'), 'Couldn’t save the restored rounds.');
  assert.equal(restoreFailureCopy('save_failed'), COPY.restoreRoundsSaveFailed);
  assert.equal(restoreFailureCopy('other'), COPY.restoreRoundsFailed);
});

test('csv export sheet titles name each file', () => {
  assert.equal(COPY.exportCsvSheetRounds, '1 of 2 · rounds.csv');
  assert.equal(COPY.exportCsvSheetShots, '2 of 2 · shots.csv');
  assert.equal(COPY.exportCsvSavedRoundsOnly, 'Saved rounds.csv. Couldn’t open shots.csv.');
  assert.equal(csvExportSheetTitle(1, 2, 'rounds.csv'), COPY.exportCsvSheetRounds);
  assert.equal(csvExportSheetTitle(2, 2, 'shots.csv'), COPY.exportCsvSheetShots);
});

test('player copy uses words, never ? or SI jargon dump', () => {
  assert.equal(formatParLabel(null), 'Par unknown');
  assert.equal(formatParLabel(4), 'Par 4');
  assert.equal(formatSiLabel(null), 'SI unknown');
  assert.equal(formatSiLabel(7), 'SI 7');
  assert.equal(formatHoleHeader(1, null), 'Hole 1 · Par unknown');
  assert.equal(formatHoleHeader(1, 4), 'Hole 1 · Par 4');
  assert.equal(formatPlayHeader(1, 4, 371), 'Hole 1 · Par 4 · 371 yd');
  assert.equal(formatPlayHeader(1, 4, null), 'Hole 1 · Par 4 · —');
  assert.deepEqual(formatPlayHeaderCourseLength(1, 4, null, 385), {
    primary: 'Hole 1',
    secondary: 'Par 4 · 385 yd',
    label: 'Hole 1 · Par 4 · 385 yd',
  });
  assert.deepEqual(formatPlayHeaderCourseLength(1, 4, 'Gold', 385), {
    primary: 'Hole 1',
    secondary: 'Par 4 · Gold · 385 yd',
    label: 'Hole 1 · Par 4 · Gold · 385 yd',
  });
  assert.equal(formatPlayHeaderCourseLength(1, 4, null, null).secondary, 'Par 4');
  assert.doesNotMatch(formatPlayHeaderCourseLength(1, 4, null, null).label, /—|yd/);
  assert.doesNotMatch(formatPlayHeader(1, 4, 371), /SI |Rating |Slope /);
  assert.equal(COPY.homeLede, 'Find a course, pick your tee, start the round.');
  assert.equal(COPY.nearbyHint, 'Courses near you — pull to refresh.');
  assert.equal(COPY.coursesNearYou, 'Courses near you');
  assert.equal(COPY.searchResults, 'Search results');
  assert.equal(COPY.searchBusy, 'Searching…');
  assert.equal(courseListHeading(''), COPY.coursesNearYou);
  assert.equal(courseListHeading('   '), COPY.coursesNearYou);
  assert.equal(courseListHeading('32218'), 'Courses near 32218');
  assert.equal(courseListHeading(' 71753-0001 '), 'Courses near 71753');
  assert.equal(courseListHeading('Jacksonville FL'), COPY.searchResults);
  assert.equal(courseListHeading('322'), COPY.searchResults);
  assert.equal(courseListHeading('magnolia'), COPY.searchResults);
  assert.equal(COPY.waitingOnGreen, 'Waiting on green location.');
  assert.equal(COPY.courseCardMissingFrame, 'Need the course tee and green for this hole.');
  assert.equal(lockFrameEmptyStateWaitsForPhone(), false);
  assert.doesNotMatch(COPY.courseCardMissingFrame, /location|GPS|phone|fix/i);
  assert.equal(COPY.share, 'Share');
  assert.equal(COPY.shareFail, "Couldn't open share");
  assert.equal(COPY.longPressGreen, 'Long-press to set the green');
  assert.equal(COPY.pickClub, 'Pick a club');
  assert.equal(COPY.pickClubLede, 'Picking a club marks where you hit from.');
  assert.equal(COPY.firstLaunchTip, 'Pick a club → walk → press to mark');
  assert.equal(COPY.dismissFirstLaunchTip, 'Got it');
  assert.equal(COPY.sayClub, 'Say a club');
  assert.equal(COPY.allClubs, 'All clubs');
  assert.equal(COPY.top3Unlock, 'Top clubs unlock after a few shots');
  assert.equal(COPY.stickyClub, 'Same club');
  assert.equal(COPY.undoLast, 'Undo last');
  assert.equal(COPY.undoLastShot, 'Undo last shot');
  assert.equal(COPY.markWithoutClub, 'Mark without club');
  assert.equal(COPY.approximate, 'Approximate');
  assert.equal(COPY.gpsConfidenceGood, 'good');
  assert.equal(COPY.gpsConfidenceOk, 'ok');
  assert.equal(COPY.gpsConfidenceWeak, 'weak');
  assert.equal(COPY.suggested, 'Suggested');
  assert.equal(COPY.changeClub, 'Change club');
  assert.equal(COPY.editShot, 'Edit shot');
  assert.equal(COPY.moveSpot, 'Move spot');
  assert.equal(COPY.moveSpotHint, 'Drag the pin, then confirm.');
  assert.equal(COPY.moveFrom, 'Move from');
  assert.equal(COPY.moveTo, 'Move to');
  assert.equal(COPY.undoEdit, 'Undo edit');
  assert.equal(COPY.deleteShot, 'Delete shot');
  assert.equal(COPY.deleteShotConfirm, 'Delete this shot?');
  assert.equal(COPY.editFromHint, 'Tap the new from pin.');
  assert.equal(COPY.editToHint, 'Tap the new landing pin.');
  assert.equal(COPY.bagLede, 'Your bag. Turn off what you don’t carry. Carry is on each row.');
  assert.equal(COPY.restoreBag, 'Restore stock bag');
  assert.equal(COPY.typicalCarry, 'Typical');
  assert.equal(COPY.typicalCarryYards, 'Carry (yd)');
  assert.equal(COPY.clearTypicalCarry, 'Clear carry');
  assert.equal(COPY.bagCustomizeSkip, 'Calculate from actual play');
  assert.equal(COPY.estimated, 'Estimated');
  assert.equal(COPY.insertShot, 'Insert shot');
  assert.equal(COPY.nerdOut, 'Nerd out');
  assert.equal(COPY.nerdOutLede, 'Score vs par, putts, fairways, and greens from saved rounds.');
  assert.equal(COPY.reviewRounds, 'Review previous rounds');
  assert.equal(COPY.clubData, 'Club data');
  assert.equal(COPY.zipGeocodeMiss, 'Couldn’t find that zip.');
  assert.equal(COPY.hardMissNeedPins, 'HARD-MISS — need pins.');
  assert.equal(COPY.hardMissNeedPinsDetail, 'Tee and green are not on file.');
  assert.equal(COPY.catalogOnlyHardMiss, 'Catalog only · HARD-MISS');
  assert.equal(COPY.paintMissLoud, 'Course map missed.');
  assert.equal(COPY.paintMissLoudDetail, 'No saved tee and green. Not a GPS problem.');
  assert.doesNotMatch(`${COPY.catalogOnlyHardMiss} ${COPY.paintMissLoud} ${COPY.paintMissLoudDetail}`, /lat|lng|par \d|yd/i);
  assert.equal(COPY.pinSheet, 'Pin sheet');
  assert.equal(COPY.liveBoard, 'Live board');
  assert.equal(COPY.scorecard, 'Scorecard');
  assert.equal(COPY.putt, 'Putt');
  assert.equal(COPY.putts, 'Putts');
  assert.equal(COPY.madeIt, 'Made it');
  assert.equal(COPY.holeOut, 'Hole Out');
  assert.equal(COPY.holeDone, 'Hole Out');
  assert.equal(COPY.finishHole, 'Hole Out');
  assert.equal(COPY.puttSheetLede, 'How long was the putt?');
  assert.equal(COPY.puttSheetHint, 'Pick a length, then Made it — or Add putt if you miss.');
  assert.equal(COPY.noLength, 'No length');
  assert.equal(COPY.noLengthCue, 'No length — pick a distance');
  assert.equal(COPY.addPutt, 'Add a putt');
  assert.equal(formatPuttN(2), 'Putt 2');
  assert.equal(COPY.menu, 'Menu');
  assert.equal(COPY.previousHole, 'Previous hole');
  assert.equal(COPY.settings, 'Settings');
  assert.equal(COPY.credits, 'Credits');
  assert.match(COPY.courseDataCredits, /OpenStreetMap contributors/);
  assert.match(COPY.courseDataCredits, /OpenGolf/);
  assert.match(COPY.courseDataCredits, /ODbL/);
  assert.equal(COPY.home, 'Home');
  assert.equal(COPY.back, 'Back');
  assert.equal(COPY.addShot, 'Add shot');
  assert.equal(COPY.shot, 'Shot');
  assert.equal(COPY.placed, 'Placed');
  assert.equal(COPY.placeFromHint, 'Tap where you hit from.');
  assert.equal(COPY.placeToHint, 'Tap or drag where it landed.');
  assert.equal(COPY.cancelPlace, 'Cancel');
  assert.equal(COPY.confirmPlace, 'Confirm shot');
  assert.equal(COPY.openPhone, 'open the phone');
  assert.equal(COPY.selectCourse, 'Select course');
  assert.equal(COPY.prevHole, 'Prev hole');
  assert.equal(COPY.nextHole, 'Next hole');
  assert.equal(COPY.courseDistance, 'Course distance');
  assert.equal(COPY.courseDistanceSetting, 'Course distance: Miles / Kilometers');
  assert.equal(COPY.colorTheme, 'Color theme');
  assert.equal(COPY.themeDarkLime, 'Dark lime');
  assert.equal(COPY.themeLight, 'Light');
  assert.equal(COPY.themeHighContrast, 'High contrast');
  assert.equal(COPY.miles, 'Miles');
  assert.equal(COPY.kilometers, 'Kilometers');
  assert.equal(COPY.noRounds, 'Your first round will show up here.');
  assert.equal(COPY.firstRoundHint, 'Pick a course and start 9 or 18.');
  assert.equal(COPY.nearbyEmpty, 'No courses found.');
  assert.equal(COPY.nearbyEmptyHint, 'Pull to refresh, or search by name, city, state, or zip.');
  assert.equal(COPY.nearbyNeedsLocation, 'Nearby needs location');
  assert.equal(COPY.clearSearch, 'Clear search');
  assert.equal(COPY.courseNamePlaceholder, 'Search by name, city, state, or zip');
  assert.equal(COPY.nearbyUnavailable, 'Courses aren’t available right now. Pull to refresh or try again.');
  assert.doesNotMatch(COPY.courseNamePlaceholder, /optional/i);
  assert.doesNotMatch(JSON.stringify(COPY), /Course name \(optional\)|type a course name to start/i);
  assert.equal(formatPlayHeaderPrimary(1), 'Hole 1');
  assert.equal(formatPlayHeaderSecondary(4, 'Gold'), 'Par 4 · Gold');
  assert.equal(formatPlayHeaderSecondary(null), 'Par unknown');
  assert.equal(COPY.noShots, 'Tap your club after hitting to mark your shot.');
  assert.equal(finishPuttsChip(4), 'Finish putts · Hole 4');
  assert.equal(finishShotChip(2), 'Finish shot · Hole 2');
  assert.equal(holeOutClosedOnShot(3), 'Hole Out · shot 3');
  assert.equal(formatShotCount(1), '1 shot');
  assert.equal(formatShotCount(3), '3 shots');
  assert.equal(formatPuttCount(1), '1 putt');
  assert.equal(formatPuttCount(2), '2 putts');
  assert.equal(formatPuttCount(0), '0 putts');
  assert.equal(formatRunningParBadge(3, '−1'), 'thru 3, −1');
  assert.equal(formatRunningParBadge(1, 'E'), 'thru 1, E');
  assert.equal(formatRunningParBadge(2, null), 'thru 2');
  assert.equal(markedSuggestedMessage('7i'), 'Marked 7i (suggested) · Change club.');
});

test('player copy never mentions API, OSM, invent, centroid, or meters', () => {
  const { courseDataCredits, osmOverlayCredit, ...player } = COPY;
  const blob = JSON.stringify(player);
  assert.doesNotMatch(blob, /API|OSM|invent|centroid|Pro green|lat\/lng|accuracy/i);
  assert.match(courseDataCredits, /OpenStreetMap contributors/);
  assert.equal(osmOverlayCredit, '© OpenStreetMap contributors');
});

test('hole map credits OpenStreetMap only while overlay features are drawn', () => {
  assert.equal(COPY.osmOverlayCredit, '© OpenStreetMap contributors');
  assert.equal(osmOverlayCreditLabel(0), null);
  assert.equal(osmOverlayCreditLabel(-1), null);
  assert.equal(osmOverlayCreditLabel(Number.NaN), null);
  assert.equal(osmOverlayCreditLabel(1), '© OpenStreetMap contributors');
  assert.equal(osmOverlayCreditLabel(4), COPY.osmOverlayCredit);
  const map = readFileSync(new URL('../ui/HoleMap.tsx', import.meta.url), 'utf8');
  assert.match(map, /osmOverlayCreditLabel\(osmFeatures\.length\)/);
  assert.match(map, /\{mapCanPaint && osmCredit \?/);
  const fallback = map.slice(map.indexOf('function TrailFallback'), map.indexOf('function NativeHoleMap'));
  assert.doesNotMatch(fallback, /osmOverlayCredit|osmCredit/);
  const web = readFileSync(new URL('../ui/HoleMap.web.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(web, /osmOverlayCredit/);
});

test('yards to green is a big number or — plus waiting copy', () => {
  const live = yardsToGreenPlayerLabel({ yards: 164, quality: 'good' });
  assert.equal(live.value, '164');
  assert.doesNotMatch(live.detail, /SOFT|15–25|GPS/i);

  const missing = yardsToGreenPlayerLabel(
    { yards: null, quality: 'none' },
    { hasFix: true, hasGreen: false },
  );
  assert.equal(missing.value, '—');
  assert.equal(missing.detail, COPY.waitingOnGreen);

  assert.equal(waitingOnLocationWhenYardsShown(), false);
  assert.equal(yardsAreOnTheCard({ yards: 282, quality: 'good' }), true);
  assert.equal(
    showWaitingOnLocationLine({ yards: 282, quality: 'good', hasFix: false, hasGreen: true }),
    false,
  );
  assert.equal(yardsToGreenPlayerLabel({ yards: 282, quality: 'none' }).value, '282');
  assert.doesNotMatch(yardsToGreenPlayerLabel({ yards: 282, quality: 'none' }).detail, /Waiting/);
  assert.equal(
    showWaitingOnLocationLine({ yards: null, quality: 'none', hasFix: false, hasGreen: true }),
    true,
  );
});

test('suggested chips show that club’s carry, not yards-to-green', () => {
  assert.equal(formatSuggestedClubChip('7i', 155), '7i · 155');
  assert.equal(formatSuggestedClubChip('7i', null), '7i · —');
  assert.equal(formatSuggestedClubChip('7i', undefined), '7i · —');
  assert.equal('chipYardsDuringUndo' in COPY, false);
});

test('picker remaining yards are 148 left only when quality is good or soft', () => {
  assert.equal(formatPickerLeftYards({ yards: 148, quality: 'good' }), '148 left');
  assert.equal(formatPickerLeftYards({ yards: 148, quality: 'soft' }), '148 left');
  assert.equal(formatPickerLeftYards({ yards: 148, quality: 'none' }), '—');
  assert.equal(formatPickerLeftYards({ yards: 148, quality: 'forced' }), '—');
  assert.equal(formatPickerLeftYards({ yards: null, quality: 'good' }), '—');
  assert.equal(formatPickerLeftYards({ yards: 282, quality: 'good' }), '282 left');
  assert.equal(formatPickerLeftYards({ yards: 401, quality: 'good' }), '401 left');
  assert.equal(yardsToGreenPlayerLabel({ yards: 282, quality: 'good' }).value, '282');
  assert.equal(yardsToGreenPlayerLabel({ yards: 401, quality: 'good' }).value, '401');
});

test('dispersion placed note is singular or plural, and blank at zero', () => {
  assert.equal(
    formatDispersionPlacedNote(1),
    'Includes 1 placed shot. Placed shots are set by hand and may be less accurate than GPS-marked ones.',
  );
  assert.equal(
    formatDispersionPlacedNote(3),
    'Includes 3 placed shots. Placed shots are set by hand and may be less accurate than GPS-marked ones.',
  );
  assert.equal(formatDispersionPlacedNote(0), null);
  assert.match(COPY.dispersionLimits, /placed shots/i);
  assert.match(COPY.dispersionLimits, /less accurate/);
});

test('tee meta shows rating and slope in player voice when present', () => {
  assert.equal(formatTeeMeta({ name: 'Gold', rating: null, slope: null, totalYards: null }), 'Gold');
  assert.equal(
    formatTeeMeta({ name: 'Gold', rating: 73.3, slope: 128, totalYards: 6800 }),
    'Gold · Rating 73.3 · Slope 128 · 6800 yd',
  );
});
