import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { Redirect, Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useAuthStore } from '@/features/auth/store';
import { fundRefresher } from '@/features/fund/auto-refresh';
import { syncBackgroundTasks } from '@/features/fund/background/tasks';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import {
  addFund,
  displayName,
  fundStatusLine,
  isFundError,
  MAX_NAME,
  newFundId,
  readValidCache,
  removeFund,
  useAutoRefreshStatus,
  type FundEntry,
} from '@/features/fund/core';
import { deleteCache, fileCache, loadFunds, saveFunds } from '@/features/fund/fund-store';
import { isBackupConfigured } from '@/features/fund/google-auth';
import { deleteHistory } from '@/features/fund/history-store';
import { Button, Card, ListRow, ListState, showToast } from '@/ui';
import { isPushConfigured } from '@/features/push/config';
import { PushPermissionBanner } from '@/features/push/permission-banner';
import { wasPrompted } from '@/features/push/prompt';
import { effectivePermission, shouldOfferPrompt, shouldPromptOnEnter } from '@/features/push/prompt-core';
import { PushPromptSheet } from '@/features/push/push-prompt-sheet';
import { syncPushRegistration } from '@/features/push/registration';

// 내 펀드 수익 — 기기에 저장한 fund.ivyro.net 펀드 현황 주소 목록(추가·삭제). 서버에는 저장하지 않는다.
export default function FundListScreen() {
  const router = useRouter();
  const { theme } = useUnistyles();
  const user = useAuthStore((s) => s.user);
  const [funds, setFunds] = useState<FundEntry[] | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const status = useAutoRefreshStatus(fundRefresher);
  const [lines, setLines] = useState<Record<string, string>>({});
  const [promptOpen, setPromptOpen] = useState(false);
  const promptOpenRef = useRef(false); // 진입 경로와 첫 추가(0→1) 경로가 같은 시트를 두 번 열지 않게
  promptOpenRef.current = promptOpen;
  // 당겨서 새로고침: 등록된 펀드 리포트를 지금 바로 모두 다시 받는다(끝나면 status.version 이 바뀌어 목록 줄 갱신)
  const { refreshing, onRefresh } = usePullRefresh(() => fundRefresher.run({ force: true }));

  // 목록 한 줄(기준일·확인 시각) — 목록이 바뀌거나 자동 갱신이 끝날 때마다 캐시를 다시 읽는다
  useEffect(() => {
    if (!funds) return;
    let alive = true;
    const now = Date.now();
    void Promise.all(
      funds.map(
        async (f) => [f.id, fundStatusLine(await readValidCache(fileCache, f.id).catch(() => null), now)] as const,
      ),
    ).then((pairs) => {
      if (alive) setLines(Object.fromEntries(pairs));
    });
    return () => {
      alive = false;
    };
  }, [funds, status.version]);

  // 리포트 화면에서 기본 이름이 붙을 수 있어 돌아올 때마다 다시 읽는다
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadFunds()
        .then((l) => {
          if (alive) {
            setFunds(l);
            setLoadError('');
          }
          return l;
        })
        .then(async (l) => {
          // 이미 펀드가 있는 기존 사용자: 시트를 한 번도 못 봤으면 진입 시 1회 안내(2026-10-21 결정)
          if (!l.length || !isPushConfigured()) return;
          // 안내 판단 실패는 목록 읽기 실패가 아니다 — 아래 catch(loadError)로 새지 않게 여기서 삼킨다
          const r = await Promise.all([wasPrompted(), Notifications.getPermissionsAsync()]).catch(() => null);
          if (!r || !alive || promptOpenRef.current) return;
          const [prompted, perm] = r;
          const permission = effectivePermission(perm); // Android 13+ 미요청도 'denied' 로 오므로 canAskAgain 으로 보정
          if (shouldPromptOnEnter({ fundCount: l.length, prompted, permission, configured: true })) {
            setPromptOpen(true);
          }
        })
        .catch(() => {
          // funds 를 null 로 둬서 추가가 막힌다 — 빈 목록으로 저장해 기존 목록을 덮지 않도록
          if (alive) setLoadError('저장된 목록을 읽지 못했어요.');
        });
      return () => {
        alive = false;
      };
    }, []),
  );

  if (!user) return <Redirect href="/profile" />;

  const handleAdd = async () => {
    if (funds === null) return; // 저장된 목록을 읽기 전에 추가하면 목록을 덮어쓴다
    try {
      const next = addFund(funds, { name, url }, newFundId());
      await saveFunds(next);
      setFunds(next);
      setName('');
      setUrl('');
      setError('');
      showToast('펀드를 추가했어요');
      void syncPushRegistration();
      void syncBackgroundTasks();
      const offer = shouldOfferPrompt({
        prevCount: funds.length,
        nextCount: next.length,
        configured: isPushConfigured(),
        prompted: await wasPrompted(),
      });
      if (offer) setPromptOpen(true);
    } catch (e) {
      setError(isFundError(e, 'input') ? e.message : '저장하지 못했어요. 다시 시도해 주세요.');
    }
  };

  const handleRemove = (f: FundEntry) => {
    Alert.alert('펀드 삭제', `${displayName(f)}을(를) 목록에서 지울까요?\n쌓인 기록도 삭제됩니다.`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          if (funds === null) return;
          const next = removeFund(funds, f.id);
          void saveFunds(next).then(() => {
            deleteCache(f.id);
            deleteHistory(f.id);
            setFunds(next);
            void syncPushRegistration(); // 마지막 펀드를 지우면 펀드 알림만 끔(fund_notice=false) — 새 글 알림 등록은 유지
            void syncBackgroundTasks();
          });
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.headerActions}>
              {status.running ? <ActivityIndicator /> : null}
              <Pressable
                onPress={() => router.push('/fund/backup')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="기록 백업"
              >
                <Ionicons name="cloud-upload-outline" size={20} color={theme.colors.text} />
              </Pressable>
            </View>
          ),
        }}
      />
      <PushPermissionBanner />
      <Card>
        <Text style={styles.label}>펀드 현황 주소</Text>
        <TextInput
          value={url}
          onChangeText={setUrl}
          placeholder="https://fund.ivyro.net/dataroom/om_data/…"
          placeholderTextColor={theme.colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={styles.input}
        />
        <Text style={styles.label}>이름 (선택)</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="비우면 투자자 번호로 정해져요"
          placeholderTextColor={theme.colors.textSecondary}
          maxLength={MAX_NAME}
          style={styles.input}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="추가" onPress={handleAdd} disabled={funds === null || !url.trim()} />
      </Card>

      {funds === null && loadError ? (
        <Text style={styles.error}>{loadError}</Text>
      ) : funds === null ? (
        <ListState mode="loading" />
      ) : funds.length === 0 ? (
        <View style={styles.emptyBox}>
          <ListState
            mode="empty"
            emoji="💰"
            title="등록한 펀드가 없어요"
            hint="fund.ivyro.net 에서 받은 내 펀드 현황 주소를 붙여 넣어 주세요."
          />
          {isBackupConfigured() ? (
            <Button label="Google Drive에서 복원" variant="secondary" onPress={() => router.push('/fund/backup')} />
          ) : null}
        </View>
      ) : (
        <View style={styles.group}>
          {funds.map((f) => (
            <ListRow
              key={f.id}
              title={displayName(f)}
              subtitle={lines[f.id] || '탭해서 수익 보기'}
              left={<Text style={styles.emoji}>📈</Text>}
              right={
                <Pressable onPress={() => handleRemove(f)} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.remove}>삭제</Text>
                </Pressable>
              }
              onPress={() => router.push(`/fund/${f.id}`)}
            />
          ))}
        </View>
      )}
      {promptOpen ? <PushPromptSheet onClose={() => setPromptOpen(false)} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1, backgroundColor: theme.colors.background },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(2) },
  content: { padding: theme.gap(2), gap: theme.gap(2) },
  label: { fontSize: 13, color: theme.colors.textSecondary, marginBottom: theme.gap(0.5) },
  input: {
    backgroundColor: theme.colors.fill,
    borderRadius: theme.radius.input,
    paddingHorizontal: theme.gap(1.5),
    paddingVertical: theme.gap(1.5),
    fontSize: 15,
    color: theme.colors.text,
    marginBottom: theme.gap(1.5),
  },
  error: { color: theme.colors.up, fontSize: 13, marginBottom: theme.gap(1) },
  group: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, overflow: 'hidden' },
  emptyBox: { gap: theme.gap(1.5) },
  emoji: { fontSize: 20 },
  remove: { color: theme.colors.textSecondary, fontSize: 13 },
}));
