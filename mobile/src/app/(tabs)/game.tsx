import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { Button, Card, Chip, ListState } from '@/ui';

export default function GameScreen() {
  const insets = useSafeAreaInsets();
  // 백엔드 미연동 — 시즌 없음 상태로 고정(스켈레톤)
  const seasonReady: boolean = false;

  if (!seasonReady) {
    return (
      <View style={[styles.flex, { paddingTop: insets.top }]}>
        <Text style={styles.header}>트레이딩 게임</Text>
        <ListState
          mode="empty"
          emoji="🎮"
          title="시즌을 준비하고 있어요"
          hint="곧 실시간 가상 트레이딩이 열려요. 조금만 기다려 주세요!"
        />
      </View>
    );
  }

  // 아래는 추후 실시간 데이터로 교체될 주문 패널 미리보기(현재 도달 불가)
  return (
    <ScrollView style={styles.flex} contentContainerStyle={{ paddingTop: insets.top + 16, padding: 16, gap: 12 }}>
      <Text style={styles.header}>트레이딩 게임</Text>
      <Card>
        <Text style={styles.cardTitle}>주문 패널 (미리보기)</Text>
        <View style={styles.chips}>
          <Chip label="25%" onPress={() => {}} />
          <Chip label="50%" onPress={() => {}} />
          <Chip label="100%" selected onPress={() => {}} />
        </View>
        <View style={styles.chips}>
          <Chip label="1x" selected onPress={() => {}} />
          <Chip label="2x" onPress={() => {}} />
          <Chip label="5x 🔒" onPress={() => {}} />
        </View>
        <Button label="🔴 BUY (상승 베팅)" onPress={() => {}} />
        <Button label="🔵 SELL (하락 베팅)" variant="secondary" onPress={() => {}} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    fontSize: 24,
    fontWeight: '700',
    color: theme.colors.text,
    paddingHorizontal: theme.gap(2.5),
    paddingTop: theme.gap(2),
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.text, marginBottom: theme.gap(1) },
  chips: { flexDirection: 'row', gap: theme.gap(1), marginBottom: theme.gap(1) },
}));
