import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { gameVisible } from '@/features/market-access/access';
import { useGameAccess } from '@/features/market-access/use-game-access';
import { Card } from '@/ui';

/**
 * 홈 중단 '오늘의 실전 투자 교육' — 블로그에서 배운 원칙을 게임·차트 퀴즈로 연습하도록 게임 탭으로 안내(웹과 같은 문구).
 * 두 버튼 모두 게임 탭(/game) — 퀴즈는 게임 화면 안에서 연다(로그인이 필요하면 게임 화면이 안내).
 */
export function HomeGameEduCard() {
  const router = useRouter();
  const goGame = () => router.push('/game');
  // 실제 시세 게임이 열려 있지 않으면(A안 — real_market 거짓·모름) 카드째 숨긴다(게임 탭과 같은 판단값)
  if (!gameVisible(useGameAccess())) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.title} accessibilityRole="header">🎮 오늘의 실전 투자 교육</Text>
      <Card style={styles.card}>
        <Text style={styles.text}>블로그에서 배운 투자 원칙, 실전 차트 게임과 퀴즈로 연습해 보세요.</Text>
        <View style={styles.buttons}>
          <Pressable
            onPress={goGame}
            accessibilityRole="button"
            accessibilityLabel="실시간 모의 트레이딩 하러 가기"
            style={({ pressed }) => [styles.btn, styles.primary, pressed && styles.pressed]}>
            <Text style={styles.primaryLabel}>📈 실시간 모의 트레이딩</Text>
          </Pressable>
          <Pressable
            onPress={goGame}
            accessibilityRole="button"
            accessibilityLabel="10초 차트 퀴즈 하러 가기"
            style={({ pressed }) => [styles.btn, styles.secondary, pressed && styles.pressed]}>
            <Text style={styles.secondaryLabel}>🧩 10초 차트 퀴즈</Text>
          </Pressable>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: { gap: theme.gap(1.5) },
  title: { fontSize: 18, fontWeight: '700', color: theme.colors.text },
  card: { gap: theme.gap(1.5) },
  text: { fontSize: 14, lineHeight: 20, color: theme.colors.text },
  buttons: { gap: theme.gap(1) },
  btn: { minHeight: 48, borderRadius: theme.radius.button, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.gap(2) },
  primary: { backgroundColor: theme.colors.primary },
  secondary: { backgroundColor: theme.colors.fill },
  pressed: { opacity: 0.85 },
  primaryLabel: { fontSize: 15, fontWeight: '700', color: '#ffffff' },
  secondaryLabel: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
}));
