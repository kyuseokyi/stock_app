import { useState } from 'react';
import { type LayoutChangeEvent, Pressable, Text, View } from 'react-native';
import Svg, { G, Rect, Text as SvgText } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { BottomSheet } from '@/ui';

import { heatLevel, topStocks } from '../dashboard';
import { formatChg, toneOf } from '../format';
import type { HeatmapGroup } from '../rest-types';
import { fitLabel, squarify, tileLabelLevel } from '../treemap';

const HEIGHT = 220;

/**
 * ④ 시장 히트맵(트리맵) — 면적 = 시총 또는 거래대금, 색 = 1일 등락률(up/down 토큰, 크기에 따라 3단계).
 * 칸이 작으면 글자 생략. 그룹 칸을 누르면 바텀시트로 소속 종목 Top 5 → 종목을 누르면 onOpenStock.
 */
export function Heatmap({ groups, onOpenStock }: { groups: HeatmapGroup[]; onOpenStock: (ticker: string, name: string) => void }) {
  const { theme } = useUnistyles();
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<HeatmapGroup | null>(null);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.floor(e.nativeEvent.layout.width));

  const tiles = width > 0 ? squarify(groups.map((g) => ({ id: g.id, size: g.size })), { x: 0, y: 0, w: width, h: HEIGHT }) : [];
  const byId = new Map(groups.map((g) => [g.id, g]));

  /** 단계 → 칸 배경(토큰)·투명도·글자색 */
  const paint = (chg: number | null) => {
    const { tone, level } = heatLevel(chg);
    if (tone === 'flat') return { fill: theme.colors.fill, opacity: 1, ink: theme.colors.text };
    const soft = tone === 'up' ? theme.colors.upSoft : theme.colors.downSoft;
    const strong = tone === 'up' ? theme.colors.up : theme.colors.down;
    if (level === 0) return { fill: soft, opacity: 1, ink: theme.colors.text };
    if (level === 1) return { fill: strong, opacity: 0.55, ink: theme.colors.text };
    return { fill: strong, opacity: 1, ink: theme.colors.onPrimary };
  };

  const top = selected ? topStocks(selected) : [];

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      {width > 0 ? (
        <Svg width={width} height={HEIGHT} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {tiles.map((t) => {
            const g = byId.get(t.id);
            if (!g) return null;
            const p = paint(g.chg);
            const lv = tileLabelLevel(t.w, t.h);
            const name = lv > 0 ? fitLabel(g.name, t.w - 8, 12) : '';
            return (
              <G key={t.id} onPress={() => setSelected(g)}>
                <Rect x={t.x} y={t.y} width={t.w} height={t.h} fill={theme.colors.surface} />
                <Rect
                  x={t.x + 1} y={t.y + 1} width={Math.max(0, t.w - 2)} height={Math.max(0, t.h - 2)}
                  rx={4} fill={p.fill} fillOpacity={p.opacity}
                />
                {name ? (
                  <SvgText x={t.x + 5} y={t.y + 16} fontSize={12} fontWeight="700" fill={p.ink}>{name}</SvgText>
                ) : null}
                {lv === 2 ? (
                  <SvgText x={t.x + 5} y={t.y + 31} fontSize={11} fill={p.ink}>{formatChg(g.chg)}</SvgText>
                ) : null}
              </G>
            );
          })}
        </Svg>
      ) : (
        <View style={styles.placeholder} />
      )}
      {/* 화면 낭독기용 — SVG 칸은 숨기고 큰 그룹 순 목록으로 읽힌다 */}
      <View style={styles.srOnly} accessible accessibilityLabel={`히트맵: ${tiles.slice(0, 8).map((t) => {
        const g = byId.get(t.id);
        return g ? `${g.name} ${formatChg(g.chg)}` : '';
      }).join(', ')}`} />
      {selected ? (
        <BottomSheet title={`${selected.name} · ${formatChg(selected.chg)}`} onClose={() => setSelected(null)}>
          <Text style={styles.sheetCaption}>소속 종목 Top 5 (크기 순)</Text>
          {top.length === 0 ? (
            <Text style={styles.empty}>종목 정보가 아직 없어요</Text>
          ) : (
            top.map((s, i) => (
              <Pressable
                key={s.ticker}
                style={styles.stockRow}
                onPress={() => {
                  setSelected(null);
                  onOpenStock(s.ticker, s.name);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${i + 1}위 ${s.name} ${formatChg(s.chg)}`}
                accessibilityHint="종목 상세 보기"
              >
                <Text style={styles.rank}>{i + 1}</Text>
                <Text style={styles.stockName} numberOfLines={1}>{s.name}</Text>
                <Text style={[styles.stockChg, styles[toneOf(s.chg)]]}>{formatChg(s.chg)}</Text>
              </Pressable>
            ))
          )}
        </BottomSheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { width: '100%', borderRadius: theme.radius.button, overflow: 'hidden' },
  placeholder: { height: HEIGHT },
  srOnly: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  sheetCaption: { fontSize: 13, color: theme.colors.textSecondary },
  empty: { fontSize: 14, color: theme.colors.textSecondary, paddingVertical: theme.gap(2) },
  stockRow: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1.5), minHeight: 48 },
  rank: { width: 20, fontSize: 14, fontWeight: '700', color: theme.colors.textSecondary, textAlign: 'center' },
  stockName: { flex: 1, fontSize: 16, fontWeight: '600', color: theme.colors.text },
  stockChg: { fontSize: 15, fontWeight: '700' },
  up: { color: theme.colors.up },
  down: { color: theme.colors.down },
  flat: { color: theme.colors.text },
}));
