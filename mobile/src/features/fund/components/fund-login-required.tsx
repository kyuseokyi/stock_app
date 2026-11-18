import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Button, Card } from '@/ui';

import { FUND_LOGIN_DESCRIPTION, FUND_LOGIN_TITLE, LOGIN_PATH } from '../fund-gate';

/**
 * 비로그인으로 내 펀드 화면(탭 /funds, 스택 /fund — 딥링크 포함)에 들어왔을 때 화면 가운데 안내 카드.
 * 다른 화면으로 튕기지 않고 [로그인하러 가기]로 내정보(로그인)에 보낸다. 시트와 같은 문구.
 */
export function FundLoginRequired() {
  return (
    <View style={styles.center}>
      <Card style={styles.card}>
        <Text style={styles.emoji} accessibilityElementsHidden importantForAccessibility="no">
          🔒
        </Text>
        <Text style={styles.title} accessibilityRole="header">
          {FUND_LOGIN_TITLE}
        </Text>
        <Text style={styles.text}>{FUND_LOGIN_DESCRIPTION}</Text>
        <View style={styles.action}>
          <Button label="로그인하러 가기" onPress={() => router.push(LOGIN_PATH)} />
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  center: { flex: 1, justifyContent: 'center', padding: theme.gap(2.5) },
  card: { alignItems: 'center', paddingVertical: theme.gap(3), gap: theme.gap(1) },
  emoji: { fontSize: 36 },
  title: { fontSize: 18, fontWeight: '700', color: theme.colors.text },
  text: { fontSize: 15, lineHeight: 22, color: theme.colors.textSecondary, textAlign: 'center' },
  action: { alignSelf: 'stretch', marginTop: theme.gap(1.5) },
}));
