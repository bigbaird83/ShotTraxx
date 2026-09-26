import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useDb } from '@/src/db/DbProvider';
import { listClubAverages } from '@/src/db/repo';
import { enabledClubAverageRows } from '@/src/domain/averages';
import { clubCarryMeta } from '@/src/domain/bagDistance';
import { COPY } from '@/src/domain/playerCopy';
import { EmptyPanel } from '@/src/ui/EmptyPanel';
import { useColors } from '@/src/ui/ColorThemeProvider';
import { Screen } from '@/src/ui/Screen';
import { tapTarget, type, type ColorPalette } from '@/src/ui/theme';
import { TabSwipe } from '@/src/ui/TabSwipe';

export default function AveragesScreen() {
  const { db, revision, bump } = useDb();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  useFocusEffect(
    useCallback(() => {
      bump();
    }, [bump]),
  );
  const rows = useMemo(() => enabledClubAverageRows(listClubAverages(db)), [db, revision]);
  const hasLive = rows.some((row) => row.count > 0);

  return (
    <TabSwipe tab="averages">
      <Screen>
        <Text style={styles.lede}>{COPY.averagesLede}</Text>
        {!hasLive ? <EmptyPanel title={COPY.noClosedShots} hint={COPY.firstRoundHint} /> : null}
        {rows.map((row) => {
          const book = row.bag;
          return (
            <View key={row.club.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{row.club.name}</Text>
                <Text style={styles.meta}>{clubCarryMeta(book)}</Text>
              </View>
              <Text style={styles.yards}>{book.yards != null ? `${book.yards} yd` : '—'}</Text>
            </View>
          );
        })}
      </Screen>
    </TabSwipe>
  );
}

function makeStyles(colors: ColorPalette) {
  return StyleSheet.create({
    lede: { color: colors.muted, fontSize: type.body, lineHeight: 22, marginBottom: 4 },
    empty: { color: colors.muted, fontSize: type.body, fontWeight: '700' },
    row: {
      minHeight: tapTarget + 8,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: colors.bgElevated,
      padding: 14,
      borderRadius: 14,
      gap: 12,
    },
    name: { color: colors.cream, fontSize: 18, fontWeight: '700' },
    meta: { color: colors.muted, fontSize: type.meta, marginTop: 2 },
    yards: { color: colors.cream, fontSize: 22, fontWeight: '900' },
  });
}
