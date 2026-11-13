import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { useAppUpdateBlocking } from '@/features/app-update/use-app-update';
import { PRIVACY_URL, TERMS_URL } from '@/features/legal/policy-links';
import { ApiError } from '@/lib/api';
import { BottomSheet, Button, showToast } from '@/ui';

import { useAuthStore } from './store';
import { agreeTermsErrorMessage, TERMS_DECLINED_MESSAGE, TERMS_SUMMARY } from './terms';
import { useTermsGateOpen } from './use-terms-gate';

/**
 * 약관 동의 게이트 — 루트 레이아웃에 한 번 둔다. 로그인 사용자가 현재 약관에 동의하지 않았으면 닫을 수 없는 시트.
 * 점검·강제 업데이트 안내(차단 모드)가 떠 있으면 그쪽이 우선 — 그동안은 그리지 않는다(시트 두 장 겹침 방지).
 */
export function TermsGate() {
  const open = useTermsGateOpen();
  const updateBlocking = useAppUpdateBlocking();
  if (!open || updateBlocking) return null;
  return <TermsGateSheet />;
}

/** 열 때 마운트·닫힐 때 언마운트 — 오류·진행 상태가 다음 열림에 남지 않게 */
function TermsGateSheet() {
  const agreeTerms = useAuthStore((s) => s.agreeTerms);
  const logout = useAuthStore((s) => s.logout);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const agree = async () => {
    setSubmitting(true);
    setError('');
    try {
      await agreeTerms(); // 성공하면 user.termsRequired=false → 게이트가 언마운트된다
    } catch (e) {
      // 토스트는 Modal 뒤에 그려져 안 보이므로 시트 안에 문구를 둔다. 시트는 닫지 않고 다시 시도할 수 있다
      setError(agreeTermsErrorMessage(e instanceof ApiError ? e.status : undefined));
      setSubmitting(false);
    }
  };

  const decline = () => {
    logout(); // user=null → 게이트가 사라진 뒤 토스트가 보인다
    showToast(TERMS_DECLINED_MESSAGE);
  };

  return (
    <BottomSheet title="FunNote 이용약관에 동의해 주세요" onClose={noop} dismissible={false}>
      <View style={styles.summary}>
        {TERMS_SUMMARY.map((text) => (
          <View key={text} style={styles.row}>
            <Text style={styles.bullet}>•</Text>
            <Text style={styles.text}>{text}</Text>
          </View>
        ))}
      </View>
      <View style={styles.links}>
        <Pressable
          onPress={() => void WebBrowser.openBrowserAsync(TERMS_URL)}
          hitSlop={8}
          accessibilityRole="link"
          style={styles.link}>
          <Text style={styles.linkLabel}>이용약관 보기</Text>
        </Pressable>
        <Pressable
          onPress={() => void WebBrowser.openBrowserAsync(PRIVACY_URL)}
          hitSlop={8}
          accessibilityRole="link"
          style={styles.link}>
          <Text style={styles.linkLabel}>개인정보처리방침 보기</Text>
        </Pressable>
      </View>
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button label="동의하고 시작하기" loading={submitting} onPress={() => void agree()} />
      <Button label="동의하지 않음" variant="secondary" disabled={submitting} onPress={decline} />
    </BottomSheet>
  );
}

const noop = () => {};

const styles = StyleSheet.create((theme) => ({
  summary: {
    gap: theme.gap(1.25),
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.card,
    padding: theme.gap(2),
  },
  row: { flexDirection: 'row', gap: theme.gap(1) },
  bullet: { fontSize: 14, lineHeight: 21, color: theme.colors.textSecondary },
  text: { flex: 1, fontSize: 14, lineHeight: 21, color: theme.colors.text },
  links: { flexDirection: 'row', justifyContent: 'center', columnGap: theme.gap(3) },
  link: { minHeight: 44, justifyContent: 'center' },
  linkLabel: { fontSize: 13, color: theme.colors.textSecondary, textDecorationLine: 'underline' },
  error: { fontSize: 13, color: theme.colors.up },
}));
