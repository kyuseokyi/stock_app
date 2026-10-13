import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Sheet } from '@/features/game/components/sheet';
import { ApiError } from '@/lib/api';
import { Button } from '@/ui';

import { DELETE_ACCOUNT_NOTICES, deleteAccountErrorMessage } from './delete-account';
import { useAuthStore } from './store';

type Props = {
  onClose: () => void;
  /** 탈퇴 성공(이미 로그아웃됨) — 호출부가 시트 닫기·홈 이동·토스트 */
  onDeleted: () => void;
};

/** 회원 탈퇴 확인 시트 — 열 때 마운트·닫을 때 언마운트(Sheet 패턴) */
export function DeleteAccountSheet({ onClose, onDeleted }: Props) {
  const { theme } = useUnistyles();
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    setSubmitting(true);
    setError('');
    try {
      await deleteAccount();
      onDeleted();
    } catch (e) {
      setSubmitting(false);
      setError(
        e instanceof ApiError
          ? deleteAccountErrorMessage(e.status, e.body)
          : deleteAccountErrorMessage(undefined, undefined),
      );
    }
  };

  return (
    <Sheet title="회원 탈퇴" onClose={submitting ? () => {} : onClose}>
      <View style={styles.notices}>
        {DELETE_ACCOUNT_NOTICES.map((text) => (
          <View key={text} style={styles.noticeRow}>
            <Text style={styles.bullet}>•</Text>
            <Text style={styles.noticeText}>{text}</Text>
          </View>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        onPress={handleDelete}
        disabled={submitting}
        accessibilityRole="button"
        accessibilityState={{ disabled: submitting }}
        style={({ pressed }) => [
          styles.danger,
          pressed && !submitting && styles.pressed,
          submitting && styles.disabled,
        ]}>
        {submitting ? (
          <ActivityIndicator color={theme.colors.up} />
        ) : (
          <Text style={styles.dangerLabel}>탈퇴하기</Text>
        )}
      </Pressable>
      <Button label="취소" variant="secondary" onPress={onClose} disabled={submitting} />
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  notices: {
    gap: theme.gap(1.25),
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.card,
    padding: theme.gap(2),
    marginBottom: theme.gap(1),
  },
  noticeRow: { flexDirection: 'row', gap: theme.gap(1) },
  bullet: { fontSize: 14, lineHeight: 21, color: theme.colors.textSecondary },
  noticeText: { flex: 1, fontSize: 14, lineHeight: 21, color: theme.colors.text },
  error: { fontSize: 13, color: theme.colors.up },
  danger: {
    height: 56,
    alignSelf: 'stretch',
    borderRadius: theme.radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.upSoft,
  },
  dangerLabel: { fontSize: 16, fontWeight: '700', color: theme.colors.up },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
}));
