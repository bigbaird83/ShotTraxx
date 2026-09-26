import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useDb } from '@/src/db/DbProvider';
import {
  getClubMap,
  getRound,
  listHandicapRounds,
  listHoles,
  listPenaltiesForHole,
  listShotsForHole,
  listStrokesGainedHoles,
} from '@/src/db/repo';
import { formatDifferential, planHandicap, roundDifferential } from '@/src/domain/handicap';
import { formatFairwayMisses, formatHitRate } from '@/src/domain/fairwayGir';
import { totalPenaltyStrokes } from '@/src/domain/penalty';
import { COPY } from '@/src/domain/playerCopy';
import { planRoundStats, type ReviewShotPick } from '@/src/domain/roundReview';
import { scorecardDiffLabel } from '@/src/domain/scorecard';
import {
  formatStrokesGained,
  roundStrokesGained,
  SG_CATEGORIES,
  SG_CATEGORY_LABELS,
  weakestCategory,
} from '@/src/domain/strokesGained';
import { useProFeature } from '@/src/services/proFeature';
import { Screen } from '@/src/ui/Screen';
import { useColors } from '@/src/ui/ColorThemeProvider';
import { type ColorPalette } from '@/src/ui/theme';

function formatPick(pick: ReviewShotPick | null): string | null {
  if (!pick) return null;
  return pick.clubName ? `${pick.yards} yd · ${pick.clubName}` : `${pick.yards} yd`;
}

/** One saved round's stats. Only what the app stores — nothing untracked is shown. */
export default function ReviewStatsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { db, revision } = useDb();
  const strokesGainedOn = useProFeature();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const round = useMemo(() => getRound(db, id), [db, id, revision]);
  const stats = useMemo(() => {
    if (!round) return null;
    return planRoundStats({
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
      clubs: getClubMap(db),
    });
  }, [db, round, revision]);

  const strokesGained = useMemo(
    () => (round ? roundStrokesGained(listStrokesGainedHoles(db, round.id)) : null),
    [db, round, revision],
  );

  const differential = useMemo(
    () => (round ? roundDifferential(planHandicap(listHandicapRounds(db)), round.id) : null),
    [db, round, revision],
  );

  if (!round || !stats) {
    return (
      <Screen>
        <Text style={styles.muted}>Round not found.</Text>
      </Screen>
    );
  }

  const longest = formatPick(stats.longest);
  const fairwayMisses = formatFairwayMisses(stats.fairwayGir);
  const shortest = formatPick(stats.shortestFullSwing);

  return (
    <Screen>
      <Text style={styles.title}>{round.courseName ?? 'Round'}</Text>

      <View style={styles.block}>
        <Row styles={styles} label={COPY.score} value={stats.score ?? '—'} />
        <Row styles={styles} label={COPY.nerdOutVsPar} value={scorecardDiffLabel(stats.toPar) ?? '—'} />
        <Row styles={styles} label={COPY.statsHolesPlayed} value={stats.holesPlayed} />
        {differential ? (
          <Row
            styles={styles}
            label={differential.nine ? `${COPY.statsDifferential} (9 + 9)` : COPY.statsDifferential}
            value={formatDifferential(differential.differential)}
          />
        ) : null}
        <Text style={styles.muted}>
          {stats.marks.eagle} eagle · {stats.marks.birdie} birdie · {stats.marks.par} par · {stats.marks.bogey} bogey · {stats.marks.double} double+
        </Text>
      </View>

      <StrokesGainedBlock styles={styles} sg={strokesGained} unlocked={strokesGainedOn} />

      <View style={styles.block}>
        <Row styles={styles} label={COPY.putts} value={stats.putts} />
        <Row styles={styles} label={COPY.nerdOutPuttsPerHole} value={stats.puttsPerHole ?? '—'} />
        <Row styles={styles} label={COPY.statsPenaltyStrokes} value={stats.penaltyStrokes} />
      </View>

      <View style={styles.block}>
        <Text style={styles.section}>{COPY.statsFairwayGir}</Text>
        <Row
          styles={styles}
          label={COPY.fairways}
          value={formatHitRate(stats.fairwayGir.fairwaysHit, stats.fairwayGir.fairwayHoles)}
        />
        {fairwayMisses ? <Row styles={styles} label={COPY.fairwayMisses} value={fairwayMisses} /> : null}
        <Row
          styles={styles}
          label={COPY.gir}
          value={formatHitRate(stats.fairwayGir.greensHit, stats.fairwayGir.greenHoles)}
        />
      </View>

      {stats.parAverages.length > 0 ? (
        <View style={styles.block}>
          <Text style={styles.section}>{COPY.statsParAverages}</Text>
          {stats.parAverages.map((row) => (
            <Row key={row.par} styles={styles} label={`Par ${row.par} (${row.holes})`} value={row.avg.toFixed(2)} />
          ))}
        </View>
      ) : null}

      <View style={styles.block}>
        {longest ? <Row styles={styles} label={COPY.statsLongestShot} value={longest} /> : null}
        {shortest ? <Row styles={styles} label={COPY.statsShortestShot} value={shortest} /> : null}
        {stats.clubAverages.length > 0 ? (
          <>
            <Text style={styles.section}>{COPY.statsClubAverages}</Text>
            {stats.clubAverages.map((row) => (
              <Row
                key={row.id}
                styles={styles}
                label={`${row.name} (${row.count})`}
                value={`${row.avgYards} yd`}
              />
            ))}
          </>
        ) : (
          <Text style={styles.muted}>{COPY.statsNoShots}</Text>
        )}
      </View>

      {stats.holeTimes.length > 0 ? (
        <View style={styles.block}>
          <Text style={styles.section}>{COPY.statsHoleTimes}</Text>
          {stats.holeTimes.map((row) => (
            <Row key={row.number} styles={styles} label={`Hole ${row.number}`} value={row.span} />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

function StrokesGainedBlock({
  styles,
  sg,
  unlocked,
}: {
  styles: ReturnType<typeof makeStyles>;
  sg: ReturnType<typeof roundStrokesGained>;
  unlocked: boolean;
}) {
  if (!unlocked) {
    return (
      <View style={styles.block} testID="stats-strokes-gained">
        <Text style={styles.section}>{COPY.strokesGained}</Text>
        <Text style={styles.muted}>{COPY.strokesGainedPro}</Text>
      </View>
    );
  }
  if (!sg) {
    return (
      <View style={styles.block} testID="stats-strokes-gained">
        <Text style={styles.section}>{COPY.strokesGained}</Text>
        <Text style={styles.muted}>{COPY.strokesGainedEmpty}</Text>
      </View>
    );
  }
  const weakest = weakestCategory(sg);
  const showUnsplit = Math.abs(sg.unsplit) >= 0.05;
  return (
    <View style={styles.block} testID="stats-strokes-gained">
      <Text style={styles.section}>{COPY.strokesGained}</Text>
      <Text style={styles.note}>{COPY.strokesGainedLede}</Text>
      {SG_CATEGORIES.map((key) => (
        <Row key={key} styles={styles} label={SG_CATEGORY_LABELS[key]} value={formatStrokesGained(sg[key])} />
      ))}
      {showUnsplit ? (
        <Row styles={styles} label={COPY.strokesGainedUnsplit} value={formatStrokesGained(sg.unsplit)} />
      ) : null}
      <Row styles={styles} label={COPY.strokesGainedTotal} value={formatStrokesGained(sg.total)} />
      {weakest ? (
        <Text style={styles.muted}>
          {COPY.strokesGainedWeakest} {SG_CATEGORY_LABELS[weakest]}
        </Text>
      ) : null}
      <Text style={styles.note}>
        {sg.holesCounted} holes · {sg.shotsSplit} of {sg.shotsTotal} shots split
      </Text>
      <Text style={styles.note}>{COPY.strokesGainedLimits}</Text>
    </View>
  );
}

function Row({
  styles,
  label,
  value,
}: {
  styles: ReturnType<typeof makeStyles>;
  label: string;
  value: string | number;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function makeStyles(colors: ColorPalette) {
  return StyleSheet.create({
    title: { color: colors.cream, fontSize: 24, fontWeight: '900' },
    section: { color: colors.cream, fontSize: 18, fontWeight: '800' },
    muted: { color: colors.muted, fontSize: 16 },
    note: { color: colors.muted, fontSize: 13 },
    block: { gap: 8, backgroundColor: colors.bgElevated, padding: 14, borderRadius: 16 },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
    label: { color: colors.muted, fontSize: 16, fontWeight: '800', flexShrink: 1 },
    value: { color: colors.cream, fontSize: 18, fontWeight: '900' },
  });
}
