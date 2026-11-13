import { Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { useTermsGateOpen } from '@/features/auth/use-terms-gate';
import { BottomSheet, Button } from '@/ui';

/** 첫 펀드 등록 뒤 계정마다 한 번 — 기록은 기기에만 있고 백업 없이 앱을 지우면 사라진다(2026-11-11 설계) */
export function BackupNoticeSheet({ onConnect, onClose }: { onConnect: () => void; onClose: () => void }) {
  // 약관 동의 게이트가 떠 있으면 그리지 않는다(시트 두 장 겹침 방지) — 호출부 상태는 그대로라 동의 뒤에 보인다
  if (useTermsGateOpen()) return null;
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
