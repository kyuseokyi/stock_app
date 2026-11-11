import { Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { BottomSheet, Button } from '@/ui';

/** 첫 펀드 등록 뒤 계정마다 한 번 — 기록은 기기에만 있고 백업 없이 앱을 지우면 사라진다(2026-11-11 설계) */
export function BackupNoticeSheet({ onConnect, onClose }: { onConnect: () => void; onClose: () => void }) {
  return (
    <BottomSheet title="기록은 이 폰에만 저장돼요" onClose={onClose}>
      <Text style={styles.text}>Google Drive에 백업해 두면 앱을 지우거나 폰을 바꿔도 기록을 되살릴 수 있어요.</Text>
      <Button label="백업 연결" onPress={onConnect} />
      <Button label="나중에" variant="secondary" onPress={onClose} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  text: { fontSize: 15, color: theme.colors.textSecondary, lineHeight: 22 },
}));
