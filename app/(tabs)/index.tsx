import * as Device from 'expo-device';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { catalogEntryById } from '@/src/course/catalog';
import { applyCourseHydrateToLayout } from '@/src/course/hydrate';
import { layoutFromTee } from '@/src/course/layout';
import { backfillReadyFavoriteOverlays, downloadFavoriteForOffline } from '@/src/course/offlineFavorite';
import { prefetchCourseCardInBackground, rememberLayoutHoles } from '@/src/course/prefetch';
import type { CourseDetail, CourseSummary, TeeSet } from '@/src/course/types';
import { useDb } from '@/src/db/DbProvider';
import {
  attachCourseToRound,
  deleteRound,
  finishRound,
  getActiveRound,
  hasSeenBagCustomize,
  listClubs,
  markBagCustomizeSkipped,
  listHoles,
  listRounds,
  markBagCustomizeSeen,
  readSettingStore,
  startRound,
  type CourseLayoutSeed,
} from '@/src/db/repo';
import { formatLastPlayedChip, formatPaintSourceChip } from '@/src/domain/courseCard';
import { courseDataSourceToken } from '@/src/domain/courseDataSource';
import { planPaintMissBanner } from '@/src/domain/paintMiss';
import { canFinishBagCarrySetup, countTypedCarries } from '@/src/domain/bagCustomize';
import { canStartRound } from '@/src/domain/coursePick';
import { COPY, formatTeeMeta, SHOTTRAXX_BRAND } from '@/src/domain/playerCopy';
import { playHrefAfterRoundStart } from '@/src/domain/playNav';
import { endWatchRound } from '@/src/services/watchClub';
import {
  courseIsHardMiss,
  favoriteFromHistoryRound,
  historyStarInventsPaint,
  historyStarUsesFavoritesList,
  isFavorite,
  setFavorite,
} from '@/src/domain/favorites';
import { layoutForPlayedHoles, resolveCourseNumHoles } from '@/src/domain/nineByTwo';
import { greetingForHour, summarizeHomeRound, toParTone } from '@/src/domain/homeSummary';
import { formatRoundPaceLine, planLivePace } from '@/src/domain/livePace';
import { formatHistoryRow, historyDeletePrompt, pastRoundEditAnytime, pastRoundHoleHref } from '@/src/domain/roundHistory';
import { describeGpsSource } from '@/src/services/location';
import { BagCarryList, BagCustomizeActions } from '@/src/ui/BagCarryList';
import { BigButton } from '@/src/ui/BigButton';
import { takePendingCoursePick } from '@/src/course/pendingCoursePick';
import { courseAllowsFavorite } from '@/src/course/yardTestCourse';
import type { CoursePick } from '@/src/ui/CoursePicker';
import { EmptyPanel } from '@/src/ui/EmptyPanel';
import { HistorySwipeRow } from '@/src/ui/HistorySwipeRow';
import { Icon } from '@/src/ui/Icon';
import { QuickTile, StartTile } from '@/src/ui/HomeTiles';
import { GpsBanner } from '@/src/ui/GpsBanner';
import { PaintMissBanner } from '@/src/ui/PaintMissBanner';
import { Screen } from '@/src/ui/Screen';
import { FullSheet } from '@/src/ui/Sheet';
import { useColors } from '@/src/ui/ColorThemeProvider';
import { accentFill, cardBorder, glow, heroFill, tint } from '@/src/ui/surface';
import { tapTarget, type, type ColorPalette } from '@/src/ui/theme';
import { TopoRings } from '@/src/ui/TopoRings';
import { getCurrentFix } from '@/src/services/location';
import { setWatchCoursePickedHandler } from '@/src/services/watchNearby';
import { TabSwipe } from '@/src/ui/TabSwipe';

function playedLayout(
  layout: CourseLayoutSeed,
  course: CourseSummary,
  detail: CourseDetail | null,
  holeCount: 9 | 18,
): CourseLayoutSeed {
  return layoutForPlayedHoles(layout, {
    numHoles: resolveCourseNumHoles({
      detailHoleCount: detail?.holeCount,
      catalogHoleCount: catalogEntryById(course.id)?.holeCount ?? null,
    }),
    playHoleCount: holeCount,
  });
}

function loadLayout(
  course: CourseSummary,
  detail: CourseDetail | null,
  tee: TeeSet | null,
): CourseLayoutSeed {
  const resolved = detail;
  const base = resolved
    ? layoutFromTee(resolved, tee)
    : {
        apiId: course.id,
        name: course.name,
        location: course.location,
        teeName: tee?.name ?? null,
        teeRating: tee?.rating ?? null,
        teeSlope: tee?.slope ?? null,
        teeTotalYards: tee?.totalYards ?? null,
        holes: [],
      };
  const layout = applyCourseHydrateToLayout(base, {
    name: course.name,
    city: course.city,
    state: course.state,
    location: course.location ?? base.location ?? null,
    courseKey: course.id,
  });
  rememberLayoutHoles(layout);
  return {
    ...layout,
    city: course.city ?? null,
    state: course.state ?? null,
    courseDataSource: courseDataSourceToken(resolved?.paintResult ?? null),
  };
}

export default function HomeScreen() {
  const { db, revision, bump } = useDb();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [picked, setPicked] = useState<CourseSummary | null>(null);
  const [pickedTee, setPickedTee] = useState<TeeSet | null>(null);
  const [pickedDetail, setPickedDetail] = useState<CourseDetail | null>(null);
  const [starting, setStarting] = useState(false);
  const [openHistoryId, setOpenHistoryId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [simMessage, setSimMessage] = useState<string | null>(
    Device.isDevice === false ? COPY.simulator : null,
  );
  const rounds = useMemo(() => listRounds(db), [db, revision]);
  const active = useMemo(() => getActiveRound(db), [db, revision]);
  const activeHoles = useMemo(() => (active ? listHoles(db, active.id) : []), [db, revision, active]);
  const activeSummary = useMemo(
    () => (active ? summarizeHomeRound(activeHoles) : null),
    [active, activeHoles],
  );
  const greeting = useMemo(() => greetingForHour(new Date().getHours()), [revision]);
  const clubs = useMemo(() => listClubs(db), [db, revision]);
  const bagPromptOpen = useMemo(() => !hasSeenBagCustomize(db), [db, revision]);
  const typedCarryCount = useMemo(() => countTypedCarries(clubs), [clubs]);
  const canFinishBag = canFinishBagCarrySetup(typedCarryCount);
  const lastPlayedAtByCourse = useMemo(() => {
    const map: Record<string, string> = {};
    for (const round of rounds) {
      if (round.courseApiId && !map[round.courseApiId]) map[round.courseApiId] = round.startedAt;
      if (round.courseName && !map[round.courseName]) map[round.courseName] = round.startedAt;
    }
    return map;
  }, [rounds]);

  useEffect(() => {
    setWatchCoursePickedHandler((pick) => {
      setPicked(pick.course);
      setPickedDetail(pick.detail);
      setPickedTee(null);
    });
    return () => setWatchCoursePickedHandler(null);
  }, []);

  const skipBagSetup = () => {
    markBagCustomizeSkipped(db);
    bump();
  };

  const finishBagSetup = () => {
    if (!canFinishBag) return;
    markBagCustomizeSeen(db);
    bump();
  };

  const applyPickedCourse = (course: CourseSummary, holeCount: 9 | 18) => {
    const numHoles = resolveCourseNumHoles({
      detailHoleCount: pickedDetail?.holeCount,
      catalogHoleCount: catalogEntryById(course.id)?.holeCount ?? null,
    });
    const layout = playedLayout(loadLayout(course, pickedDetail, pickedTee), course, pickedDetail, holeCount);
    const round = startRound(db, holeCount, course.name, layout);
    bump();
    router.push(playHrefAfterRoundStart(round.id));
    prefetchCourseCardInBackground(layout, {
      holeCount,
      courseNumHoles: numHoles,
      applyLayout: (painted) => {
        attachCourseToRound(
          db,
          round.id,
          course.name,
          layoutForPlayedHoles(painted, { numHoles, playHoleCount: holeCount }),
        );
        bump();
      },
    });
  };

  const commitPick = async (pick: CoursePick) => {
    const needsTee = (pick.detail?.tees.length ?? 0) > 0 && !pick.tee;
    setPicked(pick.course);
    setPickedTee(pick.tee);
    setPickedDetail(pick.detail);
    if (needsTee) return;
    if (active) {
      setStarting(true);
      try {
        const holeCount = active.holeCount === 9 ? 9 : 18;
        const numHoles = resolveCourseNumHoles({
          detailHoleCount: pick.detail?.holeCount,
          catalogHoleCount: catalogEntryById(pick.course.id)?.holeCount ?? null,
        });
        const layout = playedLayout(loadLayout(pick.course, pick.detail, pick.tee), pick.course, pick.detail, holeCount);
        attachCourseToRound(db, active.id, pick.course.name, layout);
        bump();
        router.push(playHrefAfterRoundStart(active.id));
        prefetchCourseCardInBackground(layout, {
          holeCount,
          courseNumHoles: numHoles,
          applyLayout: (painted) => {
            attachCourseToRound(
              db,
              active.id,
              pick.course.name,
              layoutForPlayedHoles(painted, { numHoles, playHoleCount: holeCount }),
            );
            bump();
          },
        });
      } catch (err) {
        Alert.alert('Couldn’t attach course', err instanceof Error ? err.message : 'Try again.');
      } finally {
        setStarting(false);
      }
    }
  };

  const teeCount = picked ? (pickedDetail == null ? null : pickedDetail.tees.length) : 0;
  const needsTee = Boolean(picked) && (teeCount == null || (teeCount > 0 && !pickedTee));
  const canStart = canStartRound({ picked, teeCount, pickedTee });

  const onStart = (holeCount: 9 | 18) => {
    if (active) {
      router.push(playHrefAfterRoundStart(active.id));
      return;
    }
    if (!canStart || !picked) return;
    setStarting(true);
    try {
      applyPickedCourse(picked, holeCount);
    } catch (err) {
      Alert.alert('Couldn’t start round', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setStarting(false);
    }
  };

  const favoriteStore = useMemo(() => readSettingStore(db), [db]);

  const starHistoryRound = (round: (typeof rounds)[number]) => {
    if (!historyStarUsesFavoritesList() || historyStarInventsPaint()) return;
    const catalog = round.courseApiId ? catalogEntryById(round.courseApiId) : null;
    const favorite = favoriteFromHistoryRound({
      courseApiId: round.courseApiId,
      courseName: round.courseName,
      courseLat: round.courseLat,
      courseLng: round.courseLng,
      city: catalog?.city ?? null,
      state: catalog?.state ?? null,
      country: catalog?.country ?? null,
    });
    if (!favorite || !courseAllowsFavorite(favorite.id)) return;
    const starred = isFavorite(favoriteStore, favorite.id);
    setFavorite(favoriteStore, favorite, !starred);
    bump();
    if (starred) return;
    void downloadFavoriteForOffline(favorite, favoriteStore, { onStatus: () => bump() });
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (Device.isDevice === false) {
        const fix = await getCurrentFix().catch(() => null);
        setSimMessage(fix ? describeGpsSource(fix) : COPY.simulator);
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  const commitRef = useRef(commitPick);
  commitRef.current = commitPick;
  useFocusEffect(
    useCallback(() => {
      const pending = takePendingCoursePick();
      if (pending) void commitRef.current(pending);
    }, []),
  );
  useFocusEffect(
    useCallback(() => {
      void backfillReadyFavoriteOverlays(favoriteStore);
    }, [favoriteStore]),
  );
  const pickedHardMiss = picked
    ? courseIsHardMiss({
        courseKey: picked.id,
        courseApiId: picked.id,
        name: picked.name,
        city: picked.city,
        state: picked.state,
        location: picked.location,
      })
    : false;
  const paintBanner = picked
    ? planPaintMissBanner({
        paintResult: pickedDetail?.paintResult,
        hardMiss: pickedHardMiss,
        unresolved: pickedDetail == null,
      })
    : null;
  const paintSourceLabel =
    formatPaintSourceChip(pickedDetail?.paintResult) ??
    (paintBanner ? formatPaintSourceChip({ ok: false, source: null, fromCache: false }) : null);
  const teeLabel = pickedTee
    ? formatTeeMeta({
        name: pickedTee.name,
        rating: pickedTee.rating,
        slope: pickedTee.slope,
        totalYards: pickedTee.totalYards,
      })
    : null;

  const lastPlayedChip = picked
    ? formatLastPlayedChip(lastPlayedAtByCourse[picked.id] ?? lastPlayedAtByCourse[picked.name])
    : null;
  const startLabel = (holeCount: 9 | 18) =>
    picked
      ? `Start ${holeCount} at ${picked.name}${pickedTee ? ` · ${pickedTee.name}` : ''}`
      : holeCount === 18
        ? COPY.start18
        : COPY.start9;

  return (
    <TabSwipe tab="index">
      <Screen edges={['bottom']} refreshing={refreshing} onRefresh={() => void onRefresh()}>
        <View style={styles.homeBar}>
          <View style={styles.brand}>
            <View style={[styles.mark, accentFill(colors), glow(colors)]}>
              <Icon name="flag.fill" color={colors.onAccent} size={19} glyph="⚑" />
            </View>
            <Text style={styles.title}>{SHOTTRAXX_BRAND}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={COPY.menu}
            onPress={() => router.push('/settings')}
            style={({ pressed }) => [styles.menuButton, pressed && styles.pressed]}>
            <Icon name="gearshape.fill" color={colors.cream} size={22} glyph="☰" />
          </Pressable>
        </View>
        {active ? null : (
          <View style={styles.greeting}>
            <Text style={styles.kicker}>{greeting}</Text>
            <Text style={styles.h1}>{COPY.homeHeroTitle}</Text>
          </View>
        )}

        <FullSheet
          visible={bagPromptOpen}
          title={COPY.bagCustomizeTitle}
          onClose={skipBagSetup}>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
            <Text style={styles.lede}>{COPY.bagCustomizeLede}</Text>
            <BagCustomizeActions
              onSkip={skipBagSetup}
              onDone={finishBagSetup}
              doneDisabled={!canFinishBag}
            />
            <BagCarryList db={db} clubs={clubs} onChange={bump} />
          </ScrollView>
        </FullSheet>

        {simMessage ? <GpsBanner message={simMessage} /> : null}

        {active && activeSummary ? (
          <View style={[styles.hero, heroFill(colors)]}>
            {colors.flat ? null : <TopoRings color={colors.heroText} />}
            <View style={styles.liveTag}>
              <View style={styles.liveDot} />
              <Text style={styles.liveTagText}>{COPY.roundInProgress.toUpperCase()}</Text>
            </View>
            <View>
              <Text style={styles.heroTitle}>{active.courseName ?? 'Round'}</Text>
              <Text style={styles.heroMeta}>
                {active.teeName
                  ? `${formatTeeMeta({
                      name: active.teeName,
                      rating: active.teeRating,
                      slope: active.teeSlope,
                      totalYards: active.teeTotalYards,
                    })} · `
                  : ''}
                {`${active.holeCount} holes`}
              </Text>
            </View>
            <View style={styles.liveBig}>
              <View>
                <Text style={styles.heroKicker}>HOLE</Text>
                <Text style={styles.liveHole}>{activeSummary.currentHole ?? '—'}</Text>
              </View>
              <View style={styles.liveStats}>
                <View style={styles.liveStat}>
                  <Text style={styles.liveStatValue}>{activeSummary.toParLabel ?? '—'}</Text>
                  <Text style={styles.heroMeta}>{`Thru ${activeSummary.thru}`}</Text>
                </View>
                <View style={styles.liveStat}>
                  <Text style={styles.liveStatValue}>{activeSummary.putts}</Text>
                  <Text style={styles.heroMeta}>Putts</Text>
                </View>
              </View>
            </View>
            <View style={styles.progress}>
              {Array.from({ length: active.holeCount }, (_, i) => {
                const number = i + 1;
                const done = activeHoles.some((h) => h.number === number && h.score != null);
                const current = number === activeSummary.currentHole && !done;
                return (
                  <View
                    key={number}
                    style={[styles.progressSeg, done && styles.progressDone, current && styles.progressCurrent]}
                  />
                );
              })}
            </View>
            <View style={styles.liveActions}>
              <BigButton
                label={COPY.continueRound}
                style={{ flex: 1.6 }}
                onPress={() => router.push(playHrefAfterRoundStart(active.id))}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Finish round"
                onPress={() => {
                  finishRound(db, active.id);
                  endWatchRound(active.id);
                  bump();
                  router.push(`/round/${active.id}/summary`);
                }}
                style={({ pressed }) => [styles.glassButton, pressed && styles.pressed]}>
                <Text style={styles.glassButtonText}>Finish</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={[styles.hero, heroFill(colors)]}>
            {colors.flat ? null : <TopoRings color={colors.heroText} />}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={COPY.courseNamePlaceholder}
              onPress={() => router.push('/search')}
              style={({ pressed }) => [styles.searchPill, pressed && styles.pressed]}>
              <Icon name="magnifyingglass" color={colors.heroText} size={18} glyph="⌕" />
              <Text style={styles.searchPillText} numberOfLines={1}>
                {COPY.courseNamePlaceholder}
              </Text>
            </Pressable>
            <View style={styles.heroRow}>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/search')}
                style={({ pressed }) => [
                  styles.nearPill,
                  accentFill(colors),
                  !pressed && glow(colors),
                  pressed && styles.pressed,
                ]}>
                <Icon name="location.fill" color={colors.onAccent} size={15} glyph="◉" />
                <Text style={styles.nearPillText}>{COPY.coursesNearYou}</Text>
              </Pressable>
              <Text style={styles.heroMeta}>Pull to refresh</Text>
            </View>
          </View>
        )}

        {picked ? (
          <View style={styles.card}>
            <View style={styles.courseRow}>
              <View style={styles.thumb}>
                <Icon name="flag.fill" color={colors.lime} size={22} glyph="⚑" />
              </View>
              <View style={styles.courseText}>
                <Text style={styles.cardTitle}>{picked.name}</Text>
                {teeLabel || needsTee ? (
                  <Text style={styles.cardMeta}>{teeLabel ? teeLabel : COPY.pickTee}</Text>
                ) : null}
                {paintSourceLabel || lastPlayedChip ? (
                  <View style={styles.chips}>
                    {paintSourceLabel ? (
                      <Text testID="paint-source-chip" style={[styles.chip, styles.chipAccent]}>
                        {paintSourceLabel}
                      </Text>
                    ) : null}
                    {lastPlayedChip ? <Text style={styles.chip}>{lastPlayedChip}</Text> : null}
                  </View>
                ) : null}
              </View>
            </View>
            <PaintMissBanner notice={paintBanner} />
          </View>
        ) : null}

        {active ? null : (
          <View style={styles.starts}>
            <StartTile
              holes={18}
              primary
              accessibilityLabel={startLabel(18)}
              caption={pickedTee ? pickedTee.name : undefined}
              disabled={starting || !canStart}
              onPress={() => onStart(18)}
            />
            <StartTile
              holes={9}
              accessibilityLabel={startLabel(9)}
              disabled={starting || !canStart}
              onPress={() => onStart(9)}
            />
          </View>
        )}

        <View style={styles.quick}>
          <QuickTile
            icon="chart.bar.fill"
            glyph="▮"
            color={colors.lime}
            label={COPY.nerdOut}
            onPress={() =>
              router.push({
                pathname: '/nerd-out',
                params: active ? { roundId: active.id } : undefined,
              })
            }
          />
          <QuickTile
            icon="dot.radiowaves.left.and.right"
            glyph="◎"
            color={colors.accent2}
            label="Live board"
            accessibilityLabel={COPY.liveBoardWatch}
            onPress={() => router.push('/board')}
          />
          <QuickTile
            icon="bag.fill"
            glyph="⛳"
            color={colors.amber}
            label="My bag"
            onPress={() => router.push('/bag')}
          />
        </View>

        <Text style={styles.section}>{COPY.roundHistory}</Text>
        {rounds.length === 0 ? (
          <EmptyPanel title={COPY.noRounds} hint={COPY.firstRoundHint} />
        ) : (
          rounds.map((round) => {
            const holes = listHoles(db, round.id);
            const scored = holes.filter((h) => h.score != null);
            const total = scored.reduce((sum, h) => sum + (h.score ?? 0), 0);
            const summary = summarizeHomeRound(holes);
            const tone = toParTone(summary.toPar);
            const toneColor =
              tone === 'good'
                ? colors.good
                : tone === 'warn'
                  ? colors.amber
                  : tone === 'bad'
                    ? colors.red
                    : colors.muted;
            const open = round.finishedAt == null;
            const paceLine = open
              ? null
              : formatRoundPaceLine(
                  planLivePace({
                    holes: holes.map((h) => ({
                      hole: h.number,
                      score: h.score,
                      par: h.par,
                      startedAt: h.startedAt,
                      completedAt: h.completedAt,
                    })),
                    nowMs: Date.now(),
                    finished: true,
                  }),
                );
            const row = formatHistoryRow({
              startedAt: round.startedAt,
              courseName: round.courseName,
              teeName: round.teeName,
              score: scored.length ? total : null,
              test: round.isTest,
            });
            const prompt = historyDeletePrompt();
            const catalog = round.courseApiId ? catalogEntryById(round.courseApiId) : null;
            const favorite = favoriteFromHistoryRound({
              courseApiId: round.courseApiId,
              courseName: round.courseName,
              courseLat: round.courseLat,
              courseLng: round.courseLng,
              city: catalog?.city ?? null,
              state: catalog?.state ?? null,
              country: catalog?.country ?? null,
            });
            const starred = favorite ? isFavorite(favoriteStore, favorite.id) : false;
            return (
              <HistorySwipeRow
                key={round.id}
                open={openHistoryId === round.id}
                onOpen={() => setOpenHistoryId(round.id)}
                onClose={() => setOpenHistoryId((current) => (current === round.id ? null : current))}
                onPress={() =>
                  router.push(open ? playHrefAfterRoundStart(round.id) : `/round/${round.id}/summary`)
                }
                onEdit={() => {
                  if (!pastRoundEditAnytime()) return;
                  setOpenHistoryId(null);
                  router.push(pastRoundHoleHref(round.id, 1));
                }}
                onDelete={() => {
                  if (!prompt.cancelIsDefault) return;
                  Alert.alert(prompt.title, prompt.body, [
                    { text: COPY.cancel, style: 'cancel' },
                    {
                      text: COPY.deleteRound,
                      style: 'destructive',
                      onPress: () => {
                        const live = round.finishedAt == null;
                        deleteRound(db, round.id);
                        if (live) endWatchRound(round.id);
                        setOpenHistoryId(null);
                        bump();
                      },
                    },
                  ]);
                }}
                rowStyle={styles.row}>
                <View
                  style={[
                    styles.badge,
                    { borderColor: tint(toneColor, 0.55), backgroundColor: tint(toneColor, 0.16) },
                  ]}>
                  <Text style={[styles.badgeText, { color: toneColor }]}>{summary.toParLabel ?? '—'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {row.courseName}
                  </Text>
                  <Text style={styles.cardMeta}>
                    {row.date} · {row.tees}
                    {row.testLabel ? ` · ${row.testLabel}` : ''}
                    {open ? ' · in progress' : ''}
                    {paceLine ? ` · ${paceLine}` : ''}
                  </Text>
                  <Text style={styles.relative}>{row.relative}</Text>
                </View>
                <View style={styles.scoreCol}>
                  <Text style={styles.score}>{row.score}</Text>
                  {favorite && courseAllowsFavorite(favorite.id) ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={starred ? COPY.unfavorite : COPY.favorite}
                      onPress={() => starHistoryRound(round)}
                      hitSlop={10}
                      style={styles.star}>
                      <Text style={[styles.starText, !starred && styles.starOff]}>{starred ? '★' : '☆'}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </HistorySwipeRow>
            );
          })
        )}
      </Screen>
    </TabSwipe>
  );
}

function makeStyles(colors: ColorPalette) {
  return StyleSheet.create({
    homeBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    brand: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
    mark: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    title: { color: colors.cream, fontSize: 22, fontWeight: '900', letterSpacing: -0.4 },
    menuButton: {
      minWidth: tapTarget,
      minHeight: tapTarget,
      borderRadius: 20,
      backgroundColor: colors.bgElevated,
      ...cardBorder(colors),
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: { opacity: 0.9, transform: [{ scale: 0.97 }] },
    greeting: { gap: 4, marginTop: 4 },
    kicker: {
      color: colors.muted,
      fontSize: type.kicker,
      fontWeight: '800',
      letterSpacing: 1.6,
      textTransform: 'uppercase',
    },
    h1: { color: colors.cream, fontSize: 30, fontWeight: '900', letterSpacing: -0.8 },
    lede: { color: colors.muted, fontSize: type.body, lineHeight: 22 },
    hero: { borderRadius: 26, padding: 18, gap: 12, overflow: 'hidden' },
    heroTitle: { color: colors.heroText, fontSize: 20, fontWeight: '800' },
    heroMeta: { color: colors.heroText, opacity: 0.75, fontSize: type.meta },
    heroKicker: {
      color: colors.heroText,
      opacity: 0.75,
      fontSize: type.kicker,
      fontWeight: '800',
      letterSpacing: 1.4,
    },
    searchPill: {
      minHeight: 54,
      borderRadius: 16,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.flat ? colors.bg : 'rgba(0,0,0,0.22)',
      borderWidth: colors.flat ? 2 : 1,
      borderColor: colors.flat ? colors.line : 'rgba(255,255,255,0.16)',
    },
    searchPillText: { color: colors.heroText, opacity: 0.85, fontSize: 16, fontWeight: '600', flex: 1 },
    heroRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    nearPill: {
      minHeight: 44,
      borderRadius: 999,
      paddingLeft: 12,
      paddingRight: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    nearPillText: { color: colors.onAccent, fontSize: 15, fontWeight: '800' },
    liveTag: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    liveDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.lime,
      borderWidth: 3,
      borderColor: tint(colors.lime, 0.35),
    },
    liveTagText: { color: colors.heroText, fontSize: type.kicker, fontWeight: '800', letterSpacing: 1.6 },
    liveBig: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
    liveHole: { color: colors.heroText, fontSize: 56, fontWeight: '900', letterSpacing: -2, lineHeight: 58 },
    liveStats: { flexDirection: 'row', gap: 18 },
    liveStat: { alignItems: 'flex-end' },
    liveStatValue: { color: colors.heroText, fontSize: 26, fontWeight: '900' },
    progress: { flexDirection: 'row', gap: 3 },
    progressSeg: {
      flex: 1,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.flat ? colors.muted : 'rgba(255,255,255,0.2)',
      opacity: colors.flat ? 0.35 : 1,
    },
    progressDone: { backgroundColor: colors.lime, opacity: 1 },
    progressCurrent: { backgroundColor: colors.heroText, opacity: 1 },
    liveActions: { flexDirection: 'row', gap: 10 },
    glassButton: {
      flex: 1,
      minHeight: tapTarget,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.flat ? colors.bg : 'rgba(255,255,255,0.12)',
      borderWidth: colors.flat ? 2 : 1,
      borderColor: colors.flat ? colors.line : 'rgba(255,255,255,0.22)',
    },
    glassButtonText: { color: colors.heroText, fontSize: 18, fontWeight: '800' },
    card: {
      backgroundColor: colors.bgElevated,
      borderRadius: 22,
      padding: 14,
      gap: 10,
      ...cardBorder(colors),
    },
    courseRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    courseText: { flex: 1, gap: 4 },
    thumb: {
      width: 54,
      height: 54,
      borderRadius: 16,
      backgroundColor: colors.accentWash,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardTitle: { color: colors.cream, fontSize: 18, fontWeight: '800' },
    cardMeta: { color: colors.muted, fontSize: type.meta },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
    chip: {
      alignSelf: 'flex-start',
      color: colors.cream,
      fontSize: type.tiny,
      fontWeight: '800',
      backgroundColor: colors.accentWash,
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 4,
      overflow: 'hidden',
    },
    chipAccent: { color: colors.flat ? colors.lime : colors.cream, backgroundColor: tint(colors.lime, 0.22) },
    starts: { flexDirection: 'row', gap: 12 },
    quick: { flexDirection: 'row', gap: 10 },
    section: { color: colors.cream, fontSize: 19, fontWeight: '800', letterSpacing: -0.3, marginTop: 12 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.bgElevated,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 18,
      ...cardBorder(colors),
      minHeight: tapTarget + 8,
      gap: 12,
    },
    badge: {
      width: 50,
      height: 50,
      borderRadius: 25,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: { fontSize: 15, fontWeight: '900' },
    rowTitle: { color: colors.cream, fontSize: 16, fontWeight: '800' },
    relative: { color: colors.muted, fontSize: type.tiny, fontWeight: '700', marginTop: 2 },
    scoreCol: { alignItems: 'flex-end', gap: 2 },
    score: { color: colors.cream, fontSize: 26, fontWeight: '900', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
    star: { minWidth: 32, minHeight: 28, alignItems: 'flex-end', justifyContent: 'center' },
    starText: { color: colors.lime, fontSize: 20, fontWeight: '900' },
    starOff: { color: colors.muted },
  });
}
