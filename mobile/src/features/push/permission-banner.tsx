import * as Notifications from 'expo-notifications';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { isPushConfigured } from './config';
import { dismissBanner, isBannerDismissed } from './prompt';

/** 알림 권한이 거부돼 있으면 펀드 목록 위에 안내(닫으면 다시 안 보임) */
export function PushPermissionBanner() {
  const [show, setShow] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!isPushConfigured()) return;
      let alive = true;
      void Promise.all([Notifications.getPermissionsAsync(), isBannerDismissed()]).then(([p, dismissed]) => {
        if (alive) setShow(p.status === 'denied' && !dismissed);
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  if (!show) return null;
  return (
    <View style={styles.box}>
      <Pressable style={styles.flex} onPress={() => void Linking.openSettings()} accessibilityRole="button">
        <Text style={styles.text}>알림이 꺼져 있어요 · 설정 열기</Text>
      </Pressable>
      <Pressable
        onPress={() => {
          void dismissBanner();
          setShow(false);
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="알림 안내 닫기"
      >
        <Text style={styles.close}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.gap(1),
    backgroundColor: theme.colors.fill,
    borderRadius: theme.radius.card,
    padding: theme.gap(1.5),
  },
  flex: { flex: 1 },
  text: { fontSize: 14, color: theme.colors.text },
  close: { fontSize: 14, color: theme.colors.textSecondary },
}));
