import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { useAuthStore } from '@/features/auth/store';
import { AmountText, Button, Card, ListRow } from '@/ui';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const logout = useAuthStore((s) => s.logout);

  const [nickname, setNickname] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

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

  if (user) {
    return (
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.screenTitle}>내정보</Text>
        <Card>
          <Text style={styles.nickname}>{user.nickname}</Text>
          <Text style={styles.role}>FREE 등급</Text>
        </Card>

        <Card style={styles.rankCard}>
          <Text style={styles.rankLabel}>🏆 이번 시즌 내 순위</Text>
          <Text style={styles.rankHint}>시즌이 시작되면 순위가 표시돼요</Text>
          <AmountText value={0} kind="pct" size={22} />
        </Card>

        <View style={styles.group}>
          <ListRow title="Streak 출석" subtitle="준비 중" left={<Text style={styles.emoji}>🔥</Text>} disabled />
          <ListRow title="Trading MBTI" subtitle="준비 중" left={<Text style={styles.emoji}>🧬</Text>} disabled />
          <ListRow title="아카데미 (5x 해금)" subtitle="준비 중" left={<Text style={styles.emoji}>🎓</Text>} disabled />
          <ListRow title="지난 시즌 기록" subtitle="준비 중" left={<Text style={styles.emoji}>📜</Text>} disabled />
        </View>

        <Button label="로그아웃" variant="secondary" onPress={logout} />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 24 }]}>
      <Text style={styles.screenTitle}>내정보</Text>
      <Text style={styles.subtitle}>닉네임만으로 시작할 수 있어요.</Text>
      <TextInput
        style={styles.input}
        placeholder="닉네임"
        placeholderTextColor="#8b95a1"
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
    backgroundColor: theme.colors.surface,
  },
  error: { fontSize: 13, color: theme.colors.up },
}));
