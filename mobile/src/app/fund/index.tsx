import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useAuthStore } from '@/features/auth/store';
import {
  addFund,
  displayName,
  isFundError,
  MAX_NAME,
  newFundId,
  removeFund,
  type FundEntry,
} from '@/features/fund/core';
import { deleteCache, loadFunds, saveFunds } from '@/features/fund/fund-store';
import { Button, Card, ListRow, ListState, showToast } from '@/ui';

// 내 펀드 수익 — 기기에 저장한 fund.ivyro.net 펀드 현황 주소 목록(추가·삭제). 서버에는 저장하지 않는다.
export default function FundListScreen() {
  const router = useRouter();
  const { theme } = useUnistyles();
  const user = useAuthStore((s) => s.user);
  const [funds, setFunds] = useState<FundEntry[] | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  // 리포트 화면에서 기본 이름이 붙을 수 있어 돌아올 때마다 다시 읽는다
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void loadFunds().then((l) => {
        if (alive) setFunds(l);
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  if (!user) return <Redirect href="/profile" />;

  const handleAdd = async () => {
    try {
      const next = addFund(funds ?? [], { name, url }, newFundId());
      await saveFunds(next);
      setFunds(next);
      setName('');
      setUrl('');
      setError('');
      showToast('펀드를 추가했어요');
    } catch (e) {
      setError(isFundError(e, 'input') ? e.message : '저장하지 못했어요. 다시 시도해 주세요.');
    }
  };

  const handleRemove = (f: FundEntry) => {
    Alert.alert('펀드 삭제', `${displayName(f)}을(를) 목록에서 지울까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          const next = removeFund(funds ?? [], f.id);
          void saveFunds(next).then(() => {
            deleteCache(f.id);
            setFunds(next);
          });
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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
        <Button label="추가" onPress={handleAdd} disabled={!url.trim()} />
      </Card>

      {funds === null ? (
        <ListState mode="loading" />
      ) : funds.length === 0 ? (
        <ListState
          mode="empty"
          emoji="💰"
          title="등록한 펀드가 없어요"
          hint="fund.ivyro.net 에서 받은 내 펀드 현황 주소를 붙여 넣어 주세요."
        />
      ) : (
        <View style={styles.group}>
          {funds.map((f) => (
            <ListRow
              key={f.id}
              title={displayName(f)}
              subtitle="탭해서 수익 보기"
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
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1, backgroundColor: theme.colors.background },
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
  emoji: { fontSize: 20 },
  remove: { color: theme.colors.textSecondary, fontSize: 13 },
}));
