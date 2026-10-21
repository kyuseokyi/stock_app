import { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { BottomSheet, Button, Chip } from '@/ui';

import { DEFAULT_FILTERS, LETTER_KEYS, LETTER_NAMES, toggleRequired } from '../canslim';
import type { MarketFilter, ScreenFilters } from '../types';

const MARKETS: [MarketFilter, string][] = [['ALL', '전체'], ['KOSPI', 'KOSPI'], ['KOSDAQ', 'KOSDAQ']];
const MIN_PASS = [0, 3, 4, 5, 6, 7];

type Props = { value: ScreenFilters; onApply: (f: ScreenFilters) => void; onClose: () => void };

/**
 * 필터 바텀시트 — 시장·최소 통과 수·꼭 통과할 항목·거래 활발 종목만. 시트 안에서는 초안만 바꾸고 [적용]에서 반영.
 * [초기화]는 초안을 기본값으로(정렬은 시트 밖 칩이라 유지). 닫으면 초안은 버린다. 호출부가 열 때 마운트한다.
 */
export function FilterSheet({ value, onApply, onClose }: Props) {
  const { theme } = useUnistyles();
  const [draft, setDraft] = useState<ScreenFilters>(value);
  const set = (patch: Partial<ScreenFilters>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <BottomSheet title="필터" onClose={onClose}>
      <Text style={styles.label}>시장</Text>
      <View style={styles.chips}>
        {MARKETS.map(([v, t]) => (
          <Chip key={v} label={t} selected={draft.market === v} onPress={() => set({ market: v })} />
        ))}
      </View>
      <Text style={styles.label}>최소 통과 수</Text>
      <View style={styles.chips}>
        {MIN_PASS.map((n) => (
          <Chip key={n} label={n === 0 ? '전부' : `${n}개 이상`} selected={draft.minPass === n} onPress={() => set({ minPass: n })} />
        ))}
      </View>
      <Text style={styles.label}>꼭 통과할 항목</Text>
      <View style={styles.chips}>
        {LETTER_KEYS.map((k) => (
          <Chip
            key={k}
            label={`${k.toUpperCase()} ${LETTER_NAMES[k]}`}
            selected={draft.required.includes(k)}
            onPress={() => set({ required: toggleRequired(draft.required, k) })}
          />
        ))}
      </View>
      <View style={styles.switchRow}>
        <View style={styles.flex}>
          <Text style={styles.switchTitle}>거래 활발 종목만</Text>
          <Text style={styles.hint}>하루 평균 거래대금 10억 원·주가 1,000원 이상</Text>
        </View>
        <Switch
          value={draft.liquidOnly}
          onValueChange={(v) => set({ liquidOnly: v })}
          trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
          accessibilityLabel="거래 활발 종목만"
        />
      </View>
      <View style={styles.buttons}>
        <View style={styles.flex}>
          <Button label="초기화" variant="secondary" onPress={() => setDraft({ ...DEFAULT_FILTERS, sort: value.sort })} />
        </View>
        <View style={styles.flex}>
          <Button label="적용" onPress={() => onApply({ ...draft, sort: value.sort })} />
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  label: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap(1) },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1.5) },
  flex: { flex: 1 },
  switchTitle: { fontSize: 15, fontWeight: '600', color: theme.colors.text },
  hint: { fontSize: 12, color: theme.colors.textSecondary },
  buttons: { flexDirection: 'row', gap: theme.gap(1), marginTop: theme.gap(1) },
}));
