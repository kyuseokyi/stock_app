import { useRef, useState } from 'react';
import { Alert, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { BottomSheet, Button, showToast } from '@/ui';

import { discardLegacyFunds, importLegacyFunds } from '../legacy-funds';

type Props = {
  count: number;
  /** 닫기(✕·배경) — 아무것도 바꾸지 않는다. 다음 진입 때 다시 묻는다 */
  onClose: () => void;
  /** 가져오기·버리기를 마침 — 호출부가 목록 다시 읽기·정기 작업·푸시 동기화 */
  onDone: () => void;
};

/** 계정별 저장 전 이 기기에 쌓인 펀드를 지금 계정으로 가져올지 묻는 시트(펀드 목록 화면) */
export function LegacyImportSheet({ count, onClose, onDone }: Props) {
  const [busy, setBusy] = useState<'' | 'import' | 'discard'>('');
  const busyRef = useRef(false); // 연속 탭으로 두 번 실행되지 않게

  const runOnce = async (kind: 'import' | 'discard', fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    try {
      await fn();
      onDone();
    } catch {
      showToast('처리하지 못했어요. 다시 시도해 주세요.');
      busyRef.current = false;
      setBusy('');
    }
  };

  const onImport = () =>
    void runOnce('import', async () => {
      const r = await importLegacyFunds();
      showToast(
        r.skipped > 0
          ? `펀드 ${r.added}개를 가져왔어요. ${r.skipped}개는 등록 한도로 가져오지 못했어요.`
          : `펀드 ${r.added}개를 가져왔어요.`,
      );
    });

  const onDiscard = () =>
    Alert.alert('펀드를 버릴까요?', `이 기기에 저장된 펀드 ${count}개와 쌓인 기록이 지워져요. 되돌릴 수 없어요.`, [
      { text: '취소', style: 'cancel' },
      {
        text: '버리기',
        style: 'destructive',
        onPress: () =>
          void runOnce('discard', async () => {
            await discardLegacyFunds();
            showToast('이 기기에 저장된 펀드를 지웠어요.');
          }),
      },
    ]);

  return (
    <BottomSheet title="저장된 펀드를 가져올까요?" onClose={busy ? () => {} : onClose}>
      <Text style={styles.text}>
        이 기기에 저장된 펀드 {count}개를 이 계정으로 가져올까요? 가져오면 이 계정으로 로그인했을 때만 보여요.
      </Text>
      <Button label="가져오기" onPress={onImport} loading={busy === 'import'} disabled={busy !== ''} />
      <Button
        label="버리기"
        variant="secondary"
        onPress={onDiscard}
        loading={busy === 'discard'}
        disabled={busy !== ''}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  text: { fontSize: 15, color: theme.colors.textSecondary, lineHeight: 22 },
}));
