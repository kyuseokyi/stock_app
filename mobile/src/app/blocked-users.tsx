import { Redirect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { useAuthStore } from '@/features/auth/store';
import { blockedName, commentErrorMessage, TOAST_UNBLOCKED } from '@/features/blog/comment-actions';
import { fetchBlocks, unblockUser } from '@/features/blog/comments-api';
import type { BlockedUser } from '@/features/blog/types';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { ApiError } from '@/lib/api';
import { ListState, showToast } from '@/ui';

type State = { data: BlockedUser[]; loading: boolean; error: boolean };

// 내정보 › 차단한 사용자 — 목록 + [해제](확인 없이 바로 해제 후 토스트). 로그인 사용자만.
export default function BlockedUsersScreen() {
  const loggedIn = useAuthStore((s) => s.token !== null && s.user !== null);
  const [state, setState] = useState<State>({ data: [], loading: true, error: false });
  const [pending, setPending] = useState<number | null>(null); // 해제 중인 user_id

  const fetchInto = useCallback(
    () =>
      fetchBlocks().then(
        (data) => setState({ data, loading: false, error: false }),
        () => setState({ data: [], loading: false, error: true }),
      ),
    [],
  );

  const retry = () => {
    setState({ data: [], loading: true, error: false });
    void fetchInto();
  };

  useEffect(() => {
    if (loggedIn) void fetchInto();
  }, [loggedIn, fetchInto]);

  const { refreshing, onRefresh } = usePullRefresh(async () => {
    setState({ data: await fetchBlocks(), loading: false, error: false });
  });

  const handleUnblock = async (userId: number) => {
    setPending(userId);
    try {
      await unblockUser(userId);
      setState((s) => ({ ...s, data: s.data.filter((b) => b.userId !== userId) }));
      showToast(TOAST_UNBLOCKED);
    } catch (e) {
      showToast(commentErrorMessage('unblock', e instanceof ApiError ? e.status : undefined, e instanceof ApiError ? e.body : undefined));
    } finally {
      setPending(null);
    }
  };

  if (!loggedIn) return <Redirect href="/profile" />;
  if (state.loading) return <ListState mode="loading" />;
  if (state.error) return <ListState mode="error" onRetry={retry} />;

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      {state.data.length === 0 ? (
        <ListState mode="empty" title="차단한 사용자가 없어요" hint="댓글 ⋯ 메뉴에서 사용자를 차단할 수 있어요." />
      ) : (
        <>
          <Text style={styles.hint}>차단한 사용자의 댓글은 보이지 않아요.</Text>
          {state.data.map((b) => (
            <View key={b.userId} style={styles.row}>
              <Text style={styles.name} numberOfLines={1}>
                {blockedName(b.nickname)}
              </Text>
              <Pressable
                onPress={() => handleUnblock(b.userId)}
                disabled={pending !== null}
                accessibilityRole="button"
                accessibilityLabel={`${blockedName(b.nickname)} 차단 해제`}
                style={({ pressed }) => [styles.unblock, (pressed || pending === b.userId) && styles.pressed]}>
                <Text style={styles.unblockLabel}>{pending === b.userId ? '해제 중…' : '해제'}</Text>
              </Pressable>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1, backgroundColor: theme.colors.background },
  content: { flexGrow: 1, padding: theme.gap(2.5), gap: theme.gap(1) },
  hint: { fontSize: 13, color: theme.colors.textSecondary, marginBottom: theme.gap(0.5) },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.gap(1.5),
    paddingHorizontal: theme.gap(2),
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.surface,
  },
  name: { flex: 1, fontSize: 16, fontWeight: '600', color: theme.colors.text },
  unblock: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: theme.gap(1.75),
    borderRadius: theme.radius.chip,
    backgroundColor: theme.colors.fill,
  },
  pressed: { opacity: 0.6 },
  unblockLabel: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
}));
