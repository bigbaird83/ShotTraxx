import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { getCourseDataClient } from '@/src/course/client';
import { teePointForHole, teePointFromHoleFeature } from '@/src/course/osmOverlay';
import type { OsmOverlay } from '@/src/course/types';
import { useDb } from '@/src/db/DbProvider';
import {
  deletePenalty,
  fillAutoShotLies,
  getClubMap,
  getRound,
  listClubAverages,
  listClubs,
  listHoles,
  listPenaltiesForHole,
  listShotsForHole,
  setShotLie,
  updatePenaltyReason,
} from '@/src/db/repo';
import { formatClubStripLabel, planClubStrip, toWheelFillClub } from '@/src/domain/clubStrip';
import { isPutterClubId } from '@/src/domain/defaultBag';
import { resolveHoleTee, shotPinsForHoleCamera } from '@/src/domain/holeCamera';
import { isValidLatLng, type LatLng } from '@/src/domain/latLng';
import { PENALTY_REASONS } from '@/src/domain/penalty';
import { penaltyNoteForSave, penaltyStepActionSheet } from '@/src/domain/penaltyEdit';
import { orderHoleSteps, type OrderedHoleStep } from '@/src/domain/penaltySteps';
import { COPY } from '@/src/domain/playerCopy';
import { SHOT_LIE_LABELS, SHOT_LIES, type ShotLie } from '@/src/domain/shotLie';
import { deleteShotPrompt } from '@/src/domain/deleteShot';
import { frameMapCenter, moveSpotDraftOrigin, shotStoredPosition } from '@/src/domain/shotEdit';
import {
  SHOT_REVIEW_MAP_MIN_HEIGHT,
  SHOT_REVIEW_SHOT_LIST_MAX_HEIGHT,
  shotReviewCamera,
  shotReviewFramePoints,
  type ShotReviewBox,
  shotReviewHoleHeader,
  shotReviewPuttLines,
  shotReviewShotListWindow,
} from '@/src/domain/shotReviewLayout';
import type { Club, PenaltyReason, Shot } from '@/src/domain/types';
import { changeShotClub, deleteHoleShot, moveShotSpot } from '@/src/services/shotActions';
import { getCurrentFix } from '@/src/services/location';
import { BigButton } from '@/src/ui/BigButton';
import { ClubButton } from '@/src/ui/ClubButton';
import { ClubStrip } from '@/src/ui/ClubStrip';
import { HoleMap } from '@/src/ui/HoleMap';
import { FullSheet } from '@/src/ui/Sheet';
import { Screen } from '@/src/ui/Screen';
import { useColors } from '@/src/ui/ColorThemeProvider';
import { cardBorder } from '@/src/ui/surface';
import { tapTarget, type ColorPalette } from '@/src/ui/theme';

const REVIEW_TRAIL_TO_GREEN = { yards: null, quality: 'none' as const };

/**
 * Saved-round shot review: one locked tee-to-green map per hole with the marked shots
 * and their yard chips. Hole list + Prev / Next. The map never shows a live fix.
 * A shot with no stored position may start its drag pin at the device location;
 * that pin is not saved until it is dropped and confirmed.
 *
 * The map slot is the only flexible region (HoleMap's shared card is a fixed height,
 * so this screen overrides it with flex). The shot list and hole buttons are a pinned
 * bottom section, just above the screen safe area. Long lists scroll inside a cap.
 */
export default function ReviewShotsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { db, revision, bump } = useDb();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [osmOverlay, setOsmOverlay] = useState<OsmOverlay | null>(null);
  const [index, setIndex] = useState(0);
  const [mapBox, setMapBox] = useState<ShotReviewBox | null>(null);
  const [editShotId, setEditShotId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [clubOpen, setClubOpen] = useState(false);
  const [showAllClubs, setShowAllClubs] = useState(false);
  const [movingSpot, setMovingSpot] = useState(false);
  const [moveDraft, setMoveDraft] = useState<LatLng | null>(null);
  const [moveDropped, setMoveDropped] = useState(false);
  const [changePenaltyId, setChangePenaltyId] = useState<string | null>(null);
  const [changeReason, setChangeReason] = useState<PenaltyReason>('water');
  const [changeNote, setChangeNote] = useState('');
  const round = useMemo(() => getRound(db, id), [db, id, revision]);
  const holes = useMemo(() => (round ? listHoles(db, round.id) : []), [db, round, revision]);
  const clubs = useMemo(() => getClubMap(db), [db, revision]);
  const clubList = useMemo(() => listClubs(db), [db, revision]);
  const averages = useMemo(() => listClubAverages(db), [db, revision]);
  const hole = holes[Math.min(index, Math.max(0, holes.length - 1))] ?? null;
  const shots = useMemo(() => (hole ? listShotsForHole(db, hole.id) : []), [db, hole, revision]);
  const penalties = useMemo(() => (hole ? listPenaltiesForHole(db, hole.id) : []), [db, hole, revision]);
  const holeSteps = useMemo(() => orderHoleSteps(shots, penalties), [shots, penalties]);

  useEffect(() => {
    if (!round || round.courseLat == null || round.courseLng == null) {
      setOsmOverlay(null);
      return;
    }
    let live = true;
    void getCourseDataClient()
      .fetchOsmOverlay({
        courseId: round.courseApiId,
        location: { lat: round.courseLat, lng: round.courseLng },
        courseLocation: { lat: round.courseLat, lng: round.courseLng },
      })
      .then((overlay) => {
        if (live) setOsmOverlay(overlay);
      })
      .catch(() => {
        if (live) setOsmOverlay(null);
      });
    return () => {
      live = false;
    };
  }, [round]);

  // Auto lie for this hole from the course outlines. Player taps stay.
  useEffect(() => {
    if (!hole || !osmOverlay) return;
    if (fillAutoShotLies(db, [hole.id], osmOverlay.features) > 0) bump();
  }, [db, hole, osmOverlay, shots, bump]);

  if (!round) {
    return (
      <Screen>
        <Text style={styles.muted}>Round not found.</Text>
      </Screen>
    );
  }

  const green =
    hole && hole.greenLat != null && hole.greenLng != null
      ? { lat: hole.greenLat, lng: hole.greenLng }
      : null;
  const storedTee =
    hole && hole.teeLat != null && hole.teeLng != null ? { lat: hole.teeLat, lng: hole.teeLng } : null;
  const tee = hole
    ? resolveHoleTee({
        holeTee: storedTee ?? teePointFromHoleFeature(osmOverlay, hole.number, green),
        osmTee: teePointForHole(osmOverlay, hole.number),
        green,
      })
    : null;
  // Putts are stats-only rows under the shot list. They never become pins.
  const puttLines = hole ? shotReviewPuttLines(hole) : [];
  const shotPins = shotPinsForHoleCamera(shots);
  // Fit tee → GPS shot pins → green to the measured map slot. Putts are not pins.
  const camera = hole ? shotReviewCamera({ tee, green, shotPins, box: mapBox }) : null;
  const editingShot = editShotId ? shots.find((shot) => shot.id === editShotId) ?? null : null;
  const framePoints = shotReviewFramePoints({ tee, green, shotPins });
  const bag = clubList.filter((club) => !isPutterClubId(club.id));
  const stripPlan = planClubStrip({
    clubs: clubList.map((club) => {
      const row = averages.find((item) => item.club.id === club.id);
      return toWheelFillClub(club, row);
    }),
    yardsLeft: editingShot?.distanceYards ?? null,
  });
  const stripItems = stripPlan.ids
    .filter((clubId) => !isPutterClubId(clubId))
    .map((clubId) => {
      const club = clubList.find((row) => row.id === clubId);
      return {
        id: clubId,
        label: formatClubStripLabel({
          id: clubId,
          shortName: club?.shortName ?? clubId,
          carry: stripPlan.carries[clubId],
        }),
      };
    });

  const openEdit = (shotId: string) => {
    if (movingSpot) return;
    setEditShotId(shotId);
    setClubOpen(false);
    setShowAllClubs(false);
    setEditOpen(true);
  };

  const closeEdit = () => {
    setEditOpen(false);
    setClubOpen(false);
    setShowAllClubs(false);
    setEditShotId(null);
  };

  const startMoveSpot = async () => {
    if (!editingShot) return;
    const stored = shotStoredPosition(editingShot);
    let device: LatLng | null = null;
    if (!stored) {
      try {
        const current = await getCurrentFix();
        const point = { lat: current.lat, lng: current.lng };
        device = isValidLatLng(point) ? point : null;
      } catch {
        device = null;
      }
    }
    const origin = moveSpotDraftOrigin({
      stored,
      device,
      mapCenter: frameMapCenter(framePoints),
    });
    if (!origin) return;
    setMoveDraft(origin.point);
    setMoveDropped(false);
    setEditOpen(false);
    setMovingSpot(true);
  };

  const cancelMoveSpot = () => {
    setMovingSpot(false);
    setMoveDropped(false);
    setMoveDraft(null);
    if (editShotId) setEditOpen(true);
  };

  const commitMoveSpot = () => {
    if (!hole || !editShotId || !moveDraft || !moveDropped) return;
    const result = moveShotSpot(db, {
      roundId: round.id,
      holeNumber: hole.number,
      shotId: editShotId,
      point: moveDraft,
      dropped: true,
      confirmed: true,
    });
    if (result.status !== 'commit') return;
    setMovingSpot(false);
    setMoveDropped(false);
    setMoveDraft(null);
    setEditOpen(true);
    bump();
  };

  const commitLie = (lie: ShotLie | null) => {
    if (!editShotId) return;
    setShotLie(db, editShotId, lie);
    bump();
  };

  const commitClub = (clubId: string) => {
    if (!editShotId) return;
    const result = changeShotClub(db, { roundId: round.id, shotId: editShotId, clubId });
    if (result.status !== 'commit') return;
    setClubOpen(false);
    setShowAllClubs(false);
    setEditOpen(true);
    bump();
  };

  const beginChangePenalty = (penaltyId: string) => {
    const penalty = penalties.find((row) => row.id === penaltyId);
    if (!penalty) return;
    setChangeReason(penalty.reason);
    setChangeNote(penalty.note ?? '');
    setChangePenaltyId(penalty.id);
  };

  const onSavePenaltyReason = () => {
    if (!changePenaltyId) return;
    const result = updatePenaltyReason(db, {
      penaltyId: changePenaltyId,
      reason: changeReason,
      note: penaltyNoteForSave(changeReason, changeNote),
    });
    if (result.status !== 'updated') return;
    setChangePenaltyId(null);
    bump();
  };

  const onDeletePenalty = (penaltyId: string) => {
    const result = deletePenalty(db, penaltyId);
    if (result.status !== 'deleted') return;
    if (changePenaltyId === penaltyId) setChangePenaltyId(null);
    bump();
  };

  const openPenaltyActions = (penaltyId: string) => {
    if (movingSpot) return;
    const actions = penaltyStepActionSheet();
    Alert.alert(actions.title, '', [
      { text: actions.options[0], onPress: () => beginChangePenalty(penaltyId) },
      { text: actions.options[1], style: 'destructive', onPress: () => onDeletePenalty(penaltyId) },
      { text: actions.cancel, style: 'cancel' },
    ]);
  };

  const onDeleteShot = (shotId: string) => {
    if (!hole) return;
    const prompt = deleteShotPrompt();
    Alert.alert(prompt.title, '', [
      { text: prompt.cancel, style: 'cancel' },
      {
        text: prompt.confirm,
        style: 'destructive',
        onPress: () => {
          const result = deleteHoleShot(db, {
            roundId: round.id,
            holeNumber: hole.number,
            shotId,
            confirmed: true,
          });
          if (result.status !== 'commit') return;
          closeEdit();
          bump();
        },
      },
    ]);
  };

  return (
    <Screen scroll={false}>
      <Text style={styles.title}>{round.courseName ?? 'Round'}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipRow}
        contentContainerStyle={styles.chips}>
        {holes.map((row, i) => (
          <Pressable
            key={row.id}
            accessibilityRole="button"
            accessibilityLabel={`Hole ${row.number}`}
            testID={`shot-review-hole-${row.number}`}
            onPress={() => {
              setChangePenaltyId(null);
              setIndex(i);
            }}
            style={[styles.chip, hole?.id === row.id && styles.chipOn]}>
            <Text style={[styles.chipText, hole?.id === row.id && styles.chipTextOn]}>{row.number}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.holeColumn}>
        {hole ? (
          <Text style={styles.label}>{shotReviewHoleHeader(hole)}</Text>
        ) : null}
        <View
          style={styles.mapSlot}
          testID="shot-review-map"
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setMapBox((prev) =>
              prev && prev.width === width && prev.height === height ? prev : { width, height },
            );
          }}>
          {hole && camera ? (
            <HoleMap
              holeNumber={hole.number}
              shots={shots}
              userFix={null}
              green={green}
              yardsToGreen={REVIEW_TRAIL_TO_GREEN}
              osmOverlay={osmOverlay}
              lockFrame
              hideYardsOverlay
              frameEpoch={`review-${round.id}-${hole.number}`}
              heading={camera.heading}
              fitCamera={camera}
              framePoints={shotReviewFramePoints({ tee, green, shotPins }).map((point) => ({
                latitude: point.lat,
                longitude: point.lng,
              }))}
              style={styles.mapFill}
              onShotPress={movingSpot ? undefined : openEdit}
              placedTo={movingSpot ? moveDraft : null}
              lineFrom={null}
              lineGreen={null}
              onPlaceToDrag={
                movingSpot
                  ? (point) => {
                      setMoveDraft(point);
                      setMoveDropped(true);
                    }
                  : undefined
              }
              placeHint={movingSpot ? COPY.moveSpotHint : null}
            />
          ) : hole && mapBox ? (
            <Text style={styles.muted}>{COPY.shotReviewNoMap}</Text>
          ) : null}
        </View>
      </View>

      <View style={styles.bottom} testID="shot-review-bottom">
        {hole && (shots.length > 0 || penalties.length > 0 || puttLines.length > 0) ? (
          <ReviewShotList
            key={hole.id}
            shots={shots}
            steps={holeSteps}
            puttLines={puttLines}
            clubs={clubs}
            textStyle={styles.muted}
            listStyle={styles.shotList}
            contentStyle={styles.shotListContent}
            onShotPress={movingSpot ? undefined : openEdit}
            onPenaltyPress={movingSpot ? undefined : openPenaltyActions}
          />
        ) : null}
        {movingSpot ? (
          <View style={styles.nav}>
            <BigButton label={COPY.cancel} variant="ghost" onPress={cancelMoveSpot} style={styles.navBtn} />
            <BigButton
              label={COPY.confirmPlace}
              disabled={!moveDropped || !moveDraft}
              onPress={commitMoveSpot}
              style={styles.navBtn}
            />
          </View>
        ) : (
        <View style={styles.nav}>
          <BigButton
            label={COPY.previousHole}
            variant="ghost"
            disabled={index <= 0}
            onPress={() => setIndex((i) => Math.max(0, i - 1))}
            style={styles.navBtn}
          />
          <BigButton
            label={COPY.nextHole}
            variant="ghost"
            disabled={index >= holes.length - 1}
            onPress={() => setIndex((i) => Math.min(holes.length - 1, i + 1))}
            style={styles.navBtn}
          />
        </View>
        )}
      </View>

      <FullSheet
        visible={editOpen && !clubOpen}
        title={
          editingShot
            ? `${COPY.editShot} · ${
                editingShot.clubId ? clubs[editingShot.clubId]?.shortName ?? COPY.editShot : COPY.editShot
              }${editingShot.distanceYards != null ? ` · ${editingShot.distanceYards} yd` : ''}`
            : COPY.editShot
        }
        onClose={closeEdit}>
        <ScrollView contentContainerStyle={styles.sheetPad}>
          {editingShot ? (
            <>
              <BigButton label={COPY.changeClub} onPress={() => setClubOpen(true)} />
              {editingShot.seq > 1 ? (
                <View style={styles.lieBlock} testID="shot-lie-picker">
                  <Text style={styles.lieTitle}>
                    {COPY.shotLie}
                    {editingShot.lie
                      ? ` · ${SHOT_LIE_LABELS[editingShot.lie]}${editingShot.lieSource === 'auto' ? ` (${COPY.shotLieAuto})` : ''}`
                      : ` · ${COPY.shotLieUnknown}`}
                  </Text>
                  <View style={styles.reasonRow}>
                    {SHOT_LIES.map((lie) => {
                      const on = editingShot.lie === lie;
                      return (
                        <Pressable
                          key={lie}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          testID={`shot-lie-${lie}`}
                          onPress={() => commitLie(lie)}
                          style={[styles.reasonChip, on && styles.reasonOn]}>
                          <Text style={styles.reasonText}>{SHOT_LIE_LABELS[lie]}</Text>
                        </Pressable>
                      );
                    })}
                    {editingShot.lieSource === 'player' ? (
                      <Pressable
                        accessibilityRole="button"
                        testID="shot-lie-auto"
                        onPress={() => commitLie(null)}
                        style={styles.reasonChip}>
                        <Text style={styles.reasonText}>{COPY.shotLieAuto}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ) : null}
              <BigButton label={COPY.moveSpot} variant="secondary" onPress={() => void startMoveSpot()} />
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
      </FullSheet>

      <FullSheet
        visible={clubOpen}
        title={
          editingShot?.distanceYards != null
            ? `${editingShot.distanceYards} yd · ${COPY.pickClub}`
            : COPY.pickClub
        }
        onClose={() => {
          setClubOpen(false);
          setShowAllClubs(false);
          setEditOpen(true);
        }}>
        <ScrollView contentContainerStyle={styles.sheetPad}>
          {stripItems.length > 0 ? (
            <ClubStrip
              items={stripItems}
              pickId={stripPlan.pickId}
              windowStart={stripPlan.windowStart}
              onPick={commitClub}
            />
          ) : null}
          <BigButton
            label={COPY.allClubs}
            variant="secondary"
            onPress={() => setShowAllClubs((open) => !open)}
          />
          {showAllClubs || stripItems.length === 0 ? (
            <View style={styles.placeGrid}>
              {bag.map((club) => (
                <ClubButton
                  key={club.id}
                  shortName={club.shortName}
                  name={club.name}
                  onPress={() => commitClub(club.id)}
                />
              ))}
            </View>
          ) : null}
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
                style={[styles.reasonChip, changeReason === item.reason && styles.reasonOn]}>
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
    </Screen>
  );
}

function ReviewShotList({
  shots,
  steps,
  puttLines,
  clubs,
  textStyle,
  listStyle,
  contentStyle,
  onShotPress,
  onPenaltyPress,
}: {
  shots: Shot[];
  steps: OrderedHoleStep[];
  puttLines: string[];
  clubs: Record<string, Club>;
  textStyle: StyleProp<TextStyle>;
  listStyle: StyleProp<ViewStyle>;
  contentStyle: StyleProp<ViewStyle>;
  onShotPress?: (shotId: string) => void;
  onPenaltyPress?: (penaltyId: string) => void;
}) {
  const [contentHeight, setContentHeight] = useState(0);
  const windowHeight = shotReviewShotListWindow(contentHeight);
  return (
    <ScrollView
      testID="shot-review-shots"
      style={[listStyle, windowHeight > 0 ? { height: windowHeight } : null]}
      contentContainerStyle={contentStyle}
      nestedScrollEnabled
      scrollEnabled={contentHeight > SHOT_REVIEW_SHOT_LIST_MAX_HEIGHT}
      onContentSizeChange={(_width, height) => {
        setContentHeight((prev) => (prev === height ? prev : height));
      }}>
      {steps.map((step) => {
        if (step.kind === 'penalty') {
          return (
            <Pressable
              key={step.id}
              accessibilityRole="button"
              accessibilityLabel={step.label}
              onPress={() => onPenaltyPress?.(step.id)}>
              <Text style={textStyle}>{step.label}</Text>
            </Pressable>
          );
        }
        const shot = shots[step.sourceIndex];
        if (!shot) return null;
        return (
          <Pressable
            key={shot.id}
            accessibilityRole="button"
            onPress={() => onShotPress?.(shot.id)}>
            <Text style={textStyle}>
              {shot.seq}. {shot.clubId ? (clubs[shot.clubId]?.name ?? 'Club') : '—'}
              {shot.distanceYards != null ? ` · ${Math.round(shot.distanceYards)} yd` : ''}
              {shot.seq > 1 && shot.lie ? ` · ${SHOT_LIE_LABELS[shot.lie]}` : ''}
            </Text>
          </Pressable>
        );
      })}
      {puttLines.map((line, i) => (
        <Text key={`putt-${i}`} style={textStyle}>
          {line}
        </Text>
      ))}
    </ScrollView>
  );
}

function makeStyles(colors: ColorPalette) {
  return StyleSheet.create({
    title: { color: colors.cream, fontSize: 24, fontWeight: '900', flexShrink: 0 },
    label: { color: colors.muted, fontSize: 14, fontWeight: '800', flexShrink: 0 },
    muted: { color: colors.muted, fontSize: 16 },
    holeColumn: { flex: 1, minHeight: 0, gap: 8 },
    mapSlot: { flex: 1, minHeight: SHOT_REVIEW_MAP_MIN_HEIGHT },
    // HoleMap's shared card sets a fixed height. A later height fills this slot
    // so the review map can flex without editing that shared style.
    mapFill: {
      flex: 1,
      width: '100%',
      height: '100%',
      minHeight: SHOT_REVIEW_MAP_MIN_HEIGHT,
    },
    chipRow: { flexGrow: 0, flexShrink: 0 },
    chips: { gap: 8 },
    chip: {
      minWidth: tapTarget,
      minHeight: tapTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      backgroundColor: colors.bgElevated,
      ...cardBorder(colors),
    },
    chipOn: { backgroundColor: colors.cream },
    chipText: { color: colors.cream, fontSize: 18, fontWeight: '800' },
    chipTextOn: { color: colors.bg },
    bottom: { flexGrow: 0, flexShrink: 1, gap: 12, minHeight: 0 },
    shotList: {
      flexGrow: 0,
      flexShrink: 1,
      maxHeight: SHOT_REVIEW_SHOT_LIST_MAX_HEIGHT,
    },
    shotListContent: { gap: 8 },
    nav: { flexDirection: 'row', gap: 8, flexShrink: 0 },
    navBtn: { flex: 1 },
    sheetPad: { gap: 12, padding: 16 },
    placeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    lieBlock: { gap: 8 },
    lieTitle: { color: colors.cream, fontSize: 16, fontWeight: '800' },
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
    reasonOn: { borderColor: colors.cream, backgroundColor: colors.accentWash },
    reasonText: { color: colors.cream, fontSize: 16, fontWeight: '800' },
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
