import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTermsGateOpen } from '@/features/auth/use-terms-gate';
import { ApiError } from '@/lib/api';
import { BottomSheet, Button, showToast } from '@/ui';

import {
  buildReportBody,
  canSubmitReport,
  commentErrorMessage,
  errorCode,
  REPORT_DETAIL_MAX,
  REPORT_REASONS,
  TOAST_BLOCKED,
  TOAST_DELETED,
  TOAST_REPORTED,
  type CommentAction,
  type CommentMenuAction,
  type ReportReason,
} from './comment-actions';
import { blockUser, deleteComment, reportComment } from './comments-api';
import type { Comment } from './types';

type Step = 'menu' | 'report' | 'block' | 'delete';

type Props = {
  comment: Comment;
  actions: CommentMenuAction[];
  onClose: () => void;
  /** 신고·차단·삭제 성공(또는 이미 삭제된 댓글) — 호출부가 목록을 새로고침 */
  onChanged: () => void;
};

const MENU_LABEL: Record<CommentMenuAction, string> = { delete: '삭제', report: '신고', block: '이 사용자 차단' };
const TITLE: Record<Step, string> = { menu: '댓글', report: '댓글 신고', block: '이 사용자 차단', delete: '댓글 삭제' };

/**
 * 댓글 ⋯ 메뉴 시트 — 메뉴 → (신고 | 차단 확인 | 삭제 확인)을 한 장의 BottomSheet 안에서 단계만 바꾼다
 * (RN Modal 을 닫자마자 새로 여는 교체는 iOS 에서 두 번째가 안 뜨는 일이 있어서). 열 때 마운트·닫을 때 언마운트.
 */
export function CommentMenuSheet({ comment, actions, onClose, onChanged }: Props) {
  const { theme } = useUnistyles();
  const termsGateOpen = useTermsGateOpen(); // 약관 동의 시트가 우선 — 두 Modal 이 겹치지 않게
  const [step, setStep] = useState<Step>(actions.length === 1 ? actions[0] : 'menu');
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (termsGateOpen) return null;

  const run = async (action: CommentAction, task: () => Promise<unknown>, toast: string) => {
    setSubmitting(true);
    setError('');
    try {
      await task();
      showToast(toast);
      onChanged();
      onClose();
    } catch (e) {
      setSubmitting(false);
      const status = e instanceof ApiError ? e.status : undefined;
      const body = e instanceof ApiError ? e.body : undefined;
      setError(commentErrorMessage(action, status, body));
      if (errorCode(body) === 'COMMENT_NOT_FOUND') onChanged(); // 이미 사라진 댓글 — 목록을 맞춘다
    }
  };

  const submitReport = () => {
    if (!reason || !canSubmitReport(reason, detail)) return;
    void run('report', () => reportComment(comment.id, buildReportBody(reason, detail)), TOAST_REPORTED);
  };
  const submitBlock = () => {
    if (comment.authorId == null) return;
    const authorId = comment.authorId;
    void run('block', () => blockUser(authorId), TOAST_BLOCKED);
  };
  const submitDelete = () => void run('delete', () => deleteComment(comment.id), TOAST_DELETED);

  const close = submitting ? () => {} : onClose;

  return (
    <BottomSheet title={TITLE[step]} onClose={close} avoidKeyboard={step === 'report'}>
      {step === 'menu' ? (
        <View style={styles.menu}>
          {actions.map((a) => (
            <Pressable
              key={a}
              onPress={() => setStep(a)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}>
              <Text style={[styles.menuLabel, a !== 'report' && styles.danger]}>{MENU_LABEL[a]}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {step === 'report' ? (
        <>
          <Text style={styles.hint}>신고 사유를 골라 주세요. 여러 명이 신고하면 댓글이 가려져요.</Text>
          <View accessibilityRole="radiogroup">
            {REPORT_REASONS.map((r) => {
              const selected = reason === r.value;
              return (
                <Pressable
                  key={r.value}
                  onPress={() => setReason(r.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  style={styles.radioRow}>
                  <View style={[styles.radio, selected && styles.radioOn]}>
                    {selected ? <View style={styles.radioDot} /> : null}
                  </View>
                  <Text style={styles.radioLabel}>{r.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {reason === 'other' ? (
            <View>
              <TextInput
                style={styles.input}
                value={detail}
                onChangeText={setDetail}
                placeholder="신고 사유를 적어 주세요"
                placeholderTextColor={theme.colors.textSecondary}
                multiline
                maxLength={REPORT_DETAIL_MAX}
                autoFocus
              />
              <Text style={styles.counter}>
                {detail.trim().length}/{REPORT_DETAIL_MAX}
              </Text>
            </View>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            label="신고하기"
            onPress={submitReport}
            loading={submitting}
            disabled={!canSubmitReport(reason, detail)}
          />
        </>
      ) : null}

      {step === 'block' ? (
        <>
          <Text style={styles.body}>
            {comment.authorName ? `${comment.authorName} 님을` : '이 사용자를'} 차단할까요?{'\n'}
            차단하면 이 사용자의 댓글이 보이지 않아요. 내정보 › 차단한 사용자에서 해제할 수 있어요.
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <DangerButton label="차단하기" onPress={submitBlock} submitting={submitting} />
          <Button label="취소" variant="secondary" onPress={onClose} disabled={submitting} />
        </>
      ) : null}

      {step === 'delete' ? (
        <>
          <Text style={styles.body}>댓글을 삭제할까요? 삭제하면 되돌릴 수 없어요.</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <DangerButton label="삭제하기" onPress={submitDelete} submitting={submitting} />
          <Button label="취소" variant="secondary" onPress={onClose} disabled={submitting} />
        </>
      ) : null}
    </BottomSheet>
  );
}

/** 위험 행동 버튼(탈퇴 시트와 같은 모양) */
function DangerButton({ label, onPress, submitting }: { label: string; onPress: () => void; submitting: boolean }) {
  const { theme } = useUnistyles();
  return (
    <Pressable
      onPress={onPress}
      disabled={submitting}
      accessibilityRole="button"
      accessibilityState={{ disabled: submitting, busy: submitting }}
      style={({ pressed }) => [styles.dangerBtn, pressed && !submitting && styles.pressed, submitting && styles.disabled]}>
      {submitting ? <ActivityIndicator color={theme.colors.up} /> : <Text style={styles.dangerLabel}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  menu: { gap: 0 },
  menuRow: { minHeight: 52, justifyContent: 'center' },
  menuLabel: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  danger: { color: theme.colors.up },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.5 },
  hint: { fontSize: 13, lineHeight: 19, color: theme.colors.textSecondary },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1.5), minHeight: 44 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: theme.colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.primary },
  radioLabel: { fontSize: 15, color: theme.colors.text },
  input: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.input,
    paddingHorizontal: theme.gap(1.5),
    paddingVertical: theme.gap(1),
    fontSize: 14,
    color: theme.colors.text,
    backgroundColor: theme.colors.fill,
    textAlignVertical: 'top',
  },
  counter: { alignSelf: 'flex-end', marginTop: 4, fontSize: 11, color: theme.colors.textSecondary },
  body: { fontSize: 15, lineHeight: 22, color: theme.colors.text },
  error: { fontSize: 13, color: theme.colors.up },
  dangerBtn: {
    height: 56,
    alignSelf: 'stretch',
    borderRadius: theme.radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.upSoft,
  },
  dangerLabel: { fontSize: 16, fontWeight: '700', color: theme.colors.up },
}));
