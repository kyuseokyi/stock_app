import * as WebBrowser from 'expo-web-browser';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

// 정책 문서는 상용 웹 한 곳에만 둔다(web_client /privacy·/account-deletion) — 개발 앱도 같은 공식 문서를 연다.
// 스토어·소셜 검수에 낸 주소와 같아야 하므로 바꿀 때 함께 바꾼다.
export const PRIVACY_URL = 'https://app.funnotedaily.com/privacy';
export const ACCOUNT_DELETION_URL = 'https://app.funnotedaily.com/account-deletion';

const LINKS = [
  { label: '개인정보처리방침', url: PRIVACY_URL },
  { label: '계정 삭제 안내', url: ACCOUNT_DELETION_URL },
] as const;

export function PolicyLinks() {
  return (
    <View style={styles.row}>
      {LINKS.map((l) => (
        <Pressable
          key={l.url}
          onPress={() => WebBrowser.openBrowserAsync(l.url)}
          hitSlop={8}
          accessibilityRole="link"
          style={styles.link}>
          <Text style={styles.label}>{l.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: 'row', justifyContent: 'center', gap: theme.gap(2), marginTop: theme.gap(2) },
  link: { minHeight: 44, justifyContent: 'center' },
  label: { fontSize: 12, color: theme.colors.textSecondary },
}));
