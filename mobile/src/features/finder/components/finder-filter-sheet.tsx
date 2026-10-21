import { useState, type ReactNode } from 'react';
import { ScrollView, Switch, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { MarketFilter } from '@/features/leaders/types';
import { BottomSheet, Button, Chip } from '@/ui';

import { BB_SIGMAS, DEFAULT_FINDER_FILTERS, fromDraft, sigmaLabel, toDraft } from '../finder';
import type { BbPosition, FinderDraft, FinderFilters, MaOrderFilter, NumKey } from '../types';

const MARKETS: [MarketFilter, string][] = [['ALL', '전체'], ['KOSPI', 'KOSPI'], ['KOSDAQ', 'KOSDAQ']];
const MA_ORDERS: [MaOrderFilter | null, string][] = [[null, '무관'], ['PERFECT', '정배열'], ['REVERSE', '역배열']];
const BB_POSITIONS: [BbPosition | null, string][] = [
  [null, '무관'],
  ['ABOVE', '상단 돌파'],
  ['BELOW', '하단 이탈'],
  ['INSIDE', '밴드 안'],
];

type Props = { value: FinderFilters; onApply: (f: FinderFilters) => void; onClose: () => void };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.label}>{title}</Text>
      {children}
    </View>
  );
}

/** 숫자 입력 한 칸 — 빈칸이면 조건 없음. numeric 키보드(iOS 숫자 패드에는 '-' 가 없음) */
function NumInput({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (v: string) => void }) {
  const { theme } = useUnistyles();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={theme.colors.textSecondary}
      keyboardType="numeric"
      accessibilityLabel={placeholder}
      style={styles.input}
    />
  );
}

/**
 * 조건검색 필터 바텀시트 — 웹 필터 패널과 같은 항목. 시트 안에서는 초안만 바꾸고 [적용]에서 반영.
 * [초기화]는 초안을 기본값으로(적용은 따로). 닫으면 초안은 버린다. 항목이 많아 안쪽을 스크롤한다. 호출부가 열 때 마운트한다.
 */
export function FinderFilterSheet({ value, onApply, onClose }: Props) {
  const { theme } = useUnistyles();
  const { height } = useWindowDimensions();
  const [draft, setDraft] = useState<FinderDraft>(() => toDraft(value));
  const set = (patch: Partial<FinderDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const num = (key: NumKey, placeholder: string) => (
    <NumInput value={draft[key]} placeholder={placeholder} onChange={(v) => set({ [key]: v } as Partial<FinderDraft>)} />
  );
  const range = (lo: NumKey, hi: NumKey, unit: string) => (
    <View style={styles.range}>
      <View style={styles.flex}>{num(lo, `최소(${unit})`)}</View>
      <Text style={styles.tilde}>~</Text>
      <View style={styles.flex}>{num(hi, `최대(${unit})`)}</View>
    </View>
  );

  return (
    <BottomSheet title="필터" onClose={onClose}>
      <ScrollView style={{ maxHeight: height * 0.65 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Section title="시장">
          <View style={styles.chips}>
            {MARKETS.map(([v, t]) => (
              <Chip key={v} label={t} selected={draft.market === v} onPress={() => set({ market: v })} />
            ))}
          </View>
        </Section>
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
        <Section title="가격">{range('priceMin', 'priceMax', '원')}</Section>
        <Section title="시가총액">{range('mcapMin', 'mcapMax', '억 원')}</Section>
        <Section title="거래대금">{num('valueMin', '최소(억 원)')}</Section>
        <Section title="거래량(20일 평균 대비)">{num('volRatioMin', '최소(배), 예: 2')}</Section>
        <Section title="RSI(14)">{range('rsiMin', 'rsiMax', '0~100')}</Section>
        <Section title="이동평균 배열">
          <View style={styles.chips}>
            {MA_ORDERS.map(([v, t]) => (
              <Chip key={t} label={t} selected={draft.maOrder === v} onPress={() => set({ maOrder: v })} />
            ))}
          </View>
        </Section>
        <Section title="볼린저 σ">
          <View style={styles.chips}>
            {BB_SIGMAS.map((s) => (
              <Chip key={s} label={sigmaLabel(s)} selected={draft.bbSigma === s} onPress={() => set({ bbSigma: s })} />
            ))}
          </View>
        </Section>
        <Section title="볼린저 위치">
          <View style={styles.chips}>
            {BB_POSITIONS.map(([v, t]) => (
              <Chip key={t} label={t} selected={draft.bbPosition === v} onPress={() => set({ bbPosition: v })} />
            ))}
          </View>
        </Section>
        <Section title="볼린저 밴드폭">{num('bbWidthMax', '최대(%)')}</Section>
        <Section title="위쪽 매물(최근 120일)">{num('vpAboveMax', '최대(%)')}</Section>
        <Section title="ROE">{num('roeMin', '최소(%)')}</Section>
        <Section title="PER">{range('perMin', 'perMax', '배')}</Section>
        <Section title="PBR">{range('pbrMin', 'pbrMax', '배')}</Section>
        <Section title="부채비율">{num('debtRatioMax', '최대(%)')}</Section>
        <Section title="매출 성장률">{num('salesGrowthMin', '최소(%)')}</Section>
        <Text style={styles.hint}>재무는 최신 연간 결산 기준이에요. 빈칸은 조건 없음.</Text>
      </ScrollView>
      <View style={styles.buttons}>
        <View style={styles.flex}>
          <Button label="초기화" variant="secondary" onPress={() => setDraft(toDraft(DEFAULT_FINDER_FILTERS))} />
        </View>
        <View style={styles.flex}>
          <Button label="적용" onPress={() => onApply(fromDraft(draft))} />
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { gap: theme.gap(1.5), paddingBottom: theme.gap(1) },
  section: { gap: theme.gap(0.75) },
  label: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap(1) },
  range: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1) },
  tilde: { fontSize: 14, color: theme.colors.textSecondary },
  input: {
    backgroundColor: theme.colors.fill,
    borderRadius: theme.radius.input,
    paddingHorizontal: theme.gap(1.5),
    paddingVertical: theme.gap(1),
    fontSize: 15,
    color: theme.colors.text,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1.5) },
  flex: { flex: 1 },
  switchTitle: { fontSize: 15, fontWeight: '600', color: theme.colors.text },
  hint: { fontSize: 12, color: theme.colors.textSecondary },
  buttons: { flexDirection: 'row', gap: theme.gap(1), marginTop: theme.gap(1) },
}));
