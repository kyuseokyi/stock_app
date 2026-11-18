import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

/**
 * 탭 화면 상단 오른쪽 '내정보' 버튼 — 하단 탭에서 내정보를 뺀 대신 어디서든 /profile(내정보·로그인)로 간다.
 * 탭 화면은 헤더를 숨기고(headerShown:false) 화면 안에 제목을 그리므로 각 화면의 제목 줄 오른쪽 끝에 둔다.
 * 터치 영역 44×44(WCAG 2.2 AA).
 */
export function ProfileHeaderButton() {
  const { theme } = useUnistyles();
  return (
    <Pressable
      onPress={() => router.push('/profile')}
      accessibilityRole="button"
      accessibilityLabel="내정보"
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <Ionicons name="person-circle-outline" size={28} color={theme.colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginRight: -8 },
  pressed: { opacity: 0.6 },
});
