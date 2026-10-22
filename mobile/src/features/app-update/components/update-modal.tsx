/**
 * 앱 업데이트 통합 안내(docs/app_update_management_spec.md 5-2) — 하단 시트(디자인 언어: 중앙 팝업 대신 바텀시트).
 * 점검·스토어 강제·OTA 필수는 닫을 수 없다(✕·배경 탭·Android 뒤로가기 차단).
 * 문구는 서버 값 우선, 없으면 기본 한국어 문구.
 */
import { Platform, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { BottomSheet, Button } from '@/ui';

import { isBlockingMode } from '../decide';
import { useAppUpdate } from '../use-app-update';

const DEFAULTS = {
  MAINTENANCE: {
    title: '서비스 점검 안내',
    message: '더 나은 서비스를 위해 점검하고 있어요. 잠시 후 다시 이용해 주세요.',
  },
  STORE_FORCE: {
    title: '필수 업데이트 안내',
    message: '안정적인 이용을 위해 최신 버전으로 업데이트가 필요해요.',
  },
  STORE_RECOMMENDED: {
    title: '새 버전 출시 안내',
    message: '새 버전이 나왔어요. 업데이트하고 더 좋아진 기능을 만나보세요.',
  },
  OTA_MANDATORY: {
    title: '필수 패치 적용',
    message: '중요한 수정 사항이 준비됐어요. 앱을 다시 시작하면 적용돼요.',
  },
  OTA_OPTIONAL: {
    title: '새 버전 다운로드 완료',
    message: '새 기능과 수정 사항이 준비됐어요. 지금 다시 시작할까요?',
  },
} as const;

/** 루트 레이아웃에 한 번 둔다. 띄울 안내가 없으면 아무것도 그리지 않는다 */
export function AppUpdateGate() {
  const { mode, check, dismissStore, openStore, dismissOta, restart, exitApp } = useAppUpdate();
  if (!mode) return null;

  const d = DEFAULTS[mode];
  let title: string = d.title;
  let message: string = d.message;
  if (mode === 'MAINTENANCE') {
    message = check?.maintenance.message ?? d.message;
  } else if (mode === 'STORE_FORCE' || mode === 'STORE_RECOMMENDED') {
    title = check?.store.title ?? d.title;
    message = check?.store.message ?? d.message;
  } else {
    title = check?.ota.title ?? d.title;
    message = check?.ota.message ?? d.message;
  }

  const blocking = isBlockingMode(mode);
  // 닫기 가능한 모드에서 ✕·배경·뒤로가기 = "나중에 하기"
  const onClose = mode === 'STORE_RECOMMENDED' ? () => void dismissStore() : mode === 'OTA_OPTIONAL' ? dismissOta : noop;

  return (
    <BottomSheet title={title} onClose={onClose} dismissible={!blocking}>
      <Text style={styles.message} accessibilityRole="text">
        {message}
      </Text>
      <View style={styles.actions}>
        {mode === 'MAINTENANCE' &&
          (Platform.OS === 'android' ? (
            <Button label="앱 종료" variant="secondary" onPress={exitApp} accessibilityLabel="앱 종료하기" />
          ) : (
            // iOS 는 앱이 스스로 종료할 수 없다 — 안내만
            <Text style={styles.hint}>점검이 끝나면 앱을 다시 열어 주세요.</Text>
          ))}
        {mode === 'STORE_FORCE' && (
          <Button label="스토어에서 업데이트" onPress={() => void openStore()} accessibilityLabel="스토어로 이동해 업데이트하기" />
        )}
        {mode === 'STORE_RECOMMENDED' && (
          <View style={styles.row}>
            <View style={styles.flex}>
              <Button label="나중에 하기" variant="secondary" onPress={onClose} accessibilityLabel="업데이트 안내 하루 동안 숨기기" />
            </View>
            <View style={styles.flex}>
              <Button label="업데이트" onPress={() => void openStore()} accessibilityLabel="스토어로 이동해 업데이트하기" />
            </View>
          </View>
        )}
        {mode === 'OTA_MANDATORY' && (
          <Button label="지금 재시작" onPress={() => void restart()} accessibilityLabel="앱을 지금 재시작해 업데이트 적용하기" />
        )}
        {mode === 'OTA_OPTIONAL' && (
          <View style={styles.row}>
            <View style={styles.flex}>
              <Button
                label="나중에 하기"
                variant="secondary"
                onPress={dismissOta}
                accessibilityLabel="나중에 하기, 다음 실행 때 자동 적용"
              />
            </View>
            <View style={styles.flex}>
              <Button label="지금 재시작" onPress={() => void restart()} accessibilityLabel="앱을 지금 재시작해 업데이트 적용하기" />
            </View>
          </View>
        )}
      </View>
    </BottomSheet>
  );
}

const noop = () => {};

const styles = StyleSheet.create((theme) => ({
  message: { fontSize: 16, lineHeight: 24, color: theme.colors.text },
  hint: { fontSize: 14, color: theme.colors.textSecondary },
  actions: { marginTop: theme.gap(1) },
  row: { flexDirection: 'row', gap: theme.gap(1) },
  flex: { flex: 1 },
}));
