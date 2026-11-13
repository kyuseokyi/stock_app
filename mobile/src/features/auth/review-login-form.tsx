import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { ApiError } from '@/lib/api';
import { Button } from '@/ui';

import { useAuthStore } from './store';
import { reviewLoginErrorMessage } from './terms';

/**
 * 스토어 심사용 로그인 폼 — 내정보(비로그인) 버전 표시를 3초 안에 7번 누르면 나타난다.
 * 일반 로그인보다 눈에 띄지 않게 작은 글씨·보조 버튼. 성공하면 간편 로그인과 같은 저장 경로(loginWithToken).
 */
export function ReviewLoginForm() {
  const { theme } = useUnistyles();
  const reviewLogin = useAuthStore((s) => s.reviewLogin);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!email.trim() || !password) {
      setError('이메일과 비밀번호를 입력해 주세요');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await reviewLogin(email.trim(), password);
      // 성공하면 내정보가 로그인 화면으로 바뀌어 이 폼은 언마운트된다
    } catch (e) {
      setError(reviewLoginErrorMessage(e instanceof ApiError ? e.status : undefined));
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.box}>
      <Text style={styles.label}>심사용 로그인</Text>
      <TextInput
        style={styles.input}
        placeholder="이메일"
        placeholderTextColor={theme.colors.textSecondary}
        value={email}
        onChangeText={setEmail}
        editable={!submitting}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="username"
      />
      <TextInput
        style={styles.input}
        placeholder="비밀번호"
        placeholderTextColor={theme.colors.textSecondary}
        value={password}
        onChangeText={setPassword}
        editable={!submitting}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="password"
        onSubmitEditing={() => void submit()}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label="로그인" variant="secondary" loading={submitting} onPress={() => void submit()} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: {
    gap: theme.gap(1),
    paddingTop: theme.gap(2),
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  label: { fontSize: 12, color: theme.colors.textSecondary },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.input,
    paddingVertical: theme.gap(1.25),
    paddingHorizontal: theme.gap(2),
    fontSize: 15,
    color: theme.colors.text,
    backgroundColor: theme.colors.fill,
  },
  error: { fontSize: 13, color: theme.colors.up },
}));
