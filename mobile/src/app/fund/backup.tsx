import { Redirect, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { useAuthStore } from '@/features/auth/store';
import { backupNow, hasRemoteBackup, restoreFromDrive, type RestoreResult } from '@/features/fund/backup-service';
import { loadBackupState, resetBackupState, saveBackupState, type BackupState } from '@/features/fund/backup-state';
import { formatChecked } from '@/features/fund/core';
import { isDriveError } from '@/features/fund/drive-backup';
import { connect, disconnect, isBackupConfigured } from '@/features/fund/google-auth';
import { Button, Card, ListState } from '@/ui';

type Busy = '' | 'connect' | 'backup' | 'restore' | 'disconnect';

function errorText(e: unknown): string {
  if (isDriveError(e, 'auth')) return 'Google 연결이 끊겼어요. 다시 연결해 주세요.';
  if (isDriveError(e, 'network')) return '연결을 확인하고 다시 시도해 주세요.';
  return '처리하지 못했어요. 다시 시도해 주세요.';
}

function restoreText(r: RestoreResult): string {
  if (r.status === 'none') return '아직 백업이 없어요.';
  if (r.status === 'invalid') return '백업 파일을 읽을 수 없어요.';
  const skipped = r.skippedFunds ? ` (${r.skippedFunds}개는 등록 한도로 건너뛰었어요)` : '';
  return `펀드 ${r.addedFunds}개 추가, 기록 ${r.mergedPoints}건을 합쳤어요.${skipped}`;
}

// 펀드 기록 백업 — 내 Google Drive 의 앱 전용 공간(Drive 목록에 안 보임). 서버를 거치지 않는다.
export default function FundBackupScreen() {
  const user = useAuthStore((s) => s.user);
  const [state, setState] = useState<BackupState | null>(null);
  const [busy, setBusy] = useState<Busy>('');
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(() => Date.now()); // 렌더 중 Date.now() 호출 금지(react-hooks/purity)

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void loadBackupState().then((s) => {
        if (alive) {
          setState(s);
          setNow(Date.now());
        }
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  if (!user) return <Redirect href="/profile" />;
  if (!isBackupConfigured()) {
    return (
      <View style={styles.flex}>
        <ListState
          mode="empty"
          emoji="⚙️"
          title="백업 설정이 필요해요"
          hint="Google OAuth 클라이언트 ID(EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID)를 넣고 앱을 다시 빌드해 주세요."
        />
      </View>
    );
  }
  if (!state) {
    return (
      <View style={styles.flex}>
        <ListState mode="loading" />
      </View>
    );
  }

  const run = async (kind: Busy, fn: () => Promise<string>) => {
    setBusy(kind);
    setMessage('');
    try {
      setMessage(await fn());
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setState(await loadBackupState());
      setNow(Date.now());
      setBusy('');
    }
  };

  const onRestore = () => run('restore', async () => restoreText(await restoreFromDrive()));

  const onConnect = () =>
    run('connect', async () => {
      const email = await connect();
      if (!email) return '';
      await saveBackupState({ connected: true, email, lastError: '' });
      if (await hasRemoteBackup()) {
        Alert.alert('이전 백업이 있어요', 'Drive 에 저장된 기록을 이 기기로 합칠까요?', [
          { text: '나중에', style: 'cancel' },
          { text: '복원', onPress: () => void onRestore() },
        ]);
        return '연결했어요.';
      }
      await backupNow();
      return '연결했어요. 첫 백업을 마쳤어요.';
    });

  const onBackup = () =>
    run('backup', async () => {
      await backupNow();
      return '백업했어요.';
    });

  const onDisconnect = () =>
    Alert.alert('연결 해제', '자동 백업이 멈춰요. Drive 에 저장된 백업은 남아 있어요.', [
      { text: '취소', style: 'cancel' },
      {
        text: '해제',
        style: 'destructive',
        onPress: () =>
          void run('disconnect', async () => {
            await disconnect();
            await resetBackupState();
            return '연결을 해제했어요.';
          }),
      },
    ]);

  const disabled = busy !== '';
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <Card>
        <Text style={styles.title}>Google Drive 백업</Text>
        <Text style={styles.line}>{state.connected ? state.email : '연결 안 됨'}</Text>
        {state.lastBackupAt ? (
          <Text style={styles.sub}>마지막 백업 {formatChecked(state.lastBackupAt, now)}</Text>
        ) : null}
        {state.lastError ? <Text style={styles.error}>{state.lastError}</Text> : null}
        <Text style={styles.hint}>
          기록은 내 Google Drive 의 앱 전용 공간에 저장돼요. Drive 목록에는 보이지 않고, 새 기록이 생기면 하루 한 번
          자동으로 백업해요.
        </Text>
      </Card>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {state.connected ? (
        <View style={styles.actions}>
          <Button label="지금 백업" onPress={onBackup} loading={busy === 'backup'} disabled={disabled} />
          <Button label="복원" variant="secondary" onPress={onRestore} loading={busy === 'restore'} disabled={disabled} />
          <Button
            label="연결 해제"
            variant="secondary"
            onPress={onDisconnect}
            loading={busy === 'disconnect'}
            disabled={disabled}
          />
        </View>
      ) : (
        <Button label="Google Drive 연결" onPress={onConnect} loading={busy === 'connect'} disabled={disabled} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.gap(2), gap: theme.gap(2) },
  title: { fontSize: 17, fontWeight: '700', color: theme.colors.text, marginBottom: theme.gap(1) },
  line: { fontSize: 15, color: theme.colors.text },
  sub: { fontSize: 13, color: theme.colors.textSecondary, marginTop: theme.gap(0.5) },
  error: { fontSize: 13, color: theme.colors.up, marginTop: theme.gap(0.5) },
  hint: { fontSize: 13, color: theme.colors.textSecondary, marginTop: theme.gap(1.5), lineHeight: 19 },
  message: { fontSize: 14, color: theme.colors.text, textAlign: 'center' },
  actions: { gap: theme.gap(1) },
}));
