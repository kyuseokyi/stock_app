import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { getSocialProviders, type SocialProvider, type SocialProviders } from '@/features/auth/api';
import { DeleteAccountSheet } from '@/features/auth/delete-account-sheet';
import { socialErrorMessage } from '@/features/auth/return-url';
import { startSocialLogin } from '@/features/auth/social';
import { SocialButton } from '@/features/auth/social-button';
import { useAuthStore } from '@/features/auth/store';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { ENV } from '@/lib/env';
import { Button, Card, ListRow, showToast } from '@/ui';

const SOCIAL_PROVIDERS: SocialProvider[] = ['kakao', 'naver'];

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useUnistyles();
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const loginWithToken = useAuthStore((s) => s.loginWithToken);
  const logout = useAuthStore((s) => s.logout);

  const [nickname, setNickname] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [providers, setProviders] = useState<SocialProviders | null>(null);
  const [pendingProvider, setPendingProvider] = useState<SocialProvider | null>(null);
  const [socialError, setSocialError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const router = useRouter();

  // 비로그인일 때 간편 로그인 공급자 활성 여부 조회(키 미설정 공급자는 버튼 숨김)
  useEffect(() => {
    if (user) return;
    let alive = true;
    getSocialProviders()
      .then((p) => {
        if (alive) setProviders(p);
      })
      .catch(() => {
        if (alive) setProviders({ kakao: false, naver: false });
      });
    return () => {
      alive = false;
    };
  }, [user]);

  const handleSocialLogin = async (provider: SocialProvider) => {
    setPendingProvider(provider);
    setSocialError('');
    try {
      const outcome = await startSocialLogin(provider);
      if (outcome.type === 'success') loginWithToken(outcome.result);
      else if (outcome.type === 'error') setSocialError(socialErrorMessage(outcome.error));
      // cancel(사용자가 닫음·취소)은 조용히 무시
    } catch {
      setSocialError('로그인에 실패했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setPendingProvider(null);
    }
  };

  const handleLogin = async () => {
    const trimmed = nickname.trim();
    if (!trimmed) {
      setError('닉네임을 입력해 주세요.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await login(trimmed);
      setNickname('');
    } catch {
      setError('로그인에 실패했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  // 탈퇴 성공(스토어가 이미 로그아웃) → 시트 닫기·홈 탭 이동·토스트
  const handleDeleted = () => {
    setDeleteOpen(false);
    router.navigate('/');
    showToast('탈퇴가 완료됐어요');
  };

  // 당겨서 새로고침: 로그인 상태면 서버에 세션·내 정보를 다시 확인, 아니면 간편 로그인 공급자를 다시 조회
  const { refreshing, onRefresh } = usePullRefresh(async () => {
    if (user) {
      await useAuthStore.getState().validateSession(true);
      return;
    }
    setProviders(await getSocialProviders());
  });

  const visibleProviders = SOCIAL_PROVIDERS.filter((p) => providers?.[p] === true);

  if (user) {
    return (
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 24 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <Text style={styles.screenTitle}>내정보</Text>
        <Card>
          <Text style={styles.nickname}>{user.nickname}</Text>
          <Text style={styles.role}>{user.role} 등급</Text>
        </Card>

        <Card style={styles.rankCard}>
          <Text style={styles.rankLabel}>🏆 이번 시즌 내 순위</Text>
          <Text style={styles.rankHint}>시즌이 시작되면 순위가 표시돼요</Text>
        </Card>

        <View style={styles.group}>
          <ListRow
            title="내 펀드 수익"
            subtitle="fund.ivyro.net 펀드 현황"
            left={<Text style={styles.emoji}>💰</Text>}
            onPress={() => router.push('/fund')}
          />
        </View>

        <View style={styles.group}>
          <ListRow title="Streak 출석" subtitle="준비 중" left={<Text style={styles.emoji}>🔥</Text>} disabled />
          <ListRow title="Trading MBTI" subtitle="준비 중" left={<Text style={styles.emoji}>🧬</Text>} disabled />
          <ListRow title="아카데미 (5x 해금)" subtitle="준비 중" left={<Text style={styles.emoji}>🎓</Text>} disabled />
          <ListRow title="지난 시즌 기록" subtitle="준비 중" left={<Text style={styles.emoji}>📜</Text>} disabled />
        </View>

        <Button label="로그아웃" variant="secondary" onPress={logout} />
        <Pressable
          onPress={() => setDeleteOpen(true)}
          hitSlop={8}
          accessibilityRole="button"
          style={styles.withdraw}>
          <Text style={styles.withdrawLabel}>회원 탈퇴</Text>
        </Pressable>
        {deleteOpen ? (
          <DeleteAccountSheet onClose={() => setDeleteOpen(false)} onDeleted={handleDeleted} />
        ) : null}
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 24 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <Text style={styles.screenTitle}>내정보</Text>
      <Text style={styles.subtitle}>간편 로그인으로 시작해 보세요.</Text>
      {visibleProviders.map((p) => (
        <SocialButton
          key={p}
          provider={p}
          loading={pendingProvider === p}
          disabled={pendingProvider !== null}
          onPress={() => handleSocialLogin(p)}
        />
      ))}
      {providers && visibleProviders.length === 0 && !ENV.enableGuestLogin ? (
        <Text style={styles.subtitle}>로그인을 준비하고 있어요.</Text>
      ) : null}
      {socialError ? <Text style={styles.error}>{socialError}</Text> : null}

      {ENV.enableGuestLogin ? (
        <View style={styles.guest}>
          <Text style={styles.guestLabel}>개발용 닉네임 로그인</Text>
          <TextInput
            style={styles.input}
            placeholder="닉네임"
            placeholderTextColor={theme.colors.textSecondary}
            value={nickname}
            onChangeText={setNickname}
            editable={!submitting}
            maxLength={20}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={handleLogin}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label="시작하기" loading={submitting} onPress={handleLogin} />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.gap(2.5), gap: theme.gap(1.5) },
  screenTitle: { fontSize: 24, fontWeight: '700', color: theme.colors.text },
  subtitle: { fontSize: 14, color: theme.colors.textSecondary },
  nickname: { fontSize: 18, fontWeight: '700', color: theme.colors.text },
  role: { fontSize: 13, color: theme.colors.textSecondary },
  rankCard: { backgroundColor: theme.colors.primarySoft },
  rankLabel: { fontSize: 14, fontWeight: '600', color: theme.colors.primary },
  rankHint: { fontSize: 13, color: theme.colors.textSecondary },
  group: { gap: 0 },
  emoji: { fontSize: 18 },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.input,
    paddingVertical: theme.gap(1.5),
    paddingHorizontal: theme.gap(2),
    fontSize: 16,
    color: theme.colors.text,
    backgroundColor: theme.colors.fill,
  },
  error: { fontSize: 13, color: theme.colors.up },
  guest: {
    gap: theme.gap(1.5),
    marginTop: theme.gap(1.5),
    paddingTop: theme.gap(2),
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  guestLabel: { fontSize: 13, color: theme.colors.textSecondary },
  withdraw: { alignSelf: 'center', paddingVertical: theme.gap(1) },
  withdrawLabel: { fontSize: 13, color: theme.colors.textSecondary, textDecorationLine: 'underline' },
}));
