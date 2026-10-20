import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { formatChg, toneOf } from '../format';
import type { GroupItem } from '../types';
import { BreadthBar } from './breadth-bar';

/** 테마·업종 순위 한 줄 — 순위·이름·연속 상위·등락률·상승/하락 막대·대장주. 누르면 onPress */
export function GroupRow({ item, onPress }: { item: GroupItem; onPress: () => void }) {
  const tone = toneOf(item.chg);
  // 라벨이 자식 글자를 덮으므로 화면 낭독기가 들을 값을 모두 담는다
  const label = [
    `${item.rank ? `${item.rank}위 ` : ''}${item.name}`,
    formatChg(item.chg),
    `상승 ${item.up} 보합 ${item.flat} 하락 ${item.down}`,
    item.leader ? `대장 ${item.leader.name} ${formatChg(item.leader.chg)}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityHint="상세 보기">
      <Text style={styles.rank}>{item.rank || '–'}</Text>
      <View style={styles.body}>
        <View style={styles.line}>
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          {item.streak >= 2 ? <Text style={styles.streak}>{item.streak}일째 상위</Text> : null}
          <Text style={[styles.chg, styles[tone]]}>{formatChg(item.chg)}</Text>
        </View>
        <View style={styles.line}>
          <BreadthBar up={item.up} down={item.down} flat={item.flat} />
          <Text style={styles.meta}>{item.members}종목</Text>
          {item.leader ? (
            <Text style={styles.meta} numberOfLines={1}>
              대장 {item.leader.name} <Text style={styles[toneOf(item.leader.chg)]}>{formatChg(item.leader.chg)}</Text>
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1.5), paddingVertical: theme.gap(1.25) },
  rank: { width: 24, textAlign: 'center', fontSize: 14, fontWeight: '700', color: theme.colors.textSecondary },
  body: { flex: 1, gap: theme.gap(0.5) },
  line: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1) },
  name: { flexShrink: 1, fontSize: 15, fontWeight: '700', color: theme.colors.text },
  streak: {
    fontSize: 10, fontWeight: '700', color: theme.colors.up, backgroundColor: theme.colors.upSoft,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, overflow: 'hidden',
  },
  chg: { marginLeft: 'auto', fontSize: 15, fontWeight: '700' },
  meta: { flexShrink: 1, fontSize: 12, color: theme.colors.textSecondary },
  up: { color: theme.colors.up },
  down: { color: theme.colors.down },
  flat: { color: theme.colors.text },
}));
