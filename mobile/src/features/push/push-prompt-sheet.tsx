import * as Notifications from 'expo-notifications';
import { useRef } from 'react';
import { Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { BottomSheet, Button } from '@/ui';

import { ensurePushChannels } from './handlers';
import { markPrompted } from './prompt';
import { syncPushRegistration } from './registration';

/** 홈(로그인 후)·펀드 첫 등록·펀드 화면 진입 중 한 번 — [알림 받기] 일 때만 OS 권한을 요청한다 */
export function PushPromptSheet({ onClose }: { onClose: () => void }) {
  const busy = useRef(false); // "알림 받기" 연속 탭으로 accept 가 중복 실행되지 않게
  const accept = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      await ensurePushChannels();
      await Notifications.requestPermissionsAsync();
    } catch {
      // 채널·권한 요청 실패여도 시트는 반드시 닫고 "물어봤음"으로 기록한다
    } finally {
      await markPrompted('accepted');
      void syncPushRegistration();
      onClose();
    }
  };
  const later = () => {
    void markPrompted('declined');
    onClose();
  };
  return (
    <BottomSheet title="새 글·펀드 리포트 알림 받기" onClose={later}>
      <Text style={styles.text}>
        새 글이 올라오거나 펀드 수익률 리포트가 업데이트되면 알림으로 알려드려요. 새 글 알림은 내정보에서 언제든 끌 수 있어요.
      </Text>
      <Button label="알림 받기" onPress={() => void accept()} />
      <Button label="나중에" variant="secondary" onPress={later} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  text: { fontSize: 15, color: theme.colors.textSecondary, lineHeight: 22 },
}));
