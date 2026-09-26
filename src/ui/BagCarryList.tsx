import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  getBagCarrySuggestionDismissals,
  listClubAverages,
  setBagCarrySuggestionDismissals,
  setClubEnabled,
  updateClubCarry,
} from '@/src/db/repo';
import { bagClubYardageLabel, DISABLED_CLUB_YARDAGE } from '@/src/domain/averages';
import { bagCarryChip, canEditTypedCarry, clubCarryMeta, type BagCarry } from '@/src/domain/bagDistance';
import { bagSuggestionIsDismissed, dismissBagSuggestion } from '@/src/domain/bagSuggestion';
import { isPutterClubId, parseTypicalCarryYards } from '@/src/domain/defaultBag';
import { COPY, formatBagCarrySuggestion } from '@/src/domain/playerCopy';
import type { Club } from '@/src/domain/types';
import { useColors } from './ColorThemeProvider';
import { tapTarget, type, type ColorPalette } from './theme';

type Props = {
  db: SQLiteDatabase;
  clubs: Club[];
  onChange: () => void;
  onRename?: (club: Club) => void;
};

export function BagCarryList({ db, clubs, onChange, onRename }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Same resolved number as Club data and Suggested: live ≥5 → typed → estimated → seed.
  const averages = useMemo(() => {
    const dismissed = getBagCarrySuggestionDismissals(db);
    const byClub = new Map(listClubAverages(db).map((row) => [row.club.id, row] as const));
    return { dismissed, byClub };
  }, [db, clubs]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  return (
    <View style={styles.list}>
      {clubs.map((club) => {
        const row = averages.byClub.get(club.id);
        const carry: BagCarry | undefined = row?.bag;
        const suggestion = row?.suggestion ?? null;
        const showSuggestion =
          suggestion != null &&
          !bagSuggestionIsDismissed(averages.dismissed, club.id, suggestion.newestShotId);
        const putter = isPutterClubId(club.id);
        const yardageLabel = bagClubYardageLabel({
          enabled: club.enabled,
          yards: carry?.yards ?? null,
        });
        const showDash = yardageLabel === DISABLED_CLUB_YARDAGE;
        const editable = carry == null || canEditTypedCarry(carry);
        const draft = editable ? drafts[club.id] : undefined;
        // Seed shows as the placeholder so typing starts from empty, never from the stock number.
        const seed = carry?.kind === 'seed' && carry.yards != null ? String(carry.yards) : null;
        const display =
          draft !== undefined
            ? draft
            : carry?.yards != null && seed == null
              ? String(carry.yards)
              : '';
        const chip = draft === undefined ? bagCarryChip(carry?.kind ?? null) : null;
        return (
          <View key={club.id} style={styles.row}>
            <View style={{ flex: 1, gap: 6 }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => onRename?.(club)}
                disabled={!onRename}>
                <Text style={styles.name}>{club.name}</Text>
                <Text style={styles.short}>{club.shortName}</Text>
              </Pressable>
              {putter ? null : showDash ? (
                <View style={styles.carryRow}>
                  <Text accessibilityLabel={`${club.shortName} average`} style={styles.dash}>
                    {DISABLED_CLUB_YARDAGE}
                  </Text>
                </View>
              ) : (
                <View style={styles.carryRow}>
                  <TextInput
                    accessibilityLabel={`${club.shortName} ${COPY.typicalCarryYards}`}
                    placeholder={seed ?? COPY.typicalCarryYards}
                    placeholderTextColor={colors.muted}
                    value={display}
                    editable={editable}
                    onChangeText={(raw) => {
                      if (!editable) return;
                      setDrafts((prev) => ({ ...prev, [club.id]: raw }));
                      const yards = parseTypicalCarryYards(raw);
                      if (raw.trim() === '' || yards != null) {
                        updateClubCarry(db, club.id, yards);
                        onChange();
                      }
                    }}
                    onBlur={() => {
                      setDrafts((prev) => {
                        const next = { ...prev };
                        delete next[club.id];
                        return next;
                      });
                    }}
                    keyboardType="number-pad"
                    inputMode="numeric"
                    style={[styles.carry, !editable && styles.carryLive]}
                  />
                  {chip === 'estimated' ? <Text style={styles.badge}>{COPY.estimated}</Text> : null}
                  {chip === 'seed' ? <Text style={styles.seedBadge}>{COPY.typicalCarry}</Text> : null}
                  {carry?.kind === 'live' ? (
                    <Text style={styles.short}>{clubCarryMeta(carry)}</Text>
                  ) : null}
                </View>
              )}
              {!putter && showSuggestion && suggestion ? (
                <View style={styles.suggest}>
                  <Text style={styles.suggestLine}>
                    {formatBagCarrySuggestion(club.name, suggestion.yards)}
                  </Text>
                  <View style={styles.suggestActions}>
                    <Pressable
                      accessibilityRole="button"
                      hitSlop={8}
                      onPress={() => {
                        setDrafts((prev) => {
                          if (prev[club.id] === undefined) return prev;
                          const next = { ...prev };
                          delete next[club.id];
                          return next;
                        });
                        updateClubCarry(db, club.id, suggestion.yards);
                        onChange();
                      }}>
                      <Text style={styles.suggestUpdate}>{COPY.bagCarrySuggestionUpdate}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      hitSlop={8}
                      onPress={() => {
                        setBagCarrySuggestionDismissals(
                          db,
                          dismissBagSuggestion(
                            getBagCarrySuggestionDismissals(db),
                            club.id,
                            suggestion.newestShotId,
                          ),
                        );
                        onChange();
                      }}>
                      <Text style={styles.suggestDismiss}>{COPY.bagCarrySuggestionNotNow}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>
            <Switch
              value={club.enabled}
              onValueChange={(value) => {
                setClubEnabled(db, club.id, value);
                setDrafts((prev) => {
                  if (prev[club.id] === undefined) return prev;
                  const next = { ...prev };
                  delete next[club.id];
                  return next;
                });
                onChange();
              }}
              trackColor={{ true: colors.cream, false: colors.line }}
              thumbColor={colors.cream}
            />
          </View>
        );
      })}
    </View>
  );
}

export function BagCustomizeActions({
  onSkip,
  onDone,
  doneDisabled = false,
}: {
  onSkip: () => void;
  onDone: () => void;
  doneDisabled?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" onPress={onSkip} style={styles.skip}>
        <Text style={styles.skipLabel}>{COPY.bagCustomizeSkip}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={doneDisabled}
        onPress={onDone}
        style={[styles.done, doneDisabled && styles.doneOff]}>
        <Text style={styles.doneLabel}>{COPY.bagCustomizeDone}</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(colors: ColorPalette) {
  return StyleSheet.create({
  list: { gap: 10 },
  row: {
    minHeight: tapTarget,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.bgElevated,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    gap: 8,
  },
  name: { color: colors.cream, fontSize: 18, fontWeight: '700' },
  short: { color: colors.muted, fontSize: type.meta },
  carryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  carry: {
    minHeight: 48,
    minWidth: 96,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 10,
    color: colors.cream,
    fontSize: 18,
    backgroundColor: colors.bg,
  },
  carryLive: { borderColor: 'transparent', backgroundColor: 'transparent' },
  dash: {
    minHeight: 48,
    minWidth: 96,
    paddingHorizontal: 10,
    color: colors.cream,
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 48,
  },
  badge: { color: colors.amber, fontSize: type.tiny, fontWeight: '800' },
  seedBadge: { color: colors.muted, fontSize: type.tiny, fontWeight: '800' },
  suggest: { gap: 6 },
  suggestLine: { color: colors.muted, fontSize: type.meta },
  suggestActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  suggestUpdate: { color: colors.lime, fontSize: type.body, fontWeight: '800' },
  suggestDismiss: { color: colors.muted, fontSize: type.body, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 10 },
  skip: {
    flex: 1,
    minHeight: tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },
  skipLabel: { color: colors.cream, fontSize: type.body, fontWeight: '800' },
  done: {
    flex: 1,
    minHeight: tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: colors.lime,
  },
  doneLabel: { color: colors.onAccent, fontSize: type.body, fontWeight: '900' },
  doneOff: { opacity: 0.4 },
  });
}
