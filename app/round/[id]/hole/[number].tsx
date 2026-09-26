import * as Device from 'expo-device';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  findNodeHandle,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { catalogEntryById } from '@/src/course/catalog';
import { prefetchCourseHydrateOnce, resolveHydrateTeeGreen } from '@/src/course/hydrate';
import { ensureHoleTeeGreen, scheduleOpenHoleOverlayRetry } from '@/src/course/prefetch';
import {
  cachedOsmOverlay,
  cachedResolvedTee,
  featuresForHole,
  rememberResolvedTee,
  resolveOverlayTee,
} from '@/src/course/osmOverlay';
import { formatParLabel } from '@/src/course/layout';
import type { OsmOverlay } from '@/src/course/types';
import { useDb } from '@/src/db/DbProvider';
import {
  deletePenalty,
  finishRound,
  getClubMap,
  getHole,
  getOpenShotForHole,
  getRound,
  hasSeenFirstLaunchTip,
  insertPenalty,
  listClubAverages,
  listClubs,
  listHoles,
  listPenaltiesForHole,
  listRounds,
  listShotsForHole,
  fillAutoShotLies,
  markFirstLaunchTipSeen,
  getThunderbirdPinSheet,
  saveHoleTee,
  setHoleGreen,
  setThunderbirdPinSheet,
  updateHoleFairway,
  updatePenaltyReason,
  updateHolePar,
  updateHolePutts,
  finishHolePutts,
  finishHoleOut,
  closeOpenShotToExistingPin,
  markHoleStarted,
  attachHolePuttLength,
  updateHoleScore,
} from '@/src/db/repo';
import { pinOrNull, formatFmbRow, hasApiFmb, yardsToGreenDepth } from '@/src/domain/greenDepth';
import { clubPickLeaveRunsAcceptFix, planClubPickLeave } from '@/src/domain/clubPickNav';
import {
  COPY,
  finishPuttsChip,
  finishShotChip,
  formatPlayHeaderCourseLength,
  formatSuggestedClubChip,
  markedSuggestedMessage,
} from '@/src/domain/playerCopy';
import { allClubsHref, playHrefAfterHoleChange } from '@/src/domain/playNav';
import {
  pastRoundCanAddShot,
  pastRoundEditRequested,
  pastRoundMarksOnly,
  pastRoundStoredPaintOnly,
} from '@/src/domain/roundHistory';
import {
  armHoleTransition,
  consumeHoleTransition,
  holeNavDirection,
  holeSlideStartsOffscreenX,
  HOLE_SLIDE_MS,
} from '@/src/domain/holeTransition';
import { canAdvanceHole, holesNeedingOpenShots } from '@/src/domain/holeAdvance';
import { isPutterClubId } from '@/src/domain/defaultBag';
import { catchUpPinFromTap, planCancelCatchUp, planCatchUpSheet } from '@/src/domain/catchUpMap';
import {
  decideCourseCardPaint,
  dumpHole1PayloadsSideBySide,
  logCabotPocket,
  logCourseCardPaint,
  logHole1PayloadsSideBySide,
  scanCabotPocket,
  showPlayDockForCourseCard,
} from '@/src/domain/courseCardPaint';
import {
  courseTeeFromHole,
  diagnoseCourseCardFrame,
  planCourseCardCamera,
  playMapFrameEpoch,
  resolvePlayHoleTee,
} from '@/src/domain/holeCamera';
import { isCourseCardLatLng, isValidLatLng } from '@/src/domain/latLng';
import { deleteShotPrompt } from '@/src/domain/deleteShot';
import { planInsertSlots } from '@/src/domain/insertShot';
import { confirmUndoIsLive, planConfirmUndo, type ConfirmUndoWindow } from '@/src/domain/confirmUndo';
import { confirmPlaceToDraft, courseGreenCenterForLine, resolveAddShotFromPin } from '@/src/domain/placeToDrag';
import { applyWheelSelection, resolveWheelHighlightId } from '@/src/domain/clubSelect';
import { addShotSheetOpeningClubIds, formatClubStripLabel, PHONE_WHEEL_PILL_HEIGHT, PHONE_WHEEL_STRIP_HEIGHT, planClubStrip, toWheelFillClub } from '@/src/domain/clubStrip';
import {
  PLAY_CONTROL_MIN_TAP,
  PLAY_DOCK_ACTION_MIN_HEIGHT,
  PLAY_DOCK_HOLE_OUT_SHRINK_FLEX,
  PLAY_DOCK_PUTT_FLEX,
  PLAY_GLASS_DOCK_LIFT,
  planPlayLayout,
} from '@/src/domain/playLayout';
import {
  firstLaunchTipHistoryRoundCount,
  firstLaunchTipSeenValue,
  shouldShowFirstLaunchTip,
} from '@/src/domain/firstLaunchTip';
import { planPlacedShot } from '@/src/domain/shotSource';
import { planUndoPlacePins } from '@/src/domain/undoLastShot';
import { planUndoLastSoftGpsClubMark } from '@/src/domain/undoSoftGpsClubMark';
import type { LatLng } from '@/src/domain/latLng';
import { penaltyNoteForSave, penaltyStepActionSheet } from '@/src/domain/penaltyEdit';
import { formatPenaltyRow, PENALTY_REASONS, totalPenaltyStrokes } from '@/src/domain/penalty';
import { defaultPenaltyAfterShot, formatHoleCountLine, formatShotStepChip, orderHoleSteps } from '@/src/domain/penaltySteps';
import {
  addPuttLength,
  applyWatchPuttPickToDraft,
  emptyPuttDraft,
  holeAfterDone,
  holesNeedingPutts,
  isHoleOutShot,
  isPuttLengthId,
  madeItAdvancesHole,
  madeItWritesPutts,
  planMadeIt,
  puttDraftAfterHoleOut,
  planPlayDockFinish,
  putterOpensPuttSheet,
  undoLastPutt,
  type PuttDraft,
  type PuttLengthId,
} from '@/src/domain/putts';
import {
  canMoveFromPin,
  canMoveToPin,
  frameMapCenter,
  moveSpotDraftOrigin,
  shotStoredPosition,
  type ShotEditSnapshot,
} from '@/src/domain/shotEdit';
import { addShotSheetRankYards, addShotSuggestYardsLeft, clubToRankInput, lastClosedShotYards, rankDistanceYards, rankTopClubs, resolveAddShotSuggestTarget, resolveLiveSuggestTarget, resolveNextShotDistanceTarget, type LiveSuggestHold } from '@/src/domain/rankClubs';
import { planFinishedHoleMiniSummary } from '@/src/domain/finishedHoleSummary';
import { formatHazardCarry, hazardCarryAccessibilityLabel, planHazardCarries } from '@/src/domain/hazardCarry';
import { holeHasFairway, nextFairwayValue, showFairwayPrompt, type FairwayResult } from '@/src/domain/fairwayGir';
import { planRunningParBadge } from '@/src/domain/runningPar';
import { planScorecardDismiss } from '@/src/domain/scorecard';
import { reconcileHoleScore, scoreMismatchMessage } from '@/src/domain/scoreReconcile';
import { resolveStickyClub, selectClubForMark } from '@/src/domain/stickyClub';
import type { Club, PenaltyReason } from '@/src/domain/types';
import { courseTeeYards, lastLandingMark, markToGreen, planLiveGpsToPin, planPlayHeaderYards, toGreenDisplayFromHole } from '@/src/domain/yardsToGreen';
import { watchClubCarry, watchGreenFields } from '@/src/domain/watchLive';
import { yardsToGreen } from '@/src/sensing/yardsToGreen';
import { describeGpsSource } from '@/src/services/location';
import { formatPaintSourceChip } from '@/src/domain/courseCard';
import { courseNeedsPinSheets, planMissCardCopy } from '@/src/domain/missCard';
import { planPaintMissBanner } from '@/src/domain/paintMiss';
import { thunderbirdCupOnGreen, thunderbirdDailyPin, thunderbirdPinHoleFor } from '@/src/domain/thunderbirdPins';
import { MENU_SHARE_FALLBACK_MS, toastFromShareAttempt } from '@/src/domain/spectator';
import { publishRoundScoreboard, shareLiveBoard, shareRoundSnapshot } from '@/src/services/shareRound';
import { shareKindOrScorecard, type ShareKind } from '@/src/domain/shareChoice';
import { endOpenShot, markShotWithClub, promptForPlan, undoLastShot, undoLastSoftGpsClubMark, closeApproachBeforePutts, addPlacedShot, changeShotClub, moveShotPin, moveShotSpot, undoShotEdit, deleteHoleShot } from '@/src/services/shotActions';
import { useLiveFix } from '@/src/services/useLiveFix';
import { useWatchClubList } from '@/src/services/useWatchClubList';
import { endWatchRound, pushWatchMadeItAdvance, pushWatchPuttSheet, watchAdvanceNamedShot } from '@/src/services/watchClub';
import { MADE_IT_FEEDBACK, PHONE_UNAVAILABLE } from '@/src/domain/watchMessages';
import { HoleOutBadge, QualityBadge } from '@/src/ui/Badge';
import { BigButton } from '@/src/ui/BigButton';
import { ClubButton } from '@/src/ui/ClubButton';
import { ClubStrip } from '@/src/ui/ClubStrip';
import { GpsBanner } from '@/src/ui/GpsBanner';
import { hapticLight, hapticMark, hapticSelect, hapticTap, hapticWarn } from '@/src/ui/haptics';
import { ColorThemeOverride, useColors, useColorTheme } from '@/src/ui/ColorThemeProvider';
import { useAmbientLight } from '@/src/ui/useAmbientLight';
import { playThemeId } from '@/src/domain/playTheme';
import { formatShotLockChip } from '@/src/domain/shotLock';
import { HoleMap } from '@/src/ui/HoleMap';
import { ThunderbirdPinSheetPicker } from '@/src/ui/ThunderbirdPinSheetPicker';
import { FullSheet } from '@/src/ui/Sheet';
import { FinishedPuttRows } from '@/src/ui/FinishedPuttRows';
import { PuttDock } from '@/src/ui/PuttDock';
import { PuttSheetBody } from '@/src/ui/PuttSheetBody';
import { ScorecardBody } from '@/src/ui/ScorecardBody';
import { FairwayPicker } from '@/src/ui/FairwayPicker';
import { ShareChoice } from '@/src/ui/ShareChoice';
import { YardsToGreenBadge } from '@/src/ui/YardsToGreenBadge';
import { watchNamedLastShot } from '@/src/domain/watchShotUndo';
import { tapTarget, type, type ColorPalette } from '@/src/ui/theme';

/** Play may flip to high contrast in bright sun. The whole subtree — map chips,
 * badges, sheets — reads that theme, not only this screen's own styles. */
export default function HoleScreen() {
  const { themeId: savedThemeId } = useColorTheme();
  const ambient = useAmbientLight();
  return (
    <ColorThemeOverride themeId={playThemeId({ saved: savedThemeId, ambient })}>
      <HoleScreenBody />
    </ColorThemeOverride>
  );
}

function HoleScreenBody() {
  const { id, number, putts: puttsParam, menu: menuParam, edit: editParam } = useLocalSearchParams<{
    id: string;
    number: string;
    putts?: string;
    menu?: string;
    edit?: string;
  }>();
  const holeNumber = Number(number);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { db, revision, bump } = useDb();
  const fix = useLiveFix(true);
  const [busy, setBusy] = useState(false);
  const [penaltyOpen, setPenaltyOpen] = useState(false);
  const [scoreOpen, setScoreOpen] = useState(false);
  const [scorecardOpen, setScorecardOpen] = useState(false);
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<View>(null);
  const pendingShareRef = useRef(false);
  const suggestHoldRef = useRef<LiveSuggestHold | null>(null);
  const pendingShareKindRef = useRef<ShareKind>('scorecard');
  const shareFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playFrameNonce, setPlayFrameNonce] = useState(0);
  const [mapFramed, setMapFramed] = useState(false);
  // Hide the dock when the hole param changes before paint. This cannot be a
  // holeNumber effect: that effect runs after HoleMap's onFrameReady and would
  // leave mapFramed false, so the club strip stays unmounted until Home.
  const [dockHoleNumber, setDockHoleNumber] = useState(holeNumber);
  if (holeNumber !== dockHoleNumber) {
    setDockHoleNumber(holeNumber);
    setMapFramed(false);
  }
  const [dockPassMap, setDockPassMap] = useState(false);
  const addShotFromRef = useRef<LatLng | null>(null);
  const [confirmUndo, setConfirmUndo] = useState<ConfirmUndoWindow | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [placeFrom, setPlaceFrom] = useState<LatLng | null>(null);
  const [placeTo, setPlaceTo] = useState<LatLng | null>(null);
  const [placeToDraft, setPlaceToDraft] = useState<LatLng | null>(null);
  const [placeClubOpen, setPlaceClubOpen] = useState(false);
  const [placeMode, setPlaceMode] = useState<'off' | 'from' | 'to' | 'edit-from' | 'edit-to' | 'move-spot'>('off');
  const [moveSpotDropped, setMoveSpotDropped] = useState(false);
  const [insertSeq, setInsertSeq] = useState<number | null>(null);
  const [editShotId, setEditShotId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editClubOpen, setEditClubOpen] = useState(false);
  const [showAllClubs, setShowAllClubs] = useState(false);
  const [editUndo, setEditUndo] = useState<ShotEditSnapshot | null>(null);
  const placing = placeMode !== 'off' || placeClubOpen || editClubOpen;
  const [puttOpen, setPuttOpen] = useState(false);
  const [puttSheetHole, setPuttSheetHole] = useState(holeNumber);
  const [puttDraft, setPuttDraft] = useState<PuttDraft>(emptyPuttDraft());
  const [attachPuttIndex, setAttachPuttIndex] = useState<number | null>(null);
  const [penaltyStrokes, setPenaltyStrokes] = useState(1);
  const [penaltyReason, setPenaltyReason] = useState<PenaltyReason>('water');
  const [penaltyNote, setPenaltyNote] = useState('');
  const [penaltyAfterShotId, setPenaltyAfterShotId] = useState<string | null>(null);
  const [changePenaltyId, setChangePenaltyId] = useState<string | null>(null);
  const [changeReason, setChangeReason] = useState<PenaltyReason>('water');
  const [changeNote, setChangeNote] = useState('');
  const [osmOverlay, setOsmOverlay] = useState<OsmOverlay | null>(null);
  const [checkNonce, setCheckNonce] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [firstLaunchTipDismissed, setFirstLaunchTipDismissed] = useState(false);

  const round = useMemo(() => getRound(db, id), [db, id, revision]);
  const hole = useMemo(() => getHole(db, id, holeNumber), [db, id, holeNumber, revision]);
  const holes = useMemo(() => (round ? listHoles(db, round.id) : []), [db, round, revision]);
  const shots = useMemo(() => (hole ? listShotsForHole(db, hole.id) : []), [db, hole, revision]);
  const penalties = useMemo(
    () => (hole ? listPenaltiesForHole(db, hole.id) : []),
    [db, hole, revision],
  );
  // Auto lie for strokes gained, from the mapped outlines already on screen. Player taps stay.
  useEffect(() => {
    if (!hole || !osmOverlay) return;
    if (fillAutoShotLies(db, [hole.id], osmOverlay.features) > 0) bump();
  }, [db, hole, osmOverlay, shots, bump]);
  const clubs = useMemo(() => listClubs(db, true), [db, revision]);
  const clubMap = useMemo(() => getClubMap(db), [db, revision]);
  const averages = useMemo(() => listClubAverages(db).filter((row) => row.club.enabled), [db, revision]);
  const open = useMemo(
    () => (hole ? getOpenShotForHole(db, hole.id) : null),
    [db, hole, revision],
  );
  const marksOnly = pastRoundMarksOnly({
    finished: Boolean(round?.finishedAt),
    editRequested: pastRoundEditRequested(editParam),
  });
  const readOnly = Boolean(round?.finishedAt) && !marksOnly;
  const historyRoundCount = useMemo(
    () =>
      firstLaunchTipHistoryRoundCount({
        roundIds: listRounds(db).map((row) => row.id),
        currentRoundId: round?.id,
      }),
    [db, revision, round?.id],
  );

  useEffect(() => {
    if (hasSeenFirstLaunchTip(db)) return;
    if (historyRoundCount <= 0) return;
    markFirstLaunchTipSeen(db);
  }, [db, historyRoundCount]);
  const penaltyTotal = totalPenaltyStrokes(penalties);
  const holeSteps = useMemo(() => orderHoleSteps(shots, penalties), [shots, penalties]);
  const reconcile = reconcileHoleScore({
    score: hole?.score ?? null,
    shotCount: shots.length,
    puttCount: hole?.putts ?? 0,
    penaltyStrokes: penaltyTotal,
  });
  const pendingPutts = useMemo(
    () =>
      holesNeedingPutts(
        holes.map((row) => ({
          number: row.number,
          puttsDone: row.puttsDone,
          shotCount: listShotsForHole(db, row.id).length,
          puttCount: row.putts,
        })),
        holeNumber,
      ),
    [db, holes, holeNumber, revision],
  );
  const pendingShots = useMemo(
    () =>
      holesNeedingOpenShots(
        holes.map((row) => ({
          number: row.number,
          hasOpenShot: listShotsForHole(db, row.id).some((shot) => shot.endedAt == null),
        })),
        holeNumber,
      ),
    [db, holes, holeNumber, revision],
  );
  const placedPlan = placeFrom && placeTo ? planPlacedShot(placeFrom, placeTo) : null;
  const placedYards = placedPlan && placedPlan.ok ? placedPlan.distanceYards : null;
  const editingShot = editShotId ? shots.find((shot) => shot.id === editShotId) ?? null : null;
  const pickerYards = editClubOpen ? (editingShot?.distanceYards ?? null) : placedYards;
  const placeBag = clubs.filter((club) => !isPutterClubId(club.id));

  const resetPlace = () => {
    const cancel = planCancelCatchUp();
    setPlaceFrom(cancel.from);
    setPlaceTo(cancel.to);
    setPlaceToDraft(null);
    setPlaceClubOpen(cancel.clubOpen);
    setPlaceMode(cancel.mode);
    setInsertSeq(cancel.insertSeq);
    setEditClubOpen(false);
    setShowAllClubs(false);
    setMoveSpotDropped(false);
  };

  const startCatchUp = (seq: number | null) => {
    if (!pastRoundCanAddShot(marksOnly)) return;
    closeEdit();
    resetPlace();
    setInsertSeq(seq);
    const from = addShotFromRef.current;
    if (from) {
      setPlaceFrom(from);
      setPlaceMode('to');
      return;
    }
    setPlaceMode('from');
  };

  const closeEdit = () => {
    setEditOpen(false);
    setEditClubOpen(false);
    setEditShotId(null);
    setShowAllClubs(false);
    setMoveSpotDropped(false);
    if (placeMode === 'edit-from' || placeMode === 'edit-to' || placeMode === 'move-spot') setPlaceMode('off');
  };

  const openEdit = (shotId: string) => {
    if (placing) return;
    resetPlace();
    setScoreOpen(false);
    setEditShotId(shotId);
    setEditOpen(true);
  };

  const bumpPlayFrame = useCallback(() => {
    setMapFramed(false);
    setPlayFrameNonce((nonce) => nonce + 1);
  }, []);

  const goToHole = (nextNumber: number) => {
    resetPlace();
    closeEdit();
    setEditUndo(null);
    setConfirmUndo(null);
    setMapFramed(false);
    armHoleTransition(holeNavDirection(holeNumber, nextNumber));
    hapticLight();
    router.replace(playHrefAfterHoleChange(id, nextNumber, marksOnly));
  };

  const lastShotClubId = [...shots].reverse().find((shot) => shot.clubId)?.clubId ?? null;
  const sticky = useMemo(
    () =>
      resolveStickyClub({
        enabledClubs: clubs,
        roundLastClubId: round?.lastClubId ?? null,
        lastShotClubId,
      }),
    [clubs, round?.lastClubId, lastShotClubId],
  );
  const toastedRef = useRef<string | null>(null);
  const puttDraftRef = useRef(puttDraft);
  puttDraftRef.current = puttDraft;
  const puttSheetHoleRef = useRef(puttSheetHole);
  puttSheetHoleRef.current = puttSheetHole;
  const puttOpenRef = useRef(puttOpen);
  puttOpenRef.current = puttOpen;

  useEffect(() => {
    const last = shots[shots.length - 1];
    if (!last?.suggested || last.id === toastedRef.current) return;
    toastedRef.current = last.id;
    const name = last.clubId ? clubMap[last.clubId]?.shortName ?? 'club' : 'club';
    setToast(markedSuggestedMessage(name));
  }, [shots, clubMap]);

  useEffect(() => {
    navigation.setOptions({ headerShown: false, title: `Hole ${holeNumber}` });
  }, [navigation, holeNumber]);

  const slideX = useRef(new Animated.Value(0)).current;
  const { width: holeSlideWidth } = useWindowDimensions();
  const holeSlideWidthRef = useRef(holeSlideWidth);
  holeSlideWidthRef.current = holeSlideWidth;
  const pendingHoleSlide = useRef(consumeHoleTransition());

  useLayoutEffect(() => {
    const direction = pendingHoleSlide.current ?? consumeHoleTransition();
    pendingHoleSlide.current = null;
    if (!direction) {
      slideX.setValue(0);
      return;
    }
    slideX.setValue(holeSlideStartsOffscreenX(direction, holeSlideWidthRef.current));
    const anim = Animated.timing(slideX, {
      toValue: 0,
      duration: HOLE_SLIDE_MS,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [holeNumber, slideX]);

  useEffect(() => {
    setSelectedClubId(null);
  }, [holeNumber]);

  useEffect(() => {
    if (toast !== COPY.holeOut) return undefined;
    const id = setTimeout(() => setToast(null), 1200);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!confirmUndo) return undefined;
    const tick = () => {
      const now = Date.now();
      setNowMs(now);
      if (!confirmUndoIsLive(confirmUndo, now)) {
        setConfirmUndo(null);
        bump();
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [confirmUndo, bump]);

  useEffect(() => {
    if (marksOnly) return;
    const greenCandidate =
      hole?.greenLat != null && hole.greenLng != null
        ? { lat: hole.greenLat, lng: hole.greenLng }
        : null;
    const teeCandidate =
      hole?.teeLat != null && hole.teeLng != null ? { lat: hole.teeLat, lng: hole.teeLng } : null;
    const greenPin = isCourseCardLatLng(greenCandidate) ? greenCandidate : null;
    const courseTee = isCourseCardLatLng(teeCandidate) ? teeCandidate : null;
    let live = true;
    let cancelOverlayRetry: () => void = () => {};
    const storedOverlay = cachedOsmOverlay({
      courseId: round?.courseApiId,
      holeNumber,
      green: greenPin,
    });
    if (storedOverlay) setOsmOverlay(storedOverlay);
    const courseLocation =
      round?.courseLat != null && round.courseLng != null
        ? { lat: round.courseLat, lng: round.courseLng }
        : null;
    const catalogPin = isCourseCardLatLng(courseLocation) ? courseLocation : null;
    void ensureHoleTeeGreen({
      courseId: round?.courseApiId,
      holeNumber,
      tee: courseTee,
      green: greenPin,
      location: greenPin ?? courseTee,
      courseLocation: catalogPin,
    })
      .then((frame) => {
        if (!live) return;
        const overlay = cachedOsmOverlay({
          courseId: round?.courseApiId,
          holeNumber,
          green: frame.green,
        });
        if (overlay) setOsmOverlay(overlay);
        if (frame.fetched) setPlayFrameNonce((nonce) => nonce + 1);
        if (overlay) return;
        cancelOverlayRetry = scheduleOpenHoleOverlayRetry(
          {
            courseId: round?.courseApiId,
            holeNumber,
            tee: frame.tee,
            green: frame.green,
            location: frame.green ?? courseTee,
            courseLocation: catalogPin,
          },
          {
            onOverlay: (next) => {
              if (!live) return;
              setOsmOverlay(next);
            },
          },
        );
      })
      .catch(() => {
        // Keep the last overlay. Do not fall back to the clubhouse / phone.
      });
    return () => {
      live = false;
      cancelOverlayRetry();
    };
  }, [
    marksOnly,
    round?.courseApiId,
    round?.courseLat,
    round?.courseLng,
    hole?.greenLat,
    hole?.greenLng,
    hole?.teeLat,
    hole?.teeLng,
    holeNumber,
  ]);

  const greenCandidate =
    hole?.greenLat != null && hole.greenLng != null
      ? { lat: hole.greenLat, lng: hole.greenLng }
      : null;
  const proGreen = isCourseCardLatLng(greenCandidate) ? greenCandidate : null;
  const courseLocation =
    round?.courseLat != null && round.courseLng != null
      ? { lat: round.courseLat, lng: round.courseLng }
      : null;
  const needPins = courseNeedsPinSheets({
    courseApiId: round?.courseApiId,
    name: round?.courseName,
    location: isCourseCardLatLng(courseLocation) ? courseLocation : null,
  });
  const missCopy = planMissCardCopy({ needPins });
  const requestCourse = {
    name: round?.courseName ?? '',
    city: catalogEntryById(round?.courseApiId)?.city ?? '',
    courseId: round?.courseApiId ?? '',
  };
  const overlay =
    osmOverlay ??
    cachedOsmOverlay({ courseId: round?.courseApiId, holeNumber, green: proGreen });
  const courseTee = courseTeeFromHole(hole);
  const overlayTee = resolveOverlayTee(overlay, holeNumber, proGreen);
  const cachedTee = cachedResolvedTee({ courseId: round?.courseApiId, holeNumber, green: proGreen });
  const proTee = resolvePlayHoleTee({
    courseTee,
    overlayTee,
    cachedTee,
    green: proGreen,
  });
  const hydrated = resolveHydrateTeeGreen({
    name: round?.courseName,
    location: isCourseCardLatLng(courseLocation) ? courseLocation : null,
    holeNumber,
    tee: proTee,
    green: proGreen,
  });
  const holeTee = pastRoundStoredPaintOnly(marksOnly) ? proTee : hydrated.tee;
  const pinSheet = getThunderbirdPinSheet(db);
  const tbHole = needPins ? thunderbirdPinHoleFor(holeNumber) : null;
  const dailyPin = needPins ? thunderbirdDailyPin(holeNumber, pinSheet) : null;
  const greenCenter = pastRoundStoredPaintOnly(marksOnly) ? proGreen : hydrated.green;
  const green = thunderbirdCupOnGreen(greenCenter, dailyPin);
  const sheetOnGreen = greenCenter ? tbHole : null;
  const pins = {
    front: pinOrNull(
      hole?.greenFrontLat != null && hole.greenFrontLng != null
        ? { lat: hole.greenFrontLat, lng: hole.greenFrontLng }
        : sheetOnGreen?.greenFront,
    ),
    middle: pinOrNull(greenCenter),
    back: pinOrNull(
      hole?.greenBackLat != null && hole.greenBackLng != null
        ? { lat: hole.greenBackLat, lng: hole.greenBackLng }
        : sheetOnGreen?.greenBack,
    ),
    depthYards: hole?.greenDepthYards ?? sheetOnGreen?.greenDepthYards ?? null,
  };
  const toGreenDisplay = toGreenDisplayFromHole({
    courseYards: hole?.yards ?? tbHole?.whiteYards ?? null,
    green,
    shots,
  });
  const yardsToGreenResult = {
    yards: toGreenDisplay.yards,
    quality: toGreenDisplay.quality,
  };
  const fmb = hasApiFmb(pins) ? formatFmbRow(yardsToGreenDepth(fix, pins)) : null;
  const toGreen = yardsToGreenResult;
  const teeToGreen = markToGreen(holeTee, green);
  const pinTarget = resolveNextShotDistanceTarget({
    landingToGreen: markToGreen(lastLandingMark(shots), green),
    teeToGreen,
    courseToGreen: toGreen,
    lastClosedYards: lastClosedShotYards(shots),
  });
  /** Corner badge under the header: live GPS → green pin; — when GPS is poor, no pin, or > 600 yd. */
  const liveGpsToPin = planLiveGpsToPin({ fix, green });
  // Reach / carry for OSM-mapped bunkers and water in play, from live good/soft GPS only.
  const hazardCarries = useMemo(
    () =>
      readOnly || marksOnly || liveGpsToPin.quality === 'none' || !fix
        ? []
        : planHazardCarries({
            fix: { lat: fix.lat, lng: fix.lng },
            green,
            features: featuresForHole(overlay, holeNumber),
          }),
    [readOnly, marksOnly, liveGpsToPin.quality, fix, green, overlay, holeNumber],
  );
  // Suggested top-3 re-rank as the player walks in: live good/soft yards win;
  // quality none keeps the last good/soft D on this hole; else the pin target.
  const liveSuggest = resolveLiveSuggestTarget({
    holeNumber,
    live: readOnly || marksOnly ? { yards: null, quality: 'none' } : liveGpsToPin,
    held: suggestHoldRef.current,
    fallback: pinTarget,
  });
  suggestHoldRef.current = liveSuggest.held;
  const target = liveSuggest.target;
  const ranked = rankTopClubs(
    averages.map((row) => clubToRankInput(row.club, row)),
    target,
  );
  const stripPlan = planClubStrip({
    clubs: clubs.map((club) => {
      const row = averages.find((item) => item.club.id === club.id);
      return toWheelFillClub(club, row);
    }),
    yardsLeft: target?.dYards ?? toGreen.yards,
    selectedClubId,
  });
  const stripItems = stripPlan.ids.map((id) => {
    const club = clubs.find((row) => row.id === id);
    return { id, label: formatClubStripLabel({ id, shortName: club?.shortName ?? id, carry: stripPlan.carries[id] }) };
  });
  const wheelSelectedId = resolveWheelHighlightId(selectedClubId);
  const addShotSuggestTarget = resolveAddShotSuggestTarget({
    lastLanding: lastLandingMark(shots),
    tee: holeTee,
    green,
    courseToGreen: toGreen,
    lastClosedYards: lastClosedShotYards(shots),
  });
  const placeSuggestYards = addShotSheetRankYards({
    headerYards: pickerYards,
    remainingPin: editClubOpen
      ? null
      : addShotSuggestYardsLeft({ playTarget: addShotSuggestTarget, courseYards: toGreen.yards }),
  });
  const placeStripPlan = planClubStrip({
    clubs: clubs.map((club) => {
      const row = averages.find((item) => item.club.id === club.id);
      return toWheelFillClub(club, row);
    }),
    yardsLeft: placeSuggestYards,
  });
  const placeStripItems = placeStripPlan.ids
    .filter((id) => !isPutterClubId(id))
    .map((id) => {
      const club = clubs.find((row) => row.id === id);
      return { id, label: formatClubStripLabel({ id, shortName: club?.shortName ?? id, carry: placeStripPlan.carries[id] }) };
    });
  const placeOpeningIds = addShotSheetOpeningClubIds({
    clubs: placeStripItems
      .filter((item) => placeStripPlan.carries[item.id] != null)
      .map((item) => ({ id: item.id, carry: placeStripPlan.carries[item.id] })),
    headerYards: pickerYards,
    remainingPin: editClubOpen
      ? null
      : addShotSuggestYardsLeft({ playTarget: addShotSuggestTarget, courseYards: toGreen.yards }),
  });
  const placeOpeningItems = placeOpeningIds
    .map((id) => placeStripItems.find((item) => item.id === id))
    .filter((item): item is (typeof placeStripItems)[number] => item != null);
  if (holeTee) {
    rememberResolvedTee({ courseId: round?.courseApiId, holeNumber, green }, holeTee);
  }
  useEffect(() => {
    if (marksOnly) return;
    prefetchCourseHydrateOnce({
      name: round?.courseName,
      location: isCourseCardLatLng(courseLocation) ? courseLocation : null,
      courseId: round?.courseApiId,
    });
  }, [marksOnly, round?.courseName, round?.courseApiId, round?.courseLat, round?.courseLng]);
  useEffect(() => {
    if (marksOnly || !hole?.id || !holeTee) return;
    saveHoleTee(db, hole.id, holeTee);
  }, [marksOnly, db, hole?.id, holeTee?.lat, holeTee?.lng]);
  useEffect(() => {
    if (marksOnly || !hole?.id || !hydrated.usedHydrate || !green) return;
    if (hole.greenSource === 'user_estimate') return;
    setHoleGreen(db, hole.id, { ...green, source: 'course_centroid' });
  }, [marksOnly, db, hole?.id, hole?.greenSource, hydrated.usedHydrate, green?.lat, green?.lng]);
  const courseCardFrame = diagnoseCourseCardFrame({
    tee: holeTee,
    green,
    phone: null,
  });
  const courseCamera = planCourseCardCamera({
    tee: holeTee,
    green,
    phone: null,
  });
  const courseCardPaint = decideCourseCardPaint({
    tee: holeTee,
    green,
    phone: null,
  });
  const paintBanner = courseCardPaint.mount
    ? null
    : planPaintMissBanner({ hardMiss: needPins, unresolved: true });
  const paintSourceChip = paintBanner
    ? formatPaintSourceChip({ ok: false, source: null, fromCache: false })
    : null;
  useEffect(() => {
    logCourseCardPaint({
      courseName: round?.courseName,
      holeNumber,
      decision: courseCardPaint,
    });
    if (holeNumber === 1 && /cypress|greystone|pleasant valley/i.test(round?.courseName ?? '')) {
      const live = { tee: holeTee, green };
      const name = round?.courseName ?? '';
      logHole1PayloadsSideBySide(
        dumpHole1PayloadsSideBySide({
          cypress: /cypress/i.test(name) ? live : { tee: null, green: null },
          greystone: /greystone/i.test(name) ? live : { tee: null, green: null },
          pleasantValley: /pleasant valley/i.test(name) ? live : { tee: null, green: null },
        }),
      );
      logCabotPocket(
        scanCabotPocket({
          cypress: /cypress/i.test(name) ? live : { tee: null, green: null },
          greystone: /greystone/i.test(name) ? live : { tee: null, green: null },
        }),
      );
    }
  }, [
    round?.courseName,
    holeNumber,
    courseCardPaint.mount,
    courseCardPaint.reason,
    courseCardPaint.tee?.lat,
    courseCardPaint.tee?.lng,
    courseCardPaint.green?.lat,
    courseCardPaint.green?.lng,
    holeTee,
    green,
  ]);
  const addShotFrom = resolveAddShotFromPin({
    tee: holeTee,
    lastLanding: lastLandingMark(shots),
  });
  addShotFromRef.current = addShotFrom;
  const courseGreen = courseGreenCenterForLine({
    green,
    source: hole?.greenSource ?? null,
  });
  const insertSlots = planInsertSlots(shots);
  const playLayout = planPlayLayout();
  const playHeaderYards = planPlayHeaderYards({
    phone: fix ? { lat: fix.lat, lng: fix.lng } : null,
    green,
    tee: holeTee,
    courseYards: hole?.yards ?? null,
    shots,
  });
  /** Signal gate: haversine(fix → hydrated green centroid). Never a card number or green-edge. */
  const liveToGreen = yardsToGreen(fix, green);
  // Bottom of the sticky header (status bar + Menu / Hole / Scorecard + shot strip).
  const [headerBottom, setHeaderBottom] = useState<number | null>(null);
  const onHeaderLayout = useCallback((event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    const next = Math.round(y + height);
    if (next > 0) setHeaderBottom((prev) => (prev === next ? prev : next));
  }, []);

  const openPuttSheet = useCallback(
    async (targetHole: number) => {
      if (readOnly || marksOnly) return;
      const row = getHole(db, id, targetHole);
      if (!row) return;
      const lengths = row.puttLengths.filter(isPuttLengthId);
      const draft: PuttDraft = { putts: lengths.length, lengths };
      const live = puttDraftRef.current;
      const nextDraft =
        live.putts > draft.putts || live.lengths.length > draft.lengths.length ? live : draft;
      setPuttSheetHole(targetHole);
      setPuttDraft(nextDraft);
      puttDraftRef.current = nextDraft;
      setPuttOpen(true);
      puttOpenRef.current = true;
      await closeApproachBeforePutts(db, { roundId: id, holeNumber: targetHole });
      bump();
      const latest = puttDraftRef.current;
      const pushDraft =
        latest.putts > nextDraft.putts || latest.lengths.length > nextDraft.lengths.length
          ? latest
          : nextDraft;
      void pushWatchPuttSheet({ open: true, holeNumber: targetHole, lengths: pushDraft.lengths });
    },
    [readOnly, marksOnly, db, id, bump],
  );

  const saveDraft = useCallback(
    (targetHole: number, draft: PuttDraft, done: boolean) => {
      const row = getHole(db, id, targetHole);
      if (!row) return;
      if (done) finishHolePutts(db, row.id, draft.putts, draft.lengths);
      else updateHolePutts(db, row.id, draft.putts, draft.lengths, false);
      bump();
    },
    [db, id, bump],
  );

  const celebrateHoleOut = useCallback(() => {
    hapticMark();
    setCheckNonce((n) => n + 1);
    setToast(COPY.holeOut);
  }, []);

  const clearPuttDraft = useCallback(() => {
    const cleared = puttDraftAfterHoleOut();
    puttDraftRef.current = cleared;
    setPuttDraft(cleared);
    puttOpenRef.current = false;
    setPuttOpen(false);
  }, []);

  const applyMadeIt = useCallback(
    (targetHole: number, draft: PuttDraft, pending: PuttLengthId | null = null) => {
      if (readOnly || !round) return false;
      const existing = getHole(db, id, targetHole);
      let lengths: PuttLengthId[];
      if (madeItWritesPutts(Boolean(existing?.puttsDone))) {
        const planned = planMadeIt(draft, pending);
        if (!planned.ok) return false;
        saveDraft(targetHole, planned, true);
        celebrateHoleOut();
        lengths = planned.lengths;
      } else {
        // Already holed out. Keep the stored putts — do not count the draft again.
        lengths = existing?.puttLengths.filter(isPuttLengthId) ?? [];
      }
      clearPuttDraft();
      if (!madeItAdvancesHole({ sheetHoleNumber: targetHole, currentHoleNumber: holeNumber })) {
        void pushWatchPuttSheet({ open: false, holeNumber: targetHole, lengths, done: true });
        return true;
      }
      // Watch leaves the putt sheet now and shows Hole N+1 (or Round complete).
      // Name the destination hole's last shot so Edit shot does not go gray.
      const advance = watchAdvanceNamedShot(db, id, targetHole, round.holeCount);
      void pushWatchMadeItAdvance({
        holeNumber: targetHole,
        holeCount: round.holeCount,
        lengths,
        shotCount: advance.shotCount,
        lastShotId: advance.lastShotId,
        lastShotClubId: advance.lastShotClubId,
      });
      const dest = holeAfterDone(targetHole, round.holeCount);
      if (dest.kind === 'summary') {
        router.replace(`/round/${id}/summary`);
        return true;
      }
      router.replace(`/round/${id}/hole/${dest.holeNumber}`);
      return true;
    },
    [readOnly, round, saveDraft, holeNumber, id, celebrateHoleOut, db, clearPuttDraft],
  );

  const onAttachFinishedPuttLength = (index: number, lengthId: PuttLengthId) => {
    if (readOnly || !hole) return;
    if (!attachHolePuttLength(db, hole.id, index, lengthId)) return;
    setAttachPuttIndex(null);
    bump();
  };

  useEffect(() => {
    setAttachPuttIndex(null);
  }, [holeNumber]);

  useEffect(() => {
    if (puttsParam !== '1' || readOnly) return;
    void openPuttSheet(holeNumber);
    router.setParams({ putts: undefined });
  }, [puttsParam, holeNumber, readOnly, openPuttSheet]);

  useEffect(() => {
    if (menuParam !== '1' || readOnly) return;
    setMenuOpen(true);
    router.setParams({ menu: undefined });
  }, [menuParam, readOnly]);

  const openQueuedShare = useCallback(() => {
    if (!pendingShareRef.current) return;
    pendingShareRef.current = false;
    if (shareFallbackRef.current) {
      clearTimeout(shareFallbackRef.current);
      shareFallbackRef.current = null;
    }
    const anchor = findNodeHandle(menuButtonRef.current);
    const kind = shareKindOrScorecard(pendingShareKindRef.current);
    pendingShareKindRef.current = 'scorecard';
    void toastFromShareAttempt(() =>
      kind === 'live'
        ? shareLiveBoard(db, id, { currentHoleNumber: holeNumber, anchor })
        : shareRoundSnapshot(db, id, { currentHoleNumber: holeNumber, anchor }),
      kind === 'live' ? COPY.shareFail : COPY.shareScorecardFail,
    ).then((fail) => {
      if (fail) setToast(fail);
    });
  }, [db, id, holeNumber]);

  const queueMenuShare = useCallback((kind: ShareKind = 'scorecard') => {
    pendingShareKindRef.current = shareKindOrScorecard(kind);
    pendingShareRef.current = true;
    setMenuOpen(false);
    setScorecardOpen(false);
    if (shareFallbackRef.current) clearTimeout(shareFallbackRef.current);
    shareFallbackRef.current = setTimeout(openQueuedShare, MENU_SHARE_FALLBACK_MS);
  }, [openQueuedShare]);

  // Live follow: stamp start only once every earlier hole is finished — peeking ahead never stamps.
  useEffect(() => {
    markHoleStarted(db, id, holeNumber);
  }, [db, id, holeNumber, revision]);

  // Worker upload stays inside publishRoundScoreboard and is off until Share.
  useEffect(() => {
    publishRoundScoreboard(db, id, { currentHoleNumber: holeNumber });
  }, [db, id, holeNumber, revision]);

  useEffect(
    () => () => {
      if (shareFallbackRef.current) clearTimeout(shareFallbackRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!puttOpen) return;
    void pushWatchPuttSheet({ open: true, holeNumber: puttSheetHole, lengths: puttDraft.lengths });
  }, [puttOpen, puttSheetHole, puttDraft]);

  const onWatchPuttPick = useCallback(
    async (msg: { action: 'add' | 'undo' | 'made'; lengthId?: PuttLengthId }) => {
      if (readOnly) return { ok: false, feedback: PHONE_UNAVAILABLE };
      const target = puttOpenRef.current ? puttSheetHoleRef.current || holeNumber : holeNumber;
      if (!puttOpenRef.current) setPuttSheetHole(target);
      if (msg.action === 'add' && msg.lengthId) {
        const next = applyWatchPuttPickToDraft(puttDraftRef.current, msg);
        puttDraftRef.current = next;
        puttOpenRef.current = true;
        setPuttDraft(next);
        setPuttOpen(true);
        saveDraft(target, next, false);
        void pushWatchPuttSheet({ open: true, holeNumber: target, lengths: next.lengths });
        return { ok: true, feedback: COPY.putts };
      }
      if (msg.action === 'undo') {
        const next = applyWatchPuttPickToDraft(puttDraftRef.current, msg);
        puttDraftRef.current = next;
        puttOpenRef.current = true;
        setPuttDraft(next);
        setPuttOpen(true);
        saveDraft(target, next, false);
        void pushWatchPuttSheet({ open: true, holeNumber: target, lengths: next.lengths });
        return { ok: true, feedback: COPY.undoPutt };
      }
      if (msg.action === 'made') {
        const draft = puttDraftRef.current;
        const pending = msg.lengthId ?? null;
        const row = getHole(db, id, target);
        if (row?.puttsDone || puttOpenRef.current || pending || draft.lengths.length > 0 || draft.putts > 0) {
          const ok = applyMadeIt(target, draft, pending);
          return ok ? { ok: true, feedback: MADE_IT_FEEDBACK } : { ok: false, feedback: COPY.puttSheetLede };
        }
        const rnd = getRound(db, id);
        if (!row || !rnd) {
          return { ok: false, feedback: COPY.puttSheetLede };
        }
        closeOpenShotToExistingPin(db, row.id, target === holeNumber ? green : null);
        await closeApproachBeforePutts(db, { roundId: id, holeNumber: target });
        finishHoleOut(db, row.id);
        bump();
        clearPuttDraft();
        celebrateHoleOut();
        const advance = watchAdvanceNamedShot(db, id, target, rnd.holeCount);
        void pushWatchMadeItAdvance({
          holeNumber: target,
          holeCount: rnd.holeCount,
          lengths: row.puttLengths.filter(isPuttLengthId),
          shotCount: advance.shotCount,
          lastShotId: advance.lastShotId,
          lastShotClubId: advance.lastShotClubId,
        });
        const dest = holeAfterDone(target, rnd.holeCount);
        if (dest.kind === 'summary') router.replace(`/round/${id}/summary`);
        else router.replace(playHrefAfterHoleChange(id, dest.holeNumber));
        return { ok: true, feedback: MADE_IT_FEEDBACK };
      }
      return { ok: false, feedback: PHONE_UNAVAILABLE };
    },
    [readOnly, holeNumber, saveDraft, applyMadeIt, db, id, bump, celebrateHoleOut, green, clearPuttDraft],
  );

  useWatchClubList(
    {
      db,
      roundId: id,
      holeNumber,
      readOnly,
      tee: holeTee,
      openShotHoles: pendingShots.map((row) => row.number),
      bump,
      onMarked: () => setCheckNonce((n) => n + 1),
      onPutter: () => {
        void openPuttSheet(holeNumber);
      },
      onLeave: (action) => {
        const plan = planClubPickLeave(action);
        if (
          clubPickLeaveRunsAcceptFix(action) ||
          plan.mark ||
          plan.selectClub ||
          plan.savesGps ||
          plan.closesPendingShot
        ) {
          return;
        }
        if (action === 'home') {
          setMenuOpen(true);
          return;
        }
      },
      onPuttPick: onWatchPuttPick,
      onSelectClub: (clubId) => {
        setSelectedClubId(applyWheelSelection(clubId));
      },
      labelForClub: (clubId) => clubMap[clubId]?.shortName ?? clubs.find((club) => club.id === clubId)?.shortName ?? null,
    },
    {
      top3: ranked.map((club) => ({
        id: club.id,
        shortName: formatSuggestedClubChip(club.shortName, rankDistanceYards(club)),
      })),
      bag: clubs.map((club) => ({
        id: club.id,
        shortName: formatSuggestedClubChip(club.shortName, stripPlan.carries[club.id] ?? null),
      })),
      holeNumber,
      yardsToGreen: target?.dYards ?? teeToGreen.yards ?? toGreen.yards,
      yardsQuality: liveSuggest.quality ?? (target || teeToGreen.quality !== 'none' || toGreen.quality !== 'none' ? 'good' : 'none'),
      lastClubId: sticky?.id ?? null,
      selectedClubId: wheelSelectedId,
      complication: {
        yards: liveGpsToPin.yards,
        quality: liveGpsToPin.quality,
        atMs: fix?.timestamp ?? null,
      },
      roundLive: round?.finishedAt == null,
      teeLengthYards: courseTeeYards(hole?.yards),
      green: watchGreenFields({ green, front: pins.front, back: pins.back }),
      clubCarry: watchClubCarry(stripPlan.carries),
      // Watch Edit shot copies this hole's shots from the phone. A late resend names the same shot.
      shotCount: readOnly ? 0 : shots.length,
      lastShotId: readOnly ? null : watchNamedLastShot(shots).lastShotId,
      lastShotClubId: readOnly ? null : watchNamedLastShot(shots).lastShotClubId,
    },
  );

  if (!round || !hole) {
    return (
      <View style={styles.fill}>
        <Text style={styles.muted}>Round or hole not found.</Text>
      </View>
    );
  }

  const courseHeader = formatPlayHeaderCourseLength(hole.number, hole.par, round.teeName, hole.yards);

  const simBanner =
    Device.isDevice === false || fix?.mocked ? COPY.simulator : describeGpsSource(fix ?? { mocked: false, isSimulator: false });

  const markClub = async (club: Club | null, force = false) => {
    const next = club ? selectClubForMark(club, clubs) : null;
    if (readOnly || placing) return;
    if (!pastRoundCanAddShot(marksOnly)) return;
    if (club && !next) return;
    if (next && putterOpensPuttSheet({ clubId: next.id })) {
      hapticSelect();
      void openPuttSheet(holeNumber);
      return;
    }
    if (club) hapticSelect();
    setBusy(true);
    try {
      const { plan } = await markShotWithClub(db, {
        roundId: id,
        holeNumber,
        clubId: next?.id ?? null,
        force,
        tee: holeTee,
      });
      const waiting = promptForPlan(plan, () => {
        void markClub(club, true);
      });
      if (!waiting && plan.status === 'commit') {
        hapticMark();
        if (plan.closePrior) {
          hapticLight();
          const closed = shots.find((shot) => shot.id === plan.closePrior?.shotId);
          const closedName = closed?.clubId ? clubMap[closed.clubId]?.shortName ?? 'club' : 'club';
          const chip = formatShotLockChip({
            shortName: closedName,
            distanceYards: plan.closePrior.distanceYards,
          });
          if (chip) setToast(chip);
        }
        setCheckNonce((n) => n + 1);
        bump();
      }
    } catch (err) {
      hapticWarn();
      Alert.alert('Couldn’t mark', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const onMark = (force = false) => {
    if (!sticky) return Promise.resolve();
    return markClub(sticky, force);
  };

  const dismissScorecard = () => {
    const action = planScorecardDismiss();
    if (action.markShot || action.closeShot || action.leaveHole || action.finishRound) {
      return;
    }
    setScorecardOpen(false);
    bumpPlayFrame();
  };

  const onUndo = () => {
    if (readOnly) return;
    if (placing && (placeFrom || placeTo || placeToDraft)) {
      const next = planUndoPlacePins({ from: placeFrom, to: placeTo ?? placeToDraft });
      if (!next) return;
      setPlaceFrom(next.from);
      setPlaceTo(next.to);
      setPlaceToDraft(next.to);
      setPlaceClubOpen(false);
      setPlaceMode(next.mode);
      hapticTap();
      return;
    }
    if (!pastRoundCanAddShot(marksOnly)) return;
    const ok = undoLastShot(db, { roundId: id, holeNumber });
    if (!ok) return;
    hapticTap();
    setEditUndo(null);
    bump();
  };

  const softGpsUndo = planUndoLastSoftGpsClubMark(shots);
  const onUndoSoftGps = () => {
    if (readOnly || placing) return;
    if (!pastRoundCanAddShot(marksOnly)) return;
    const ok = undoLastSoftGpsClubMark(db, { roundId: id, holeNumber });
    if (!ok) return;
    hapticTap();
    setEditUndo(null);
    setConfirmUndo(null);
    bump();
  };

  const onEndShot = async (force = false) => {
    if (readOnly || !open || !pastRoundCanAddShot(marksOnly)) return;
    setBusy(true);
    try {
      const { plan } = await endOpenShot(db, { roundId: id, holeNumber, force });
      const waiting = promptForPlan(plan, () => {
        void onEndShot(true);
      });
      if (!waiting && plan.status === 'commit' && plan.closePrior) {
        hapticLight();
        const closed = shots.find((shot) => shot.id === plan.closePrior?.shotId);
        const closedName = closed?.clubId ? clubMap[closed.clubId]?.shortName ?? 'club' : 'club';
        const chip = formatShotLockChip({
          shortName: closedName,
          distanceYards: plan.closePrior.distanceYards,
        });
        if (chip) setToast(chip);
        bump();
      } else if (!waiting) {
        bump();
      }
    } catch (err) {
      Alert.alert('Couldn’t end shot', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const onAddPutt = (bucket: PuttLengthId) => {
    if (readOnly) return;
    const next = addPuttLength(puttDraft, bucket);
    setPuttDraft(next);
    saveDraft(puttSheetHole, next, false);
    hapticTap();
  };

  const onUndoPutt = () => {
    if (readOnly) return;
    const next = undoLastPutt(puttDraft);
    setPuttDraft(next);
    saveDraft(puttSheetHole, next, false);
    hapticTap();
  };

  const onMadeIt = (pending: PuttLengthId | null = null) => {
    if (readOnly) return;
    applyMadeIt(puttSheetHole, puttDraft, pending);
  };

  const onFinishHole = () => {
    if (readOnly || marksOnly || !hole || !round) return;
    void (async () => {
      closeOpenShotToExistingPin(db, hole.id, green);
      await closeApproachBeforePutts(db, { roundId: id, holeNumber });
      finishHoleOut(db, hole.id);
      bump();
      clearPuttDraft();
      celebrateHoleOut();
      const dest = holeAfterDone(holeNumber, round.holeCount);
      if (dest.kind === 'summary') {
        router.replace(`/round/${id}/summary`);
        return;
      }
      router.replace(playHrefAfterHoleChange(id, dest.holeNumber));
    })();
  };

  const openPenaltySheet = () => {
    setPenaltyAfterShotId(defaultPenaltyAfterShot(shots)?.id ?? null);
    setPenaltyOpen(true);
  };

  const onAddPenalty = () => {
    if (readOnly || !hole) return;
    const attached = shots.find((shot) => shot.id === penaltyAfterShotId) ?? null;
    try {
      insertPenalty(db, {
        holeId: hole.id,
        par: hole.par,
        currentScore: hole.score,
        strokes: penaltyStrokes,
        reason: penaltyReason,
        note: penaltyNoteForSave(penaltyReason, penaltyNote),
        kind: 'penalty',
        afterShotId: attached?.id ?? null,
        afterShotSeq: attached?.seq ?? null,
      });
    } catch (err) {
      console.warn(err);
      Alert.alert(COPY.penaltySaveFailed);
      return;
    }
    bump();
    hapticTap();
    setPenaltyOpen(false);
    setPenaltyStrokes(1);
    setPenaltyReason('water');
    setPenaltyNote('');
    setPenaltyAfterShotId(null);
  };

  const beginChangePenalty = (penaltyId: string) => {
    if (readOnly) return;
    const penalty = penalties.find((row) => row.id === penaltyId);
    if (!penalty) return;
    setChangeReason(penalty.reason);
    setChangeNote(penalty.note ?? '');
    setChangePenaltyId(penalty.id);
    setScoreOpen(false);
  };

  const onSavePenaltyReason = () => {
    if (readOnly || !changePenaltyId) return;
    const result = updatePenaltyReason(db, {
      penaltyId: changePenaltyId,
      reason: changeReason,
      note: penaltyNoteForSave(changeReason, changeNote),
    });
    if (result.status !== 'updated') {
      Alert.alert(COPY.penaltySaveFailed);
      return;
    }
    setChangePenaltyId(null);
    hapticTap();
    bump();
  };

  const onDeletePenalty = (penaltyId: string) => {
    if (readOnly) return;
    const result = deletePenalty(db, penaltyId);
    if (result.status !== 'deleted') return;
    if (changePenaltyId === penaltyId) setChangePenaltyId(null);
    hapticTap();
    bump();
  };

  const openPenaltyActions = (penaltyId: string) => {
    if (readOnly || placing) return;
    const actions = penaltyStepActionSheet();
    Alert.alert(actions.title, '', [
      { text: actions.options[0], onPress: () => beginChangePenalty(penaltyId) },
      { text: actions.options[1], style: 'destructive', onPress: () => onDeletePenalty(penaltyId) },
      { text: actions.cancel, style: 'cancel' },
    ]);
  };

  const openBag = () => {
    if (placing || marksOnly) return;
    router.push(allClubsHref(id, holeNumber));
  };

  const confirmToPin = () => {
    const result = confirmPlaceToDraft({ from: placeFrom, draft: placeToDraft });
    if (result.status === 'empty') return;
    hapticLight();
    setPlaceTo(result.to);
    setPlaceClubOpen(true);
  };

  const commitPlaced = (clubId: string) => {
    if (!pastRoundCanAddShot(marksOnly)) return;
    if (!placeFrom || !placeTo) return;
    const result = addPlacedShot(db, {
      roundId: round.id,
      holeNumber,
      clubId,
      from: placeFrom,
      to: placeTo,
      seq: insertSeq ?? undefined,
    });
    if (result.status !== 'commit') {
      hapticWarn();
      return;
    }
    hapticMark();
    hapticLight();
    const placed = planPlacedShot(placeFrom, placeTo);
    const club = clubs.find((row) => row.id === clubId);
    const chip = formatShotLockChip({
      shortName: club?.shortName ?? '',
      distanceYards: placed.ok ? placed.distanceYards : null,
    });
    if (chip) setToast(chip);
    setConfirmUndo(planConfirmUndo(result.id, Date.now()));
    resetPlace();
    bump();
  };

  const onConfirmUndo = () => {
    if (!confirmUndo || !confirmUndoIsLive(confirmUndo, Date.now())) {
      setConfirmUndo(null);
      return;
    }
    const result = deleteHoleShot(db, {
      roundId: id,
      holeNumber,
      shotId: confirmUndo.shotId,
      confirmed: true,
    });
    if (result.status !== 'commit') return;
    setConfirmUndo(null);
    hapticTap();
    bump();
  };

  const rememberUndo = (snapshot: ShotEditSnapshot) => {
    setEditUndo(snapshot);
  };

  const commitEditClub = (clubId: string) => {
    if (!editShotId) return;
    const result = changeShotClub(db, { roundId: round.id, shotId: editShotId, clubId });
    if (result.status !== 'commit') {
      hapticWarn();
      return;
    }
    hapticSelect();
    rememberUndo(result.snapshot);
    setEditClubOpen(false);
    setShowAllClubs(false);
    setEditOpen(true);
    bump();
  };

  const commitMovePin = (point: LatLng, which: 'from' | 'to') => {
    if (!editShotId) return;
    const result = moveShotPin(db, { shotId: editShotId, which, point });
    if (result.status !== 'commit') {
      hapticWarn();
      return;
    }
    hapticMark();
    rememberUndo(result.snapshot);
    setPlaceMode('off');
    setEditOpen(true);
    bump();
  };

  const beginMoveSpot = () => {
    if (!editingShot) return;
    const stored = shotStoredPosition(editingShot);
    const device = isValidLatLng(fix) ? { lat: fix.lat, lng: fix.lng } : null;
    const framed =
      courseCardPaint.mount && courseCardFrame.ok && courseCamera ? courseCamera.points : [holeTee, green];
    const origin = moveSpotDraftOrigin({
      stored,
      device,
      mapCenter: frameMapCenter(framed),
    });
    if (!origin) return;
    setMoveSpotDropped(false);
    setPlaceFrom(null);
    setPlaceTo(null);
    setPlaceToDraft(origin.point);
    setEditOpen(false);
    setPlaceMode('move-spot');
  };

  const commitMoveSpot = (point: LatLng) => {
    if (!editShotId || !moveSpotDropped) return;
    const result = moveShotSpot(db, {
      roundId: round.id,
      holeNumber,
      shotId: editShotId,
      point,
      dropped: true,
      confirmed: true,
    });
    if (result.status !== 'commit') {
      hapticWarn();
      return;
    }
    hapticMark();
    setMoveSpotDropped(false);
    setPlaceToDraft(null);
    setPlaceMode('off');
    setEditOpen(true);
    bump();
  };

  const onUndoEdit = () => {
    if (readOnly || !editUndo) return;
    const ok = undoShotEdit(db, editUndo);
    if (!ok) return;
    hapticTap();
    setEditUndo(null);
    bump();
  };

  const commitDeleteShot = (shotId: string) => {
    const result = deleteHoleShot(db, {
      roundId: id,
      holeNumber,
      shotId,
      confirmed: true,
    });
    if (result.status !== 'commit') return;
    hapticTap();
    if (editUndo?.id === shotId) setEditUndo(null);
    closeEdit();
    bump();
  };

  const onDeleteShot = (shotId: string) => {
    const prompt = deleteShotPrompt();
    Alert.alert(prompt.title, '', [
      { text: prompt.cancel, style: 'cancel' },
      { text: prompt.confirm, style: 'destructive', onPress: () => commitDeleteShot(shotId) },
    ]);
  };

  const catchUpSheet = planCatchUpSheet(placing);
  const hideHoleButtons = catchUpSheet.holeButtons === 'hidden';
  const catchUpFullScreen = catchUpSheet.map === 'fullscreen';
  const finishedMini = planFinishedHoleMiniSummary({
    puttsDone: hole.puttsDone,
    placing,
    catchUpFullScreen,
    score: hole.score,
    par: hole.par,
    shotCount: shots.length,
    putts: hole.putts,
    lengths: hole.puttLengths,
    penaltyStrokes: penaltyTotal,
    shots,
  });
  const fairwayPrompt = showFairwayPrompt({
    par: hole.par,
    fairway: hole.fairway,
    shotCount: shots.length,
    firstShotClosed: shots[0]?.endedAt != null,
    puttsDone: hole.puttsDone,
    readOnly: readOnly || placing,
  });
  const onPickFairway = (result: FairwayResult) => {
    if (readOnly) return;
    hapticSelect();
    updateHoleFairway(db, hole.id, nextFairwayValue(hole.fairway, result));
    bump();
  };
  const runningPar = planRunningParBadge({
    holes: holes.map((row) => ({
      number: row.number,
      par: row.par,
      score: row.score,
      puttsDone: row.puttsDone,
      shotCount: listShotsForHole(db, row.id).length,
      putts: row.putts,
      penaltyStrokes: totalPenaltyStrokes(listPenaltiesForHole(db, row.id)),
    })),
    placing,
    catchUpFullScreen,
    puttOpen,
    readOnly,
  });
  const dockFinish = planPlayDockFinish({
    readOnly,
    placing,
    puttsDone: hole.puttsDone,
    putting: putterOpensPuttSheet({ clubId: wheelSelectedId }),
    toGreen: liveToGreen,
  });
  const showFirstLaunchTip =
    !readOnly &&
    !catchUpFullScreen &&
    !firstLaunchTipDismissed &&
    shouldShowFirstLaunchTip({
      seen: hasSeenFirstLaunchTip(db) ? firstLaunchTipSeenValue() : null,
      historyRoundCount,
    });
  const onDismissFirstLaunchTip = () => {
    markFirstLaunchTipSeen(db);
    setFirstLaunchTipDismissed(true);
  };
  const placeHint =
    placeMode === 'move-spot'
      ? COPY.moveSpotHint
      : placeMode === 'edit-from'
      ? COPY.editFromHint
      : placeMode === 'edit-to'
        ? COPY.editToHint
        : placing
          ? placeTo
            ? `${placedYards ?? '—'} yd · ${COPY.pickClub}`
            : placeFrom
              ? null
              : COPY.placeFromHint
          : null;

  const onCancelPlace = () => {
    const editing = placeMode === 'edit-from' || placeMode === 'edit-to' || placeMode === 'move-spot' || editClubOpen;
    resetPlace();
    if (editing && editShotId) setEditOpen(true);
  };

  return (
    <Animated.View style={[styles.fill, { transform: [{ translateX: slideX }] }]}>
      <View collapsable={false} style={styles.mapFill}>
        <HoleMap
          fullBleed
          holeNumber={hole.number}
          shots={shots}
          userFix={catchUpFullScreen ? null : fix}
          liveGpsToPin={liveGpsToPin}
          green={green}
          yardsToGreen={{
            yards: playHeaderYards.yards,
            quality: playHeaderYards.quality,
          }}
          fmb={fmb}
          osmOverlay={overlay}
          missCopy={missCopy}
          paintNotice={paintBanner}
          paintSourceChip={paintSourceChip}
          requestCourse={requestCourse}
          placedFrom={
            placeMode === 'move-spot'
              ? null
              : placeMode === 'edit-from' || placeMode === 'edit-to'
                ? placeFrom
                : addShotFrom
          }
          placedTo={placeToDraft ?? placeTo}
          lineFrom={placeMode === 'edit-from' || placeMode === 'edit-to' ? placeFrom : placeMode === 'move-spot' ? null : addShotFrom}
          lineGreen={courseGreen}
          freezePan={placeMode === 'to' || placeMode === 'edit-to'}
          onPlaceToDrag={
            placeMode === 'to' || placeMode === 'edit-to' || placeMode === 'move-spot'
              ? (point) => {
                  setPlaceToDraft(point);
                  if (placeMode === 'move-spot') setMoveSpotDropped(true);
                }
              : undefined
          }
          lockFrame
          showPhonePin={!catchUpFullScreen}
          allowMapsChrome={!catchUpFullScreen}
          hideYardsOverlay
          frameEpoch={playMapFrameEpoch({ holeNumber: hole.number, nonce: playFrameNonce })}
          onFrameReady={setMapFramed}
          heading={courseCardPaint.mount ? courseCamera?.heading ?? null : null}
          framePoints={
            courseCardPaint.mount && courseCardFrame.ok
              ? courseCamera?.points.map((point) => ({
                  latitude: point.lat,
                  longitude: point.lng,
                }))
              : undefined
          }
          placeHint={placeHint}
          onShotPress={placing ? undefined : openEdit}
          onPlacePoint={
            readOnly || placeMode === 'off' || placeClubOpen || editClubOpen
              ? undefined
              : (coord) => {
                  const tap = catchUpPinFromTap(coord, fix);
                  if (!tap) return;
                  if (placeMode === 'from') {
                    if (!addShotFrom) return;
                    setPlaceFrom(addShotFrom);
                    setPlaceMode('to');
                    return;
                  }
                  if (placeMode === 'to') {
                    setPlaceToDraft(tap);
                    return;
                  }
                  if (placeMode === 'edit-from') {
                    commitMovePin(tap, 'from');
                    return;
                  }
                  if (placeMode === 'edit-to') {
                    setPlaceToDraft(tap);
                  }
                }
          }
          onDropGreenEstimate={
            readOnly || placing
              ? undefined
              : (coord) => {
                  setHoleGreen(db, hole.id, { ...coord, source: 'user_estimate' });
                  bump();
                }
          }
        />
        <View
          pointerEvents="box-none"
          onLayout={onHeaderLayout}
          style={[styles.sticky, { paddingTop: insets.top + 6 }]}>
          {catchUpFullScreen ? (
            <View>
              <View style={styles.catchUpBar}>
                <Pressable onPress={onCancelPlace} style={styles.back} accessibilityRole="button">
                  <Text style={styles.backLabel}>{COPY.cancelPlace}</Text>
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text
                    style={styles.holeTitle}
                    numberOfLines={1}
                    accessibilityLabel={courseHeader.label}>
                    {courseHeader.primary}
                    <Text style={styles.holeMeta}>
                      {` · ${courseHeader.secondary}`}
                    </Text>
                  </Text>
                </View>
              </View>
              {placeHint ? <Text style={styles.catchUpHint}>{placeHint}</Text> : null}
            </View>
          ) : (
            <View>
              <View style={styles.stickyInner}>
                <Pressable
                  ref={menuButtonRef}
                  onPress={() => setMenuOpen(true)}
                  style={styles.menuButton}
                  accessibilityRole="button"
                  collapsable={false}>
                  <Text style={styles.menuButtonText}>{COPY.menu}</Text>
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text
                    style={styles.holeTitle}
                    numberOfLines={1}
                    accessibilityLabel={courseHeader.label}>
                    {courseHeader.primary}
                    <Text style={styles.holeMeta}>
                      {` · ${courseHeader.secondary}`}
                    </Text>
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={COPY.scorecard}
                  onPress={() => setScorecardOpen(true)}
                  style={styles.scorecardChip}>
                  <Text style={styles.scorecardChipText} numberOfLines={1}>
                    {COPY.scorecard}
                  </Text>
                </Pressable>
              </View>
              {needPins ? (
                <ThunderbirdPinSheetPicker
                  selected={pinSheet}
                  onSelect={(sheet) => {
                    setThunderbirdPinSheet(db, sheet);
                    bump();
                  }}
                />
              ) : null}
              {playLayout.shotLine === 'header' ? (
                <ScrollView
                  key={`hole-steps-${revision}-${penalties.map((row) => row.id).join(',')}`}
                  horizontal
                  style={styles.shotLine}
                  contentContainerStyle={styles.shotLineInner}
                  showsHorizontalScrollIndicator={false}>
                  {holeSteps.length === 0 ? (
                    <Text style={styles.shotLineMuted}>{COPY.noShots}</Text>
                  ) : (
                    holeSteps.map((step) => {
                      if (step.kind === 'penalty') {
                        return (
                          <Pressable
                            key={`penalty-${step.sourceIndex}`}
                            disabled={readOnly || placing}
                            accessibilityRole="button"
                            accessibilityLabel={step.label}
                            onPress={() => openPenaltyActions(step.id)}
                            style={styles.shotLineItem}
                            testID="penalty-shot-chip">
                            <View style={styles.shotLineShot}>
                              <Text style={styles.shotLinePenalty}>{step.label}</Text>
                            </View>
                          </Pressable>
                        );
                      }
                      const shot = shots.find((row) => row.id === step.id);
                      if (!shot) return null;
                      const club = shot.clubId ? clubMap[shot.clubId] : null;
                      const slot = insertSlots.find((row) => row.afterShotId === shot.id);
                      return (
                        <View key={shot.id} style={styles.shotLineItem}>
                          <Pressable
                            disabled={placing}
                            onPress={() => openEdit(shot.id)}
                            style={styles.shotLineShot}>
                            <Text style={styles.shotLineText}>
                              {formatShotStepChip({
                                seq: shot.seq,
                                clubShortName: club?.shortName,
                                source: shot.source,
                                fixQuality: shot.fixQuality,
                                endedAt: shot.endedAt,
                                distanceYards: shot.distanceYards,
                              })}
                              {isHoleOutShot(shot) ? (
                                <Text testID="hole-out-shot-badge" style={styles.shotLineHoleOut}>
                                  {` · ${COPY.holeOut}`}
                                </Text>
                              ) : null}
                            </Text>
                          </Pressable>
                          {!readOnly && pastRoundCanAddShot(marksOnly) && slot && playLayout.insertPlus === 'header' ? (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={COPY.insertShot}
                              disabled={placing}
                              onPress={() => startCatchUp(slot.seq)}
                              style={styles.shotLinePlus}>
                              <Text style={styles.shotLinePlusText}>+</Text>
                            </Pressable>
                          ) : null}
                        </View>
                      );
                    })
                  )}
                  {!readOnly && pastRoundCanAddShot(marksOnly) && shots.length === 0 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={COPY.insertShot}
                      disabled={placing}
                      onPress={() => startCatchUp(1)}
                      style={styles.shotLinePlus}>
                      <Text style={styles.shotLinePlusText}>+</Text>
                    </Pressable>
                  ) : null}
                </ScrollView>
              ) : null}
              {!finishedMini.visible && penaltyTotal > 0 ? (
                <Text testID="live-hole-count" style={styles.shotLineMuted}>
                  {formatHoleCountLine({
                    shotCount: shots.length,
                    penaltyStrokes: penaltyTotal,
                    puttCount: hole.putts,
                    omitZeroPutts: true,
                  })}
                </Text>
              ) : null}
              {finishedMini.visible ? (
                <View testID="finished-hole-chip" style={styles.finishedHoleChip}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={finishedMini.accessibilityLabel}
                    onPress={() => setScorecardOpen(true)}>
                    <Text style={styles.finishedHoleText} numberOfLines={1}>
                      {finishedMini.score != null ? `${finishedMini.score}` : null}
                      {finishedMini.vsPar ? (
                        <Text
                          style={[
                            styles.finishedHoleVsPar,
                            finishedMini.vsParTone === 'good' && styles.finishedHoleGood,
                            finishedMini.vsParTone === 'bad' && styles.finishedHoleBad,
                          ]}>
                          {finishedMini.score != null ? ` · ${finishedMini.vsPar}` : finishedMini.vsPar}
                        </Text>
                      ) : null}
                      {`${finishedMini.score != null || finishedMini.vsPar ? ' · ' : ''}${finishedMini.shotsLabel}${finishedMini.penaltyLabel ? ` · ${finishedMini.penaltyLabel}` : ''} · ${finishedMini.puttsLabel}`}
                      {finishedMini.flag ? (
                        <Text testID="finished-hole-flag" style={styles.finishedHoleFlag}>
                          {` · ${finishedMini.flag}`}
                        </Text>
                      ) : null}
                    </Text>
                  </Pressable>
                  <FinishedPuttRows
                    rows={finishedMini.puttRows}
                    selectedIndex={attachPuttIndex}
                    disabled={readOnly}
                    onSelect={setAttachPuttIndex}
                    onAttach={onAttachFinishedPuttLength}
                  />
                </View>
              ) : null}
              {fairwayPrompt ? (
                <FairwayPicker overlay value={hole.fairway} onPick={onPickFairway} />
              ) : null}
              {simBanner ? <GpsBanner message={simBanner} /> : null}
              {showFirstLaunchTip ? (
                <View pointerEvents="box-none" style={styles.firstLaunchTipRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={COPY.firstLaunchTip}
                    onPress={onDismissFirstLaunchTip}
                    style={styles.firstLaunchTip}>
                    <Text style={styles.firstLaunchTipText}>{COPY.firstLaunchTip}</Text>
                    <Text style={styles.firstLaunchTipDismiss}>{COPY.dismissFirstLaunchTip}</Text>
                  </Pressable>
                </View>
              ) : null}
              {toast ? (
                <View
                  pointerEvents="none"
                  style={styles.overlayToast}
                  key={toast === COPY.holeOut ? `hole-out-${checkNonce}` : 'overlay-toast'}
                  testID={toast === COPY.holeOut ? 'hole-out-chip' : 'overlay-toast'}>
                  {toast === COPY.holeOut ? <Text style={styles.holeOutCheck}>✓</Text> : null}
                  <Text style={styles.overlayToastText}>{toast}</Text>
                </View>
              ) : null}
              {!readOnly && confirmUndoIsLive(confirmUndo, nowMs) ? (
                <Pressable onPress={onConfirmUndo} style={styles.overlayLink}>
                  <Text style={styles.backLabel}>{COPY.undoLast}</Text>
                </Pressable>
              ) : null}
              {!readOnly &&
              !placing &&
              pastRoundCanAddShot(marksOnly) &&
              softGpsUndo?.usesUndoLast &&
              !confirmUndoIsLive(confirmUndo, nowMs) ? (
                <Pressable
                  testID="undo-last-soft-gps"
                  accessibilityRole="button"
                  accessibilityLabel={COPY.undoLast}
                  onPress={onUndoSoftGps}
                  style={styles.overlayLink}>
                  <Text style={styles.backLabel}>{COPY.undoLast}</Text>
                </Pressable>
              ) : null}
              {!readOnly && editUndo ? (
                <Pressable onPress={onUndoEdit} style={styles.overlayLink}>
                  <Text style={styles.backLabel}>{COPY.undoEdit}</Text>
                </Pressable>
              ) : null}
              {pendingShots.map((row) => (
                <Pressable
                  key={`shot-${row.number}`}
                  accessibilityRole="button"
                  disabled={readOnly}
                  onPress={() => goToHole(row.number)}
                  style={styles.overlayLink}>
                  <Text style={styles.backLabel}>{finishShotChip(row.number)}</Text>
                </Pressable>
              ))}
              {pendingPutts.map((row) => (
                <Pressable
                  key={row.number}
                  accessibilityRole="button"
                  disabled={readOnly}
                  onPress={() => void openPuttSheet(row.number)}
                  style={styles.overlayLink}>
                  <Text style={styles.backLabel}>{finishPuttsChip(row.number)}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
        <View
          pointerEvents="none"
          style={[styles.headerCorner, { top: (headerBottom ?? insets.top + 6 + tapTarget + 16) + 6 }]}>
          <View testID="live-gps-to-pin">
            <YardsToGreenBadge
              compact
              approximateOnSoft
              unavailable={liveGpsToPin.unavailable}
              result={liveGpsToPin}
              hasFix={liveGpsToPin.quality !== 'none'}
              hasGreen={Boolean(green)}
            />
          </View>
          {hazardCarries.length > 0 ? (
            <View pointerEvents="none" testID="hazard-carries" style={styles.hazardBadge}>
              {hazardCarries.map((row) => (
                <Text
                  key={`${row.kind}-${row.reach}-${row.carry}`}
                  accessibilityLabel={hazardCarryAccessibilityLabel(row)}
                  style={styles.hazardText}
                  numberOfLines={1}>
                  {formatHazardCarry(row)}
                </Text>
              ))}
            </View>
          ) : null}
          {runningPar.visible ? (
            <View
              pointerEvents="none"
              testID="running-par-badge"
              accessibilityLabel={runningPar.accessibilityLabel}
              style={styles.runningParBadge}>
              <Text style={styles.runningParText}>
                {`thru ${runningPar.thru}`}
                {runningPar.toParLabel ? (
                  <Text
                    style={[
                      runningPar.toParTone === 'good' && styles.runningParGood,
                      runningPar.toParTone === 'bad' && styles.runningParBad,
                    ]}>
                    {`, ${runningPar.toParLabel}`}
                  </Text>
                ) : null}
              </Text>
            </View>
          ) : null}
        </View>
        {catchUpFullScreen &&
        ((placeMode === 'to' || placeMode === 'edit-to') || (placeMode === 'move-spot' && moveSpotDropped)) &&
        placeToDraft &&
        !placeClubOpen ? (
          <View
            pointerEvents="box-none"
            style={[styles.confirmDock, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <BigButton
              label={COPY.confirmPlace}
              onPress={() => {
                if (placeMode === 'move-spot') {
                  commitMoveSpot(placeToDraft);
                  return;
                }
                if (placeMode === 'edit-to') {
                  commitMovePin(placeToDraft, 'to');
                  return;
                }
                confirmToPin();
              }}
            />
          </View>
        ) : null}
        {!catchUpFullScreen &&
        !hideHoleButtons &&
        showPlayDockForCourseCard({
          paintMounts: courseCardPaint.mount,
          mapFramed,
          catchUpFullScreen,
        }) ? (
          <View
            pointerEvents="box-none"
            style={[styles.allClubsFloat, { bottom: PLAY_GLASS_DOCK_LIFT + Math.max(insets.bottom, 8) }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={COPY.allClubs}
              disabled={readOnly || marksOnly || placing}
              onPress={openBag}
              style={styles.allClubsPill}>
              <Text style={styles.allClubsPillText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {COPY.allClubs}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={COPY.penalty}
              disabled={readOnly}
              onPress={openPenaltySheet}
              style={styles.allClubsPill}>
              <Text style={styles.allClubsPillText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {COPY.penalty}
              </Text>
            </Pressable>
          </View>
        ) : null}

      {!hideHoleButtons &&
      showPlayDockForCourseCard({
        paintMounts: courseCardPaint.mount,
        mapFramed,
        catchUpFullScreen,
      }) ? (
        <View
          pointerEvents={dockPassMap ? 'none' : 'box-none'}
          onTouchStart={(event) => {
            if (event.nativeEvent.touches.length >= 2) setDockPassMap(true);
          }}
          onTouchEnd={(event) => {
            if (event.nativeEvent.touches.length === 0) setDockPassMap(false);
          }}
          onTouchCancel={() => setDockPassMap(false)}
          style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <View pointerEvents="none" style={styles.dockGlass} />
          <View pointerEvents="box-none" style={styles.dockRow}>
            <View pointerEvents="box-none" style={styles.dockStrip}>
              <ClubStrip
                items={stripItems}
                pickId={wheelSelectedId}
                windowStart={stripPlan.windowStart}
                disabled={readOnly || placing}
                onPick={(id) => {
                  if (placing || !pastRoundCanAddShot(marksOnly)) return;
                  setSelectedClubId(applyWheelSelection(id));
                  const full = clubs.find((row) => row.id === id) ?? null;
                  void markClub(full);
                }}
              />
            </View>
          </View>
          <View pointerEvents="box-none" style={styles.dockRow}>
            {dockFinish.showHoleOut ? (
              <View
                pointerEvents="box-none"
                style={[styles.dockHoleOutSlot, dockFinish.showPutts && styles.dockPuttHoleOutRow]}>
                {dockFinish.showPutts ? (
                  <PuttDock
                    disabled={readOnly || placing || busy}
                    onPress={() => void openPuttSheet(holeNumber)}
                    style={[styles.dockAction, styles.dockPutt]}
                  />
                ) : null}
                <Pressable
                  testID="play-dock-hole-out"
                  accessibilityRole="button"
                  accessibilityLabel={COPY.holeOut}
                  disabled={readOnly || placing || busy}
                  onPress={onFinishHole}
                  style={[
                    styles.dockAction,
                    styles.dockFinishHole,
                    dockFinish.showPutts && styles.dockHoleOutShrunk,
                  ]}>
                  <Text style={styles.dockActionText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                    {COPY.holeOut}
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {!readOnly && pastRoundCanAddShot(marksOnly) ? (
              <Pressable
                accessibilityRole="button"
                disabled={placing}
                onPress={() => startCatchUp(null)}
                style={styles.dockAction}>
                <Text style={styles.dockActionText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                  {COPY.addShot}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={readOnly || holeNumber <= 1}
              onPress={() => goToHole(holeNumber - 1)}
              style={styles.dockAction}>
              <Text style={styles.dockActionText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {COPY.prevHole}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={readOnly || !canAdvanceHole({ holeNumber, holeCount: round.holeCount })}
              onPress={() => goToHole(holeNumber + 1)}
              style={styles.dockAction}>
              <Text style={styles.dockActionText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {COPY.nextHole}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      </View>

      <FullSheet
        visible={menuOpen}
        title={COPY.menu}
        swipeToClose
        onDismiss={openQueuedShare}
        onClose={() => {
          setMenuOpen(false);
          bumpPlayFrame();
        }}>
        <ScrollView contentContainerStyle={styles.sheetPad}>
          <BigButton
            label={COPY.home}
            variant="secondary"
            onPress={() => {
              setMenuOpen(false);
              router.replace('/');
            }}
          />
          <BigButton
            label={COPY.previousHole}
            variant="ghost"
            disabled={holeNumber <= 1}
            onPress={() => {
              setMenuOpen(false);
              goToHole(holeNumber - 1);
            }}
          />
          <BigButton
            label={COPY.nextHole}
            variant="ghost"
            disabled={!canAdvanceHole({ holeNumber, holeCount: round.holeCount })}
            onPress={() => {
              setMenuOpen(false);
              goToHole(holeNumber + 1);
            }}
          />
          <BigButton
            label={COPY.scorecard}
            variant="ghost"
            onPress={() => {
              setMenuOpen(false);
              setScorecardOpen(true);
            }}
          />
          <BigButton
            label={COPY.nerdOut}
            variant="ghost"
            onPress={() => {
              setMenuOpen(false);
              router.push({ pathname: '/nerd-out', params: { roundId: id } });
            }}
          />
          <ShareChoice variant="ghost" onPick={queueMenuShare} />
          <BigButton
            label={COPY.roundsTransfer}
            variant="ghost"
            onPress={() => {
              setMenuOpen(false);
              router.push('/rounds-transfer');
            }}
          />
          <BigButton
            label={COPY.liveBoard}
            variant="ghost"
            onPress={() => {
              setMenuOpen(false);
              router.push(`/round/${id}/board`);
            }}
          />
          <BigButton
            label={COPY.undoLastShot}
            variant="ghost"
            disabled={busy || readOnly || shots.length === 0}
            onPress={() => {
              setMenuOpen(false);
              onUndo();
            }}
          />
          <BigButton
            label={COPY.penalty}
            variant="ghost"
            disabled={readOnly}
            onPress={() => {
              setMenuOpen(false);
              openPenaltySheet();
            }}
          />
          <BigButton
            label={COPY.settings}
            variant="ghost"
            onPress={() => {
              setMenuOpen(false);
              router.push('/settings');
            }}
          />
        </ScrollView>
      </FullSheet>

      <FullSheet
        visible={scorecardOpen}
        title={COPY.scorecard}
        onDismiss={openQueuedShare}
        onClose={dismissScorecard}>
        <ScrollView contentContainerStyle={styles.sheetPad}>
          <ScorecardBody
            holes={holes.map((row) => ({
              number: row.number,
              par: row.par,
              score: row.score,
              putts: row.putts,
              puttsDone: row.puttsDone,
              shotCount: listShotsForHole(db, row.id).length,
              penaltyStrokes: totalPenaltyStrokes(listPenaltiesForHole(db, row.id)),
              fairway: row.fairway,
            }))}
            currentHoleNumber={holeNumber}
            onSelectHole={(nextNumber) => {
              setScorecardOpen(false);
              if (nextNumber === holeNumber) {
                bumpPlayFrame();
                return;
              }
              goToHole(nextNumber);
            }}
            onBack={dismissScorecard}
            onShare={queueMenuShare}
            onNerdOut={() => {
              setScorecardOpen(false);
              router.push({ pathname: '/nerd-out', params: { roundId: id } });
            }}
          />
        </ScrollView>
      </FullSheet>

      <FullSheet
        visible={puttOpen}
        title={`${COPY.putts} · Hole ${puttSheetHole}`}
        onClose={() => {
          setPuttOpen(false);
          void pushWatchPuttSheet({ open: false, holeNumber: puttSheetHole, lengths: puttDraft.lengths });
        }}>
        <PuttSheetBody
          holeNumber={puttSheetHole}
          draft={puttDraft}
          disabled={readOnly}
          onAdd={onAddPutt}
          onUndo={onUndoPutt}
          onMadeIt={onMadeIt}
        />
      </FullSheet>

      <FullSheet
        visible={placeClubOpen || editClubOpen}
        title={pickerYards != null ? `${pickerYards} yd · ${COPY.pickClub}` : COPY.pickClub}
        onClose={() => {
          if (editClubOpen) {
            setEditClubOpen(false);
            setShowAllClubs(false);
            setEditOpen(true);
            return;
          }
          resetPlace();
        }}>
        <ScrollView contentContainerStyle={styles.sheetPad}>
          <Text style={styles.muted}>
            {pickerYards != null ? `${pickerYards} yd` : COPY.placeToHint}
          </Text>
          {placeOpeningItems.length > 0 || placeStripItems.length > 0 ? (
            <ClubStrip
              items={placeOpeningItems.length > 0 ? placeOpeningItems : placeStripItems}
              pickId={placeStripPlan.pickId}
              windowStart={placeStripPlan.windowStart}
              onPick={(id) => {
                const full = clubs.find((row) => row.id === id);
                if (!full) return;
                if (editClubOpen) commitEditClub(full.id);
                else commitPlaced(full.id);
              }}
            />
          ) : null}
          <BigButton
            label={COPY.allClubs}
            variant="secondary"
            onPress={() => setShowAllClubs((open) => !open)}
          />
          {showAllClubs || placeStripItems.length === 0 ? (
            <View style={styles.placeGrid}>
              {placeBag.map((club) => (
                <ClubButton
                  key={club.id}
                  shortName={club.shortName}
                  name={club.name}
                  onPress={() => {
                    if (editClubOpen) commitEditClub(club.id);
                    else commitPlaced(club.id);
                  }}
                />
              ))}
            </View>
          ) : null}
        </ScrollView>
      </FullSheet>

      <FullSheet
        visible={editOpen && !editClubOpen}
        title={
          editingShot
            ? `${COPY.editShot} · ${
                editingShot.clubId ? clubMap[editingShot.clubId]?.shortName ?? COPY.editShot : COPY.editShot
              }${editingShot.distanceYards != null ? ` · ${editingShot.distanceYards} yd` : ''}`
            : COPY.editShot
        }
        onClose={closeEdit}>
        <View style={styles.editSheetBody}>
          <HoleMap
            holeNumber={hole.number}
            shots={shots}
            userFix={fix}
            liveGpsToPin={liveGpsToPin}
            green={green}
            yardsToGreen={{
              yards: playHeaderYards.yards,
              quality: playHeaderYards.quality,
            }}
            osmOverlay={osmOverlay}
            missCopy={missCopy}
            paintNotice={paintBanner}
            paintSourceChip={paintSourceChip}
            requestCourse={requestCourse}
            lockFrame
            hideYardsOverlay
            showPhonePin={false}
            allowMapsChrome
            frameEpoch={`edit-${hole.number}-${editingShot?.id ?? 'none'}`}
            heading={courseCardPaint.mount ? courseCamera?.heading ?? null : null}
            framePoints={
              courseCardPaint.mount
                ? courseCamera?.points.map((point) => ({
                    latitude: point.lat,
                    longitude: point.lng,
                  }))
                : undefined
            }
          />
          <ScrollView contentContainerStyle={styles.sheetPad}>
            {editingShot ? (
              <>
                <QualityBadge
                  quality={editingShot.fixQuality}
                  open={editingShot.endedAt == null && editingShot.source !== 'no_gps'}
                  source={editingShot.source}
                />
                <BigButton
                  label={COPY.moveFrom}
                  variant="secondary"
                  disabled={readOnly || !canMoveFromPin(editingShot)}
                  onPress={() => {
                    setEditOpen(false);
                    setPlaceMode('edit-from');
                  }}
                />
                <BigButton
                  label={COPY.moveTo}
                  variant="secondary"
                  disabled={readOnly || !canMoveToPin(editingShot)}
                  onPress={() => {
                    if (!editingShot) return;
                    if (editingShot.startLat != null && editingShot.startLng != null) {
                      setPlaceFrom({ lat: editingShot.startLat, lng: editingShot.startLng });
                    }
                    if (editingShot.endLat != null && editingShot.endLng != null) {
                      setPlaceToDraft({ lat: editingShot.endLat, lng: editingShot.endLng });
                    }
                    setEditOpen(false);
                    setPlaceMode('edit-to');
                  }}
                />
                <BigButton
                  label={COPY.changeClub}
                  onPress={() => {
                    setShowAllClubs(false);
                    setEditClubOpen(true);
                  }}
                />
                <BigButton
                  label={COPY.moveSpot}
                  variant="secondary"
                  onPress={beginMoveSpot}
                />
                {editUndo?.id === editingShot.id ? (
                  <BigButton label={COPY.undoEdit} variant="ghost" onPress={onUndoEdit} />
                ) : null}
                <BigButton
                  label={COPY.deleteShot}
                  variant="danger"
                  onPress={() => onDeleteShot(editingShot.id)}
                />
              </>
            ) : (
              <Text style={styles.muted}>{COPY.noShots}</Text>
            )}
          </ScrollView>
        </View>
      </FullSheet>

      <FullSheet visible={scoreOpen} title={`Hole ${hole.number}`} onClose={() => setScoreOpen(false)}>
        <ScrollView contentContainerStyle={styles.sheetPad}>
          <Text style={styles.label}>{formatParLabel(hole.par)}</Text>
          <View style={styles.row}>
            {[3, 4, 5, 6].map((par) => (
              <Pressable
                key={par}
                disabled={readOnly}
                onPress={() => {
                  updateHolePar(db, hole.id, par);
                  bump();
                }}
                style={[styles.chip, hole.par === par && styles.chipOn]}>
                <Text style={styles.chipText}>{par}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.label}>{COPY.score}</Text>
          <View style={styles.row}>
            <Pressable
              disabled={readOnly}
              onPress={() => {
                const next = Math.max(1, (hole.score ?? hole.par ?? 1) - 1);
                updateHoleScore(db, hole.id, next);
                bump();
              }}
              style={styles.step}>
              <Text style={styles.stepText}>−</Text>
            </Pressable>
            <Text style={styles.score}>{hole.score ?? '—'}</Text>
            <Pressable
              disabled={readOnly}
              onPress={() => {
                const next = (hole.score ?? hole.par ?? 0) + 1;
                updateHoleScore(db, hole.id, next);
                bump();
              }}
              style={styles.step}>
              <Text style={styles.stepText}>+</Text>
            </Pressable>
          </View>
          {reconcile.mismatch ? <Text style={styles.warn}>{scoreMismatchMessage(reconcile)}</Text> : null}
          {holeHasFairway(hole.par) ? (
            <FairwayPicker value={hole.fairway} disabled={readOnly} onPick={onPickFairway} />
          ) : null}

          <Text style={styles.label}>{COPY.shots}</Text>
          {shots.length === 0 ? (
            <Text style={styles.muted}>{COPY.noShots}</Text>
          ) : (
            shots.map((shot) => {
              const club = shot.clubId ? clubMap[shot.clubId] : null;
              const openShot = shot.endedAt == null;
              const noGps = shot.source === 'no_gps' || shot.fixQuality === 'none';
              const slot = insertSlots.find((row) => row.afterShotId === shot.id);
              return (
                <View key={shot.id}>
                  <Pressable
                    onPress={() => openEdit(shot.id)}
                    style={styles.shot}>
                    <Text style={styles.shotSeq}>{shot.seq}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.shotClub}>{club?.name ?? 'Club'}</Text>
                      <Text style={styles.meta}>
                        {noGps
                          ? shot.typedYards != null
                            ? `${shot.typedYards} yd`
                            : COPY.logged
                          : openShot
                            ? COPY.inPlay
                            : `${shot.distanceYards ?? '—'} yd`}
                        {shot.suggested ? ` · ${COPY.suggested}` : ''}
                      </Text>
                      {!readOnly ? <Text style={styles.meta}>{COPY.changeClub}</Text> : null}
                    </View>
                    {isHoleOutShot(shot) ? <HoleOutBadge testID="hole-out-score-badge" /> : null}
                    <QualityBadge quality={shot.fixQuality} open={openShot && !noGps} source={shot.source} />
                  </Pressable>
                  {!readOnly && pastRoundCanAddShot(marksOnly) && slot ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={COPY.insertShot}
                      onPress={() => {
                        setScoreOpen(false);
                        startCatchUp(slot.seq);
                      }}
                      style={styles.insertPlus}>
                      <Text style={styles.insertPlusText}>+</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })
          )}

          {penalties.map((penalty) => (
            <Pressable
              key={penalty.id}
              disabled={readOnly}
              accessibilityRole="button"
              accessibilityLabel={formatPenaltyRow(penalty)}
              onPress={() => openPenaltyActions(penalty.id)}
              style={styles.shot}>
              <Text style={styles.shotSeq}>+</Text>
              <Text style={styles.shotClub}>{formatPenaltyRow(penalty)}</Text>
            </Pressable>
          ))}

          {!readOnly && pastRoundCanAddShot(marksOnly) ? (
            <>
              <BigButton
                label={COPY.markWithoutClub}
                variant="secondary"
                disabled={busy}
                onPress={() => {
                  setScoreOpen(false);
                  void markClub(null);
                }}
              />
              <BigButton
                label={COPY.addShot}
                variant="secondary"
                onPress={() => {
                  setScoreOpen(false);
                  startCatchUp(null);
                }}
              />
              <BigButton
                label={COPY.undoLast}
                variant="ghost"
                disabled={shots.length === 0}
                onPress={onUndo}
              />
              <BigButton
                label={COPY.endShot}
                variant="ghost"
                disabled={!open}
                onPress={() => void onEndShot()}
              />
              <BigButton
                label={COPY.finishRound}
                variant="danger"
                onPress={() => {
                  finishRound(db, id);
                  endWatchRound(id);
                  bump();
                  router.replace(`/round/${id}/summary`);
                }}
              />
            </>
          ) : (
            <BigButton label="Summary" variant="secondary" onPress={() => router.push(`/round/${id}/summary`)} />
          )}
        </ScrollView>
      </FullSheet>

      <FullSheet visible={penaltyOpen} title={COPY.penalty} onClose={() => setPenaltyOpen(false)}>
        <ScrollView contentContainerStyle={styles.sheetPad}>
          <View style={styles.row}>
            <Pressable onPress={() => setPenaltyStrokes((n) => Math.max(1, n - 1))} style={styles.step}>
              <Text style={styles.stepText}>−</Text>
            </Pressable>
            <Text style={styles.score}>{penaltyStrokes}</Text>
            <Pressable onPress={() => setPenaltyStrokes((n) => Math.min(5, n + 1))} style={styles.step}>
              <Text style={styles.stepText}>+</Text>
            </Pressable>
          </View>
          <View style={styles.reasonRow}>
            {PENALTY_REASONS.map((item) => (
              <Pressable
                key={item.reason}
                onPress={() => setPenaltyReason(item.reason)}
                style={[styles.reasonChip, penaltyReason === item.reason && styles.chipOn]}>
                <Text style={styles.reasonText}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
          {shots.length > 0 ? (
            <View>
              <Text style={styles.label}>{COPY.afterShot}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.afterShotRow}>
                {shots.map((shot) => {
                  const club = shot.clubId ? clubMap[shot.clubId] : null;
                  const selected = penaltyAfterShotId === shot.id;
                  return (
                    <Pressable
                      key={shot.id}
                      accessibilityRole="button"
                      onPress={() => setPenaltyAfterShotId(shot.id)}
                      style={[styles.afterShotChip, selected && styles.chipOn]}>
                      <Text style={styles.afterShotText} numberOfLines={1}>
                        {formatShotStepChip({
                          seq: shot.seq,
                          clubShortName: club?.shortName,
                          source: shot.source,
                          fixQuality: shot.fixQuality,
                          endedAt: shot.endedAt,
                          distanceYards: shot.distanceYards,
                        })}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
          <TextInput
            placeholder={COPY.penaltyNote}
            placeholderTextColor={colors.muted}
            value={penaltyNote}
            onChangeText={setPenaltyNote}
            style={styles.note}
          />
          <BigButton label={`Add +${penaltyStrokes}`} onPress={onAddPenalty} />
        </ScrollView>
      </FullSheet>

      <FullSheet
        visible={changePenaltyId != null}
        title={COPY.changePenalty}
        onClose={() => setChangePenaltyId(null)}>
        <ScrollView contentContainerStyle={styles.sheetPad}>
          <View style={styles.reasonRow}>
            {PENALTY_REASONS.map((item) => (
              <Pressable
                key={item.reason}
                onPress={() => setChangeReason(item.reason)}
                style={[styles.reasonChip, changeReason === item.reason && styles.chipOn]}>
                <Text style={styles.reasonText}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            placeholder={COPY.penaltyNote}
            placeholderTextColor={colors.muted}
            value={changeNote}
            onChangeText={setChangeNote}
            style={styles.note}
          />
          <BigButton label={COPY.savePenaltyReason} onPress={onSavePenaltyReason} />
        </ScrollView>
      </FullSheet>
    </Animated.View>
  );
}

function makeStyles(colors: ColorPalette) {
  return StyleSheet.create({
  fill: { flex: 1, height: '100%', backgroundColor: colors.bg },
  mapFill: {
    ...StyleSheet.absoluteFill,
    flex: 1,
    minHeight: 0,
    alignSelf: 'stretch',
  },
  catchUpBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.overlay,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  catchUpHint: {
    marginTop: 8,
    backgroundColor: colors.overlay,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.cream,
    fontSize: type.body,
    fontWeight: '800',
  },
  confirmDock: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 0,
  },
  sticky: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
  },
  stickyInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.overlay,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  menuButton: {
    minHeight: tapTarget,
    minWidth: 88,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuButtonText: { color: colors.cream, fontWeight: '800', fontSize: type.button },
  scorecardChip: {
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scorecardChipText: { color: colors.cream, fontWeight: '800', fontSize: type.tiny },
  finishedHoleChip: {
    marginTop: 6,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minHeight: 32,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
  },
  finishedHoleText: { color: colors.cream, fontWeight: '800', fontSize: type.tiny },
  finishedHoleVsPar: { color: colors.cream, fontWeight: '800', fontSize: type.tiny },
  finishedHoleGood: { color: colors.good, fontWeight: '900' },
  finishedHoleBad: { color: colors.red, fontWeight: '900' },
  finishedHoleFlag: { color: colors.lime, fontWeight: '900', fontSize: type.tiny },
  headerCorner: {
    position: 'absolute',
    right: 12,
    alignItems: 'flex-end',
    gap: 6,
    maxWidth: '46%',
  },
  hazardBadge: {
    maxWidth: 160,
    backgroundColor: colors.overlay,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 2,
    alignItems: 'flex-end',
  },
  hazardText: { color: colors.cream, fontSize: type.tiny, fontWeight: '800' },
  runningParBadge: {
    maxWidth: 132,
    backgroundColor: colors.overlay,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  runningParText: { color: colors.cream, fontSize: type.tiny, fontWeight: '800' },
  runningParGood: { color: colors.good, fontWeight: '900' },
  runningParBad: { color: colors.red, fontWeight: '900' },
  dockHoleOutSlot: { flex: 1.2, minWidth: 88, gap: 4 },
  dockPuttHoleOutRow: { flexDirection: 'row', alignItems: 'center', minWidth: 108 },
  dockPutt: { flex: PLAY_DOCK_PUTT_FLEX, minWidth: PLAY_CONTROL_MIN_TAP },
  dockHoleOutShrunk: { flex: PLAY_DOCK_HOLE_OUT_SHRINK_FLEX, minWidth: PLAY_CONTROL_MIN_TAP, paddingHorizontal: 1 },
  back: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  backLabel: { color: colors.cream, fontWeight: '800', fontSize: type.meta },
  allClubsFloat: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: PLAY_GLASS_DOCK_LIFT,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  allClubsPill: {
    height: PHONE_WHEEL_PILL_HEIGHT,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 120,
    maxWidth: 168,
    minWidth: 0,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  allClubsPillText: { color: colors.cream, fontWeight: '800', fontSize: type.chip },
  holeTitle: { color: colors.cream, fontSize: type.hole, fontWeight: '900' },
  holeMeta: { color: colors.muted, fontSize: type.kicker, fontWeight: '600' },
  shotLine: { marginTop: 6, maxHeight: 36, flexGrow: 0 },
  shotLineInner: { alignItems: 'center', gap: 6, paddingRight: 8 },
  shotLineItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shotLineShot: {
    minHeight: 32,
    borderRadius: 10,
    backgroundColor: colors.overlay,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  shotLineText: { color: colors.cream, fontSize: type.tiny, fontWeight: '800' },
  shotLinePenalty: { color: colors.amber, fontSize: type.tiny, fontWeight: '800' },
  shotLineHoleOut: { color: colors.lime, fontSize: type.tiny, fontWeight: '900' },
  shotLineMuted: { color: colors.muted, fontSize: type.tiny, fontWeight: '700' },
  shotLinePlus: {
    minHeight: 32,
    minWidth: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlay,
  },
  shotLinePlusText: { color: colors.cream, fontSize: 18, fontWeight: '900', lineHeight: 20 },
  overlayBanner: {
    marginTop: 6,
    backgroundColor: colors.overlay,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 4,
  },
  overlayLink: {
    marginTop: 6,
    minHeight: 32,
    justifyContent: 'center',
    backgroundColor: colors.overlay,
    borderRadius: 10,
    paddingHorizontal: 10,
  },
  overlayToast: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.overlay,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  overlayToastText: {
    color: colors.cream,
    fontSize: type.tiny,
    fontWeight: '800',
  },
  holeOutCheck: {
    color: colors.lime,
    fontSize: type.body,
    fontWeight: '900',
  },
  firstLaunchTipRow: {
    marginTop: 6,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  firstLaunchTip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.overlay,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 32,
  },
  firstLaunchTipText: {
    flexShrink: 1,
    color: colors.cream,
    fontSize: type.tiny,
    fontWeight: '800',
  },
  firstLaunchTipDismiss: {
    color: colors.muted,
    fontSize: type.tiny,
    fontWeight: '800',
  },
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexGrow: 0,
    flexShrink: 0,
    paddingHorizontal: 10,
    paddingTop: 8,
    gap: 8,
  },
  dockGlass: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.glass,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  dockRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'nowrap', gap: 6 },
  dockFinishHole: { borderColor: colors.cream, borderWidth: 2, backgroundColor: colors.accentWash },
  dockStrip: { flex: 1, minWidth: 0, height: PHONE_WHEEL_STRIP_HEIGHT },
  dockChip: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgElevated,
    paddingHorizontal: 4,
  },
  dockChipSide: {
    flexShrink: 0,
    minHeight: 36,
    minWidth: 64,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgElevated,
    paddingHorizontal: 8,
  },
  dockChipPrimary: { borderColor: colors.cream, borderWidth: 2, backgroundColor: colors.accentWash },
  dockChipText: { color: colors.cream, fontWeight: '800', fontSize: type.tiny },
  dockChipPrimaryText: { color: colors.cream, fontWeight: '900' },
  dockAction: {
    flex: 1,
    minHeight: PLAY_DOCK_ACTION_MIN_HEIGHT,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgElevated,
    paddingHorizontal: 2,
  },
  dockActionText: { color: colors.cream, fontWeight: '800', fontSize: 11, textAlign: 'center' },
  dockScorecard: { flexGrow: 1.15, flexShrink: 0, minWidth: 72, paddingHorizontal: 4 },
  dockScorecardText: {
    color: colors.cream,
    fontWeight: '800',
    fontSize: 11,
    textAlign: 'center',
  },
  top3: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 8 },
  top3Chip: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgElevated,
  },
  top3Primary: {
    flex: 2.2,
    minHeight: tapTarget,
    borderColor: colors.cream,
    borderWidth: 2,
    backgroundColor: colors.accentWash,
  },
  top3Text: { color: colors.cream, fontWeight: '800', fontSize: type.chip },
  top3PrimaryText: { color: colors.cream, fontSize: type.button, fontWeight: '900' },
  suggest: { color: colors.muted, fontSize: type.tiny, fontWeight: '800' },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  warn: { color: colors.orange, fontSize: type.meta, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: type.body },
  meta: { color: colors.muted, fontSize: type.meta },
  label: { color: colors.cream, fontSize: type.meta, fontWeight: '800', letterSpacing: 0.6 },
  sheetPad: { padding: 16, gap: 12, paddingBottom: 40 },
  editSheetBody: { flex: 1 },
  placeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  placeTop3: { flexDirection: 'row', gap: 8 },
  chip: {
    minHeight: 56,
    minWidth: 56,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgElevated,
  },
  chipOn: { borderColor: colors.cream, backgroundColor: colors.accentWash },
  chipText: { color: colors.cream, fontSize: 22, fontWeight: '800' },
  step: {
    minHeight: 64,
    minWidth: 64,
    borderRadius: 16,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
  },
  stepText: { color: colors.cream, fontSize: 32, fontWeight: '800' },
  score: { color: colors.cream, fontSize: 36, fontWeight: '900', minWidth: 64, textAlign: 'center' },
  shot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.bgElevated,
    padding: 12,
    borderRadius: 14,
    minHeight: 64,
  },
  insertPlus: {
    alignSelf: 'center',
    minHeight: 36,
    minWidth: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },
  insertPlusText: { color: colors.cream, fontSize: 22, fontWeight: '900', lineHeight: 24 },
  shotSeq: { color: colors.cream, fontWeight: '900', fontSize: 20, width: 24 },
  shotClub: { color: colors.cream, fontSize: 18, fontWeight: '700' },
  reasonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reasonChip: {
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  reasonText: { color: colors.cream, fontSize: 16, fontWeight: '800' },
  afterShotRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 4 },
  afterShotChip: {
    minHeight: 36,
    maxWidth: 168,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  afterShotText: { color: colors.cream, fontSize: type.tiny, fontWeight: '800' },
  note: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    color: colors.cream,
    fontSize: 16,
    backgroundColor: colors.bgElevated,
  },
  });
}
