import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { Pressable } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

/**
 * 헤더 뒤로가기 — iOS·Android 모양을 같게(글자 없는 꺾쇠, 터치 영역 44).
 * 네이티브 기본 버튼은 플랫폼마다 모양이 다르고, 푸시·딥링크로 바로 열면(스택이 이 화면뿐) 아예 나오지 않는다
 * → 돌아갈 화면이 없으면 fallback 으로 보낸다. iOS 스와이프·Android 시스템 뒤로가기는 그대로 동작한다.
 * fallback 이 함수면 누를 때 계산한다(관리자 스위치처럼 값이 바뀌는 경우).
 */
export function HeaderBack({ fallback }: { fallback: Href | (() => Href) }) {
  const { theme } = useUnistyles();
  const onPress = () => {
    if (router.canGoBack()) router.back();
    else router.replace(typeof fallback === 'function' ? fallback() : fallback);
  };
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="뒤로 가기"
      hitSlop={8}
      style={{ width: 44, height: 44, marginLeft: -12, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="chevron-back" size={26} color={theme.colors.text} />
    </Pressable>
  );
}
