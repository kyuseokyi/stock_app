// 내정보 "새 글 알림" 스위치 — 설정값은 기기 저장(SecureStore), 바꾸면 등록 동기화로 서버 post_notice 갱신.
// 보이는 값은 설정값 && OS 권한 허용(권한 없으면 실제로 못 받으므로 꺼짐으로 보임)
import * as Notifications from 'expo-notifications';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, Switch, Text } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { ListRow } from '@/ui';

import { isPushConfigured } from './config';
import { ensureFundChannel } from './handlers';
import { loadPostNotice, savePostNotice } from './post-notice';
import { markPrompted } from './prompt';
import { effectivePermission, postNoticeEnableAction, postNoticeSwitchValue } from './prompt-core';
import { syncPushRegistration } from './registration';

export function PostNoticeRow() {
  const { theme } = useUnistyles();
  const [on, setOn] = useState(false); // 읽기 전에는 꺼짐으로 — 권한 없는 기기가 잠깐 켜짐으로 보이지 않게
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true); // 언마운트 뒤 비동기 완료가 setState 하지 않게

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    if (!isPushConfigured()) return () => {};
    let alive = true;
    void Promise.all([loadPostNotice(), Notifications.getPermissionsAsync()])
      .then(([saved, perm]) => {
        if (alive && mounted.current) setOn(postNoticeSwitchValue(saved, effectivePermission(perm)));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useFocusEffect(refresh);

  // 설정 앱에서 권한을 바꾸고 돌아오면 다시 읽는다
  useEffect(() => {
    let cancel = () => {};
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      cancel();
      cancel = refresh();
    });
    return () => {
      cancel();
      sub.remove();
    };
  }, [refresh]);

  if (!isPushConfigured()) return null; // 웹·projectId 없음 — 푸시를 쓰지 않는다

  const toggle = async (next: boolean) => {
    setBusy(true);
    setOn(next);
    try {
      await savePostNotice(next);
      if (next) {
        const action = postNoticeEnableAction(effectivePermission(await Notifications.getPermissionsAsync()));
        if (action === 'request') {
          await ensureFundChannel(); // Android 13+ 는 권한 요청 전에 채널이 있어야 한다
          await Notifications.requestPermissionsAsync();
          await markPrompted('accepted'); // 같은 질문을 홈·펀드 시트로 다시 하지 않게
        } else if (action === 'open-settings') {
          Alert.alert('알림이 꺼져 있어요', '휴대폰 설정에서 이 앱의 알림을 허용해야 새 글 알림을 받을 수 있어요.', [
            { text: '닫기', style: 'cancel' },
            { text: '설정 열기', onPress: () => void Linking.openSettings() },
          ]);
        }
      }
    } catch {
      // 권한·채널 요청 실패여도 설정값은 저장됐다 — 아래 동기화가 다음 기회에 맞춘다
    } finally {
      if (mounted.current) {
        setBusy(false);
        refresh(); // 권한 요청 결과(거부 등)를 스위치에 반영
      }
      void syncPushRegistration();
    }
  };

  return (
    <ListRow
      title="새 글 알림"
      subtitle="새 글이 올라오면 알림으로 알려드려요"
      left={<Text style={styles.emoji}>🔔</Text>}
      right={
        <Switch
          value={on}
          disabled={busy}
          onValueChange={(v) => void toggle(v)}
          trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
          accessibilityLabel="새 글 알림"
        />
      }
    />
  );
}

const styles = StyleSheet.create(() => ({
  emoji: { fontSize: 18 },
}));
