import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { isApiBusy, subscribeApiBusy } from '@/lib/api/activity';

/** 이보다 빨리 끝난 요청은 표시하지 않는다(짧은 요청·주기 조회마다 깜빡이지 않게) */
export const SHOW_DELAY_MS = 200;
const SEGMENT_RATIO = 0.35; // 움직이는 막대 길이(화면 너비 대비)
const LOOP_MS = 1100;

/** API 요청이 진행 중이면 상태바 바로 아래 얇은 진행 표시줄(좌→우 반복). 루트 레이아웃에 한 번 둔다. */
export function ApiProgressBar() {
  const [visible, setVisible] = useState(false);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const x = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChange = (busy: boolean) => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (busy) timer = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
      else setVisible(false);
    };
    onChange(isApiBusy());
    const unsub = subscribeApiBusy(onChange);
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    x.setValue(0);
    const loop = Animated.loop(
      Animated.timing(x, { toValue: 1, duration: LOOP_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, x]);

  if (!visible) return null;
  const segment = width * SEGMENT_RATIO;
  const translateX = x.interpolate({ inputRange: [0, 1], outputRange: [-segment, width] });
  return (
    <View
      pointerEvents="none"
      accessibilityRole="progressbar"
      accessibilityLabel="불러오는 중"
      style={[styles.track, { top: insets.top }]}
    >
      <Animated.View style={[styles.bar, { width: segment, transform: [{ translateX }] }]} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  track: { position: 'absolute', left: 0, right: 0, height: 3, overflow: 'hidden', zIndex: 100 },
  bar: { height: 3, borderRadius: 2, backgroundColor: theme.colors.primary },
}));
