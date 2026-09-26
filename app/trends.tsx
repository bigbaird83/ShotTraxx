import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useDb } from '@/src/db/DbProvider';
import {
  getClubMap,
  listHoles,
  listPenaltiesForHole,
  listShotsForHole,
  listStatRounds,
  listStrokesGainedHolesBatched,
} from '@/src/db/repo';
import { totalPenaltyStrokes } from '@/src/domain/penalty';
import { COPY } from '@/src/domain/playerCopy';
import { planRoundStats } from '@/src/domain/roundReview';
import {
  averageStrokesGainedPer18,
  formatStrokesGained,
  roundStrokesGained,
  SG_CATEGORIES,
  SG_CATEGORY_LABELS,
  weakestCategory,
} from '@/src/domain/strokesGained';
import {
  formatTrendChange,
  formatTrendValue,
  planTrend,
  trendClubs,
  TREND_WINDOWS,
  type TrendMetricId,
  type TrendRoundIn,
  type TrendWindow,
} from '@/src/domain/trends';
import { useProFeature } from '@/src/services/proFeature';
import { Screen } from '@/src/ui/Screen';
import { TrendBars } from '@/src/ui/TrendBars';
import { useColors } from '@/src/ui/ColorThemeProvider';
import { type ColorPalette } from '@/src/ui/theme';

const METRICS: { id: Exclude<TrendMetricId, 'carry'>; title: string; hint: string }[] = [
  { id: 'toPar', title: 'Vs par', hint: 'Per 18 holes · lower is better' },
  { id: 'putts', title: 'Putts', hint: 'Per 18 holes · lower is better' },
  { id: 'penalties', title: 'Penalty strokes', hint: 'Per 18 holes · lower is better' },
  { id: 'fairways', title: 'Fairways hit', hint: 'Par 4s and 5s you tapped · higher is better' },
  { id: 'gir', title: 'Greens in reg', hint: 'Closed holes · higher is better' },
];

/** Trends across finished rounds — one small chart per stat, from saved rows only. */
export default function TrendsScreen() {
  const { db, revision } = useDb();
  const strokesGainedOn = useProFeature();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [windowSize, setWindowSize] = useState<TrendWindow>(10);
  const [clubId, setClubId] = useState<string | null>(null);

  const rounds = useMemo<TrendRoundIn[]>(() => {
    const clubs = getClubMap(db);
    return listStatRounds(db)
      .filter((round) => round.finishedAt != null)
      .map((round) => ({
        id: round.id,
        courseName: round.courseName,
        playedAt: round.finishedAt ?? round.startedAt,
        stats: planRoundStats({
          holes: listHoles(db, round.id).map((hole) => ({
            number: hole.number,
            par: hole.par,
            score: hole.score,
            putts: hole.putts,
            startedAt: hole.startedAt,
            completedAt: hole.completedAt,
            shots: listShotsForHole(db, hole.id),
            penaltyStrokes: totalPenaltyStrokes(listPenaltiesForHole(db, hole.id)),
            puttsDone: hole.puttsDone,
            fairway: hole.fairway,
          })),
          clubs,
        }),
      }));
  }, [db, revision]);

  /** Newest first, same order as `rounds`, and only the selected window. */
  const sgAverage = useMemo(
    () =>
      averageStrokesGainedPer18(
        rounds
          .slice(0, windowSize)
          .map((round) => roundStrokesGained(listStrokesGainedHolesBatched(db, round.id))),
      ),
    [db, rounds, windowSize],
  );

  const clubs = useMemo(() => trendClubs(rounds, windowSize), [rounds, windowSize]);
  const activeClub = clubs.find((club) => club.id === clubId) ?? clubs[0] ?? null;

  if (rounds.length < 2) {
    return (
      <Screen>
        <Text style={styles.title}>{COPY.trends}</Text>
        <Text style={styles.muted}>{COPY.trendsEmpty}</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={styles.muted}>{COPY.trendsLede}</Text>
      <View style={styles.filters} accessibilityRole="radiogroup">
        {TREND_WINDOWS.map((size) => {
          const on = windowSize === size;
          return (
            <Pressable
              key={size}
              testID={`trends-window-${size}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => setWindowSize(size)}
              style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>Last {size}</Text>
            </Pressable>
          );
        })}
      </View>

      <StrokesGainedCard styles={styles} average={sgAverage} unlocked={strokesGainedOn} />

      {METRICS.map((metric) => {
        const series = planTrend({ rounds, metric: metric.id, window: windowSize });
        return (
          <MetricCard
            key={metric.id}
            styles={styles}
            title={metric.title}
            hint={metric.hint}
            average={formatTrendValue(series.average, series.unit, metric.id === 'toPar')}
            change={formatTrendChange(series, windowSize)}
            tone={series.tone}>
            {series.points.some((point) => point.value != null) ? (
              <TrendBars series={series} testID={`trend-${metric.id}`} />
            ) : (
              <Text style={styles.muted}>{COPY.trendsNoData}</Text>
            )}
          </MetricCard>
        );
      })}

      <View style={styles.card} testID="trend-carry">
        <Text style={styles.section}>{COPY.trendsCarry}</Text>
        {activeClub ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.clubRow}>
              {clubs.map((club) => {
                const on = club.id === activeClub.id;
                return (
                  <Pressable
                    key={club.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => setClubId(club.id)}
                    style={[styles.chip, on && styles.chipOn]}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{club.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <CarryChart styles={styles} rounds={rounds} windowSize={windowSize} clubId={activeClub.id} />
          </>
        ) : (
          <Text style={styles.muted}>{COPY.trendsNoData}</Text>
        )}
      </View>
    </Screen>
  );
}

function StrokesGainedCard({
  styles,
  average,
  unlocked,
}: {
  styles: ReturnType<typeof makeStyles>;
  average: ReturnType<typeof averageStrokesGainedPer18>;
  unlocked: boolean;
}) {
  if (!unlocked) {
    return (
      <View style={styles.card} testID="trend-strokes-gained">
        <Text style={styles.section}>{COPY.strokesGained}</Text>
        <Text style={styles.muted}>{COPY.strokesGainedPro}</Text>
      </View>
    );
  }
  const weakest = average ? weakestCategory(average) : null;
  return (
    <View style={styles.card} testID="trend-strokes-gained">
      <Text style={styles.section}>{COPY.strokesGained}</Text>
      <Text style={styles.hint}>{COPY.trendsStrokesGainedHint}</Text>
      <Text style={styles.hint}>{COPY.trendsStrokesGainedShort}</Text>
      {average ? (
        <>
          <View style={styles.headline}>
            <Text style={styles.value}>{formatStrokesGained(average.total)}</Text>
            <Text style={styles.change}>
              {average.rounds} {average.rounds === 1 ? 'round' : 'rounds'}
            </Text>
          </View>
          {SG_CATEGORIES.map((key) => (
            <View key={key} style={styles.sgRow}>
              <Text style={[styles.sgLabel, key === weakest && styles.bad]}>{SG_CATEGORY_LABELS[key]}</Text>
              <Text style={[styles.sgValue, key === weakest && styles.bad]}>
                {formatStrokesGained(average[key])}
              </Text>
            </View>
          ))}
          {Math.abs(average.unsplit) >= 0.05 ? (
            <View style={styles.sgRow}>
              <Text style={styles.sgLabel}>{COPY.strokesGainedUnsplit}</Text>
              <Text style={styles.sgValue}>{formatStrokesGained(average.unsplit)}</Text>
            </View>
          ) : null}
        </>
      ) : (
        <Text style={styles.muted}>{COPY.trendsNoData}</Text>
      )}
    </View>
  );
}

function CarryChart({
  styles,
  rounds,
  windowSize,
  clubId,
}: {
  styles: ReturnType<typeof makeStyles>;
  rounds: TrendRoundIn[];
  windowSize: TrendWindow;
  clubId: string;
}) {
  const series = planTrend({ rounds, metric: 'carry', window: windowSize, clubId });
  const change = formatTrendChange(series, windowSize);
  return (
    <View style={styles.cardBody}>
      <View style={styles.headline}>
        <Text style={styles.value}>{formatTrendValue(series.average, series.unit)}</Text>
        {change ? <Text style={styles.muted}>{change}</Text> : null}
      </View>
      <TrendBars series={series} />
    </View>
  );
}

function MetricCard({
  styles,
  title,
  hint,
  average,
  change,
  tone,
  children,
}: {
  styles: ReturnType<typeof makeStyles>;
  title: string;
  hint: string;
  average: string;
  change: string | null;
  tone: 'good' | 'bad' | 'even' | null;
  children: ReactNode;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.section}>{title}</Text>
      <Text style={styles.hint}>{hint}</Text>
      <View style={styles.headline}>
        <Text style={styles.value}>{average}</Text>
        {change ? (
          <Text style={[styles.change, tone === 'good' && styles.good, tone === 'bad' && styles.bad]}>
            {change}
            {tone === 'good' ? ' · better' : tone === 'bad' ? ' · worse' : ''}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function makeStyles(colors: ColorPalette) {
  return StyleSheet.create({
    title: { color: colors.cream, fontSize: 24, fontWeight: '900' },
    section: { color: colors.cream, fontSize: 18, fontWeight: '800' },
    muted: { color: colors.muted, fontSize: 15 },
    hint: { color: colors.muted, fontSize: 13 },
    filters: { flexDirection: 'row', gap: 8 },
    clubRow: { gap: 8, paddingVertical: 2 },
    chip: {
      minHeight: 44,
      paddingHorizontal: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.bgElevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipOn: { borderColor: colors.cream, borderWidth: 2, backgroundColor: colors.accentWash },
    chipText: { color: colors.cream, fontWeight: '800', fontSize: 15 },
    chipTextOn: { fontWeight: '900' },
    card: { gap: 8, backgroundColor: colors.bgElevated, padding: 14, borderRadius: 16 },
    cardBody: { gap: 8 },
    headline: { flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
    value: { color: colors.cream, fontSize: 30, fontWeight: '900' },
    change: { color: colors.muted, fontSize: 14, fontWeight: '800' },
    sgRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
    sgLabel: { color: colors.muted, fontSize: 16, fontWeight: '800', flexShrink: 1 },
    sgValue: { color: colors.cream, fontSize: 18, fontWeight: '900' },
    good: { color: colors.good },
    bad: { color: colors.red },
  });
}
