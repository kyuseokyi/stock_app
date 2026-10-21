import * as Notifications from 'expo-notifications';
import { Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { BottomSheet, Button } from '@/ui';

import { ensureFundChannel } from './handlers';
import { markPrompted } from './prompt';
import { syncPushRegistration } from './registration';

/** 펀드 첫 등록 직후 한 번 — [알림 받기] 일 때만 OS 권한을 요청한다 */
export function PushPromptSheet({ onClose }: { onClose: () => void }) {
  const accept = async () => {
    await ensureFundChannel();
    await Notifications.requestPermissionsAsync();
    await markPrompted('accepted');
    void syncPushRegistration();
    onClose();
  };
  const later = () => {
    void markPrompted('declined');
    onClose();
  };
  return (
    <BottomSheet title="리포트가 올라오면 알려드릴까요?" onClose={later}>
      <Text style={styles.text}>매일 수익률 리포트가 업데이트되면 알림으로 알려드려요. 설정에서 언제든 끌 수 있어요.</Text>
      <Button label="알림 받기" onPress={() => void accept()} />
      <Button label="나중에" variant="secondary" onPress={later} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  text: { fontSize: 15, color: theme.colors.textSecondary, lineHeight: 22 },
}));
