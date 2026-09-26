import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { courseAllowsFavorite } from '@/src/course/yardTestCourse';
import { isGolfCoursesApiConfigured } from '@/src/course/config';
import { getCourseDataClient } from '@/src/course/client';
import { formatTeeHoleYards, formatTeeMeta } from '@/src/course/layout';
import type { CourseDetail, CourseSummary, TeeSet } from '@/src/course/types';
import type { GpsFix } from '@/src/domain/types';
import { COPY, courseListHeading } from '@/src/domain/playerCopy';
import { courseSearchResponseIsCurrent, nextCourseSearchRequest } from '@/src/domain/courseSearchRequest';
import { formatPaintSourceChip, planCourseCard, type PaintResultWinner } from '@/src/domain/courseCard';
import { planPaintMissBanner } from '@/src/domain/paintMiss';
import { deferCourseSearchLayout } from '@/src/domain/courseSearchLayout';
import {
  planCourseList,
  planCourseSearchParams,
  planNearbyCourseSearch,
  showNearbyCourseList,
} from '@/src/domain/coursePick';
import { type CourseDistanceUnit } from '@/src/domain/courseDistance';
import { useDb } from '@/src/db/DbProvider';
import { getThunderbirdPinSheet, readSettingStore, setThunderbirdPinSheet } from '@/src/db/repo';
import { holesHaveTeeGreenPaint, requestThisCourseVisible } from '@/src/domain/courseRequest';
import { courseIsHardMiss, favoriteFromSummary, isFavorite, listFavorites, setFavorite } from '@/src/domain/favorites';
import { courseNeedsPinSheets } from '@/src/domain/missCard';
import type { LatLng } from '@/src/domain/latLng';
import { parseUsZip } from '@/src/domain/zipGeocode';
import { getCurrentFix } from '@/src/services/location';
import { geocodeUsZip } from '@/src/services/geocodeZip';
import { BigButton } from './BigButton';
import { PaintMissBanner } from './PaintMissBanner';
import { EmptyPanel } from './EmptyPanel';
import { useColors } from './ColorThemeProvider';
import { ThunderbirdPinSheetPicker } from './ThunderbirdPinSheetPicker';
import { thumbZoneMin, type, type ColorPalette } from './theme';

export type CoursePick = {
  course: CourseSummary;
  detail: CourseDetail | null;
  tee: TeeSet | null;
};

type Props = {
  selected: CourseSummary | null;
  selectedTee: TeeSet | null;
  onSelect: (pick: CoursePick | null) => void;
  attachMode?: boolean;
  autoFind?: boolean;
  query?: string;
  onQueryChange?: (query: string) => void;
  onRefreshReady?: (refresh: () => Promise<void>) => void;
  courseDistanceUnit?: CourseDistanceUnit;
  lastPlayedAtByCourse?: Record<string, string | null | undefined>;
};

function placeLine(course: CourseSummary): string {
  return [course.city, course.state].filter(Boolean).join(', ') || course.club || 'Course';
}

export function CoursePicker({
  selected,
  selectedTee,
  onSelect,
  autoFind = true,
  query = '',
  onQueryChange,
  onRefreshReady,
  courseDistanceUnit = 'mi',
  lastPlayedAtByCourse,
}: Props) {
  const { db, revision, bump } = useDb();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const configured = isGolfCoursesApiConfigured();
  const pinSheet = useMemo(() => getThunderbirdPinSheet(db), [db, revision]);
  const store = useMemo(() => readSettingStore(db), [db]);
  const favorites = useMemo(() => listFavorites(store), [store, revision]);
  const [busy, setBusy] = useState(false);
  const [teeBusy, setTeeBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<CourseSummary[] | null>(null);
  const [listPhoneFix, setListPhoneFix] = useState<GpsFix | null>(null);
  const [listFrom, setListFrom] = useState<LatLng | null>(null);
  const [listNowMs, setListNowMs] = useState<number | null>(null);
  const [tees, setTees] = useState<TeeSet[] | null>(null);
  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [paintById, setPaintById] = useState<Record<string, PaintResultWinner>>({});
  const searchGen = useRef(0);
  const latestQueryRef = useRef(query);
  const searchAbort = useRef<AbortController | null>(null);
  latestQueryRef.current = query;

  const onFind = useCallback(async () => {
    const startedQuery = query;
    const requestId = nextCourseSearchRequest(searchGen.current);
    searchGen.current = requestId;
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    const signal = controller.signal;
    const apply = (gpsNearby = false) =>
      courseSearchResponseIsCurrent({
        requestId,
        latestRequestId: searchGen.current,
        startedQuery,
        latestQuery: latestQueryRef.current,
        gpsNearby,
      }) && !signal.aborted;

    if (!apply()) return;
    if (planNearbyCourseSearch({ query, phoneFix: null, nowMs: 0 }).mode === 'too_short') {
      if (apply()) setBusy(false);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const zipQuery = parseUsZip(query);
      const rawFix = zipQuery ? null : await getCurrentFix().catch(() => null);
      if (!apply()) return;
      const nowMs = Date.now();
      const plan = planNearbyCourseSearch({ query, phoneFix: rawFix, nowMs });
      if (plan.mode === 'too_short') {
        if (apply()) setBusy(false);
        return;
      }
      const client = getCourseDataClient();
      const nearbyCourses = (from: LatLng) => client.nearbyCourses(from, undefined, signal);
      const searchCourses = (q: string) => client.searchCourses(q, signal);
      const gpsNearby = plan.mode === 'nearby';
      if (!apply(gpsNearby)) return;
      setListNowMs(nowMs);
      if (plan.mode === 'needs_location') {
        if (!apply()) return;
        setListPhoneFix(rawFix);
        setListFrom(null);
        deferCourseSearchLayout(() => {
          if (!apply()) return;
          setResults([]);
        });
        setError(COPY.nearbyNeedsLocation);
        return;
      }
      if (plan.mode === 'zip') {
        const geo = await geocodeUsZip(plan.zip);
        if (!apply()) return;
        if (!geo.ok) {
          setListPhoneFix(null);
          setListFrom(null);
          setResults(null);
          setError(COPY.zipGeocodeMiss);
          return;
        }
        const found = await nearbyCourses(geo.from);
        if (!apply()) return;
        const listed = planCourseList({
          courses: found,
          lastPlayedAtByCourse,
          from: geo.from,
          nowMs,
        });
        if (!apply()) return;
        setListPhoneFix(null);
        setListFrom(geo.from);
        deferCourseSearchLayout(() => {
          if (!apply()) return;
          setResults(listed);
        });
        if (listed.length === 0) {
          setError(COPY.nearbyEmpty);
        }
        return;
      }
      if (!apply(gpsNearby)) return;
      setListPhoneFix(rawFix);
      setListFrom(null);
      const found =
        plan.mode === 'search'
          ? await searchCourses(plan.q)
          : await nearbyCourses(plan.from);
      if (!apply(gpsNearby)) return;
      const listed = planCourseList({
        courses: found,
        lastPlayedAtByCourse,
        phoneFix: rawFix,
        nowMs,
      });
      if (!apply(gpsNearby)) return;
      deferCourseSearchLayout(() => {
        if (!apply(gpsNearby)) return;
        setResults(listed);
      });
      if (listed.length === 0) {
        setError(COPY.nearbyEmpty);
      }
    } catch (err) {
      if (!apply()) return;
      deferCourseSearchLayout(() => {
        if (!apply()) return;
        setResults([]);
      });
      setError(err instanceof Error ? err.message : 'Couldn’t find courses.');
    } finally {
      if (apply()) setBusy(false);
    }
  }, [query, lastPlayedAtByCourse]);

  useEffect(() => {
    onRefreshReady?.(onFind);
  }, [onFind, onRefreshReady]);

  useEffect(() => {
    return () => {
      searchAbort.current?.abort();
      searchGen.current = nextCourseSearchRequest(searchGen.current);
    };
  }, []);

  useEffect(() => {
    if (!autoFind) return;
    const delay = planCourseSearchParams(query) ? 280 : 0;
    const timer = setTimeout(() => {
      void onFind();
    }, delay);
    return () => clearTimeout(timer);
  }, [autoFind, onFind, query]);

  const toggleStar = (course: CourseSummary) => {
    if (!courseAllowsFavorite(course.id)) return;
    const favorite = favoriteFromSummary(course);
    if (!favorite) return;
    setFavorite(store, favorite, !isFavorite(store, course.id));
    bump();
  };

  const openRequest = (course?: CourseSummary | null) => {
    router.push({
      pathname: '/request-course',
      params: {
        name: course?.name ?? query.trim(),
        city: course?.city ?? '',
        courseId: course?.id ?? '',
      },
    });
  };

  const pickCourse = async (course: CourseSummary) => {
    setTeeBusy(true);
    setError(null);
    setTees(null);
    setDetail(null);
    try {
      const next = await getCourseDataClient().getCourse(course.id);
      if (next?.paintResult) {
        setPaintById((current) => ({ ...current, [course.id]: next.paintResult! }));
      }
      const nextTees = next?.tees ?? [];
      deferCourseSearchLayout(() => {
        setDetail(next);
        setTees(nextTees);
        if (nextTees.length === 1) {
          onSelect({ course, detail: next, tee: nextTees[0] });
        } else {
          onSelect({ course, detail: next, tee: null });
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t load that course.');
      deferCourseSearchLayout(() => onSelect({ course, detail: null, tee: null }));
    } finally {
      setTeeBusy(false);
    }
  };

  const selectedHoles = detail?.holes ?? (selectedTee ? selectedTee.holes : null);
  const selectedHasPaint = holesHaveTeeGreenPaint(selectedHoles);
  const showSelectedRequest = requestThisCourseVisible({
    course: selected
      ? {
          courseKey: selected.id,
          courseApiId: selected.id,
          name: selected.name,
          city: selected.city,
          state: selected.state,
          location: selected.location,
        }
      : null,
    hasTeeGreenPaint: selectedHasPaint,
    paintKnown: selectedHoles != null,
  });

  const selectedHardMiss = selected
    ? courseIsHardMiss({
        courseKey: selected.id,
        courseApiId: selected.id,
        name: selected.name,
        city: selected.city,
        state: selected.state,
        location: selected.location,
      })
    : false;
  const selectedPaintResult = detail?.paintResult ?? (selected ? paintById[selected.id] ?? null : null);
  const selectedBanner = selected
    ? planPaintMissBanner({
        paintResult: selectedPaintResult,
        hardMiss: selectedHardMiss,
        unresolved: !teeBusy && detail == null && (selectedPaintResult?.ok === false || error != null),
      })
    : null;
  const selectedPaint = formatPaintSourceChip(selectedPaintResult) ??
    (selectedBanner ? formatPaintSourceChip({ ok: false, source: null, fromCache: false }) : null);
  const zipMiss = error === COPY.zipGeocodeMiss;
  const emptyNearby = results != null && results.length === 0 && !busy && !zipMiss;
  const needsLocation = error === COPY.nearbyNeedsLocation;
  const showList = showNearbyCourseList(selected);
  const listed = planCourseList({
    courses: results ?? [],
    lastPlayedAtByCourse,
    phoneFix: listPhoneFix,
    from: listFrom,
    nowMs: listNowMs ?? undefined,
  });

  return (
    <View style={styles.box}>
      {showList ? (
        <>
          <TextInput
            placeholder={COPY.courseNamePlaceholder}
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={onQueryChange}
            autoCapitalize="words"
            autoCorrect={false}
            style={styles.search}
          />
          {query.trim() ? (
            <BigButton
              label={COPY.clearSearch}
              variant="ghost"
              onPress={() => onQueryChange?.('')}
            />
          ) : null}
          <Text style={styles.label}>{query.trim() ? courseListHeading(query) : COPY.nearbyHint}</Text>
          {!configured && emptyNearby ? <Text style={styles.meta}>{COPY.nearbyUnavailable}</Text> : null}
          {error && !emptyNearby ? <Text style={styles.warn}>{error}</Text> : null}
          {zipMiss ? <Text style={styles.meta}>{COPY.zipGeocodeMissHint}</Text> : null}
          {busy ? (
            <Text style={styles.meta}>{query.trim() ? COPY.searchBusy : COPY.nearbyBusy}</Text>
          ) : null}
          {emptyNearby ? (
            <EmptyPanel
              title={needsLocation ? COPY.nearbyNeedsLocation : COPY.nearbyEmpty}
              hint={COPY.nearbyEmptyHint}
            />
          ) : null}
          {emptyNearby && showSelectedRequest ? (
            <BigButton label={COPY.requestThisCourse} variant="secondary" onPress={() => openRequest(null)} />
          ) : null}
        </>
      ) : selected ? (
        <View style={styles.selected}>
          <Text style={styles.selectedName}>{selected.name}</Text>
          {selectedPaint ? (
            <Text testID="paint-source-chip" style={styles.paintSource}>
              {selectedPaint}
            </Text>
          ) : null}
          <PaintMissBanner notice={selectedBanner} />
          <Text style={styles.meta}>{placeLine(selected)}</Text>
          <View style={styles.actions}>
            {courseAllowsFavorite(selected.id) ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isFavorite(store, selected.id) ? COPY.unfavorite : COPY.favorite}
                onPress={() => toggleStar(selected)}
                style={styles.star}>
                <Text style={styles.starText}>{isFavorite(store, selected.id) ? '★' : '☆'}</Text>
              </Pressable>
            ) : null}
            {showSelectedRequest ? (
              <Pressable accessibilityRole="button" onPress={() => openRequest(selected)} style={styles.link}>
                <Text style={styles.linkText}>{COPY.requestThisCourse}</Text>
              </Pressable>
            ) : null}
          </View>
          {courseNeedsPinSheets({
            courseApiId: selected.id,
            name: selected.name,
            city: selected.city,
            state: selected.state,
            location: selected.location,
          }) ? (
            <>
              <Text style={styles.warn}>{COPY.hardMissNeedPins}</Text>
              <ThunderbirdPinSheetPicker
                selected={pinSheet}
                onSelect={(sheet) => {
                  setThunderbirdPinSheet(db, sheet);
                  bump();
                }}
              />
            </>
          ) : null}
          {selectedTee ? (
            <>
              <Text style={styles.meta}>{formatTeeMeta(selectedTee)}</Text>
              {formatTeeHoleYards(selectedTee.holes) ? (
                <Text style={styles.meta}>{formatTeeHoleYards(selectedTee.holes)}</Text>
              ) : null}
            </>
          ) : null}
          <BigButton
            label={COPY.clearCourse}
            variant="ghost"
            onPress={() => {
              setTees(null);
              setDetail(null);
              onSelect(null);
            }}
          />
          {error ? <Text style={styles.warn}>{error}</Text> : null}
        </View>
      ) : null}
      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {showList
          ? listed.map((course) => {
              const rowHardMiss = courseIsHardMiss({
                courseKey: course.id,
                courseApiId: course.id,
                name: course.name,
                city: course.city,
                state: course.state,
                location: course.location,
              });
              const rowPaint =
                paintById[course.id] ??
                (rowHardMiss ? { ok: false as const, source: null, fromCache: false } : null);
              const rowBanner = planPaintMissBanner({
                paintResult: rowPaint,
                hardMiss: rowHardMiss,
              });
              const card = planCourseCard({
                name: course.name,
                distanceMeters: course.distanceMeters,
                unit: courseDistanceUnit,
                lastPlayedAt: lastPlayedAtByCourse?.[course.id] ?? lastPlayedAtByCourse?.[course.name],
                paintResult: rowPaint,
              });
              const starred = favorites.some((row) => row.id === course.id);
              const showRequest = requestThisCourseVisible({
                course: {
                  courseKey: course.id,
                  courseApiId: course.id,
                  name: course.name,
                  city: course.city,
                  state: course.state,
                  location: course.location,
                },
                hasTeeGreenPaint: false,
                paintKnown: false,
              });
              return (
                <View key={course.id} style={styles.row}>
                  <Pressable onPress={() => void pickCourse(course)}>
                    <Text style={styles.rowTitle}>{card.name}</Text>
                    {card.paintSource ? (
                      <Text testID="paint-source-chip" style={styles.paintSource}>
                        {card.paintSource}
                      </Text>
                    ) : null}
                    <PaintMissBanner notice={rowBanner} />
                    <View style={styles.chips}>
                      {card.distance ? <Text style={styles.chip}>{card.distance}</Text> : null}
                      {card.lastPlayed ? <Text style={styles.chip}>{card.lastPlayed}</Text> : null}
                    </View>
                    <Text style={styles.meta}>{placeLine(course)}</Text>
                    {courseNeedsPinSheets({
                      courseApiId: course.id,
                      name: course.name,
                      city: course.city,
                      state: course.state,
                      location: course.location,
                    }) ? (
                      <Text style={styles.warn}>{COPY.hardMissNeedPins}</Text>
                    ) : null}
                  </Pressable>
                  <View style={styles.actions}>
                    {courseAllowsFavorite(course.id) ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={starred ? COPY.unfavorite : COPY.favorite}
                        onPress={() => toggleStar(course)}
                        style={styles.star}>
                        <Text style={styles.starText}>{starred ? '★' : '☆'}</Text>
                      </Pressable>
                    ) : null}
                    {showRequest ? (
                      <Pressable accessibilityRole="button" onPress={() => openRequest(course)} style={styles.link}>
                        <Text style={styles.linkText}>{COPY.requestThisCourse}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            })
          : null}
        {teeBusy ? <Text style={styles.meta}>Loading tees…</Text> : null}
        {selected && tees && tees.length === 0 ? (
          <Text style={styles.meta}>No tees listed for this course.</Text>
        ) : null}
        {selected && tees && tees.length > 0 ? (
          <View style={styles.teeBox}>
            <Text style={styles.label}>{COPY.pickTee}</Text>
            {tees.map((tee) => (
              <Pressable
                key={tee.name}
                onPress={() => onSelect({ course: selected, detail, tee })}
                style={[styles.row, selectedTee?.name === tee.name && styles.rowOn]}>
                <Text style={styles.rowTitle}>{tee.name}</Text>
                <Text style={styles.meta}>{formatTeeMeta(tee)}</Text>
                {formatTeeHoleYards(tee.holes) ? (
                  <Text style={styles.meta}>{formatTeeHoleYards(tee.holes)}</Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: ColorPalette) {
  return StyleSheet.create({
  box: { flex: 1, gap: 10, paddingHorizontal: 16, paddingBottom: 16 },
  list: { flex: 1 },
  search: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 14,
    color: colors.cream,
    fontSize: 18,
    backgroundColor: colors.bgElevated,
  },
  label: { color: colors.muted, fontSize: type.meta, fontWeight: '700' },
  meta: { color: colors.muted, fontSize: type.meta, lineHeight: 20 },
  paintSource: { color: colors.muted, fontSize: type.tiny, fontWeight: '600' },
  warn: { color: colors.orange, fontSize: type.meta, fontWeight: '700' },
  selected: { gap: 6 },
  selectedName: { color: colors.cream, fontSize: 18, fontWeight: '800' },
  row: {
    minHeight: thumbZoneMin,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    backgroundColor: colors.bgElevated,
    marginBottom: 10,
    gap: 6,
  },
  rowOn: { borderColor: colors.cream },
  rowTitle: { color: colors.cream, fontSize: type.body, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    color: colors.cream,
    fontSize: type.tiny,
    fontWeight: '800',
    backgroundColor: colors.accentWash,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  teeBox: { gap: 8, marginTop: 8 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  star: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  starText: { color: colors.cream, fontSize: 22, fontWeight: '800' },
  link: { minHeight: 44, justifyContent: 'center' },
  linkText: { color: colors.cream, fontSize: type.meta, fontWeight: '800' },
  });
}
