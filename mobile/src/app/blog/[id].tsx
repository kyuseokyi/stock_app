import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { useAuthStore } from '@/features/auth/store';
import { useBlogDetail } from '@/features/blog/use-blog-detail';
import { useComments } from '@/features/blog/use-comments';
import { useBoardStore } from '@/features/boards/store';

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ko-KR');
}

function buildHtml(content: string, colors: { background: string; text: string }): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body {
    margin: 0;
    padding: 16px;
    font-size: 16px;
    line-height: 1.6;
    font-family: -apple-system, Roboto, sans-serif;
    background: ${colors.background};
    color: ${colors.text};
    word-break: break-word;
  }
  img { max-width: 100%; height: auto; }
</style>
</head>
<body>${content}</body>
</html>`;
}

// 본문 WebView는 ScrollView 안에 얹히므로 flex:1 대신 실측 높이(document.body.scrollHeight)를
// onMessage로 받아 style height에 반영한다(자동 높이). 최초 렌더/로드/리사이즈 시 재전송한다.
const AUTO_HEIGHT_JS = `
(function () {
  function postHeight() {
    var h = document.body ? document.body.scrollHeight : 0;
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(String(h));
    }
  }
  postHeight();
  window.addEventListener('load', postHeight);
  window.addEventListener('resize', postHeight);
  setTimeout(postHeight, 300);
  true;
})();
`;

const MIN_WEBVIEW_HEIGHT = 120;

export default function BlogDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { theme } = useUnistyles();
  const blogId = Number(id);

  // 게시판 이름/댓글 허용 여부 조회용. 홈(featured) 탭에서 바로 진입 시 게시판 목록이 아직 로드되지
  // 않았을 수 있으므로(블로그 탭에서만 loadBoards 호출) 여기서도 멱등 로드를 보장한다.
  const loadBoards = useBoardStore((s) => s.load);
  // boards 배열을 구독해야 로드 완료 시 재렌더된다(boardName 함수 참조 자체는 불변).
  const boards = useBoardStore((s) => s.boards);
  const boardName = useBoardStore((s) => s.boardName);
  const { data: post, loading, error, reload } = useBlogDetail(blogId);
  const {
    data: comments,
    loading: commentsLoading,
    error: commentsListError,
    reload: reloadComments,
    submit,
    submitting,
    submitError,
  } = useComments(blogId);
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  const [webviewHeight, setWebviewHeight] = useState(MIN_WEBVIEW_HEIGHT);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    loadBoards();
  }, [loadBoards]);

  // 게시글이 바뀌면(다른 글로 재진입) 자동 높이를 초기값으로 되돌린다.
  useEffect(() => {
    setWebviewHeight(MIN_WEBVIEW_HEIGHT);
  }, [post?.id]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.hint}>불러오는 중…</Text>
      </View>
    );
  }

  if (error || !post) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>글을 불러오지 못했습니다</Text>
        <Text style={styles.hint}>{error}</Text>
        <Pressable style={styles.retry} onPress={reload}>
          <Text style={styles.retryText}>다시 시도</Text>
        </Pressable>
      </View>
    );
  }

  const board = boards.find((b) => b.id === post.boardId);
  const commentsEnabled = board?.commentsEnabled ?? true;

  const handleSubmit = async () => {
    const ok = await submit(draft);
    if (ok) setDraft('');
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.boardName}>{boardName(post.boardId)}</Text>
          <Text style={styles.title}>{post.title}</Text>
          <Text style={styles.meta}>
            {fmtDateTime(post.createdAt)} · 조회 {post.viewCount}
          </Text>
        </View>

        <WebView
          originWhitelist={['*']}
          source={{
            html: buildHtml(post.content, {
              background: theme.colors.background,
              text: theme.colors.text,
            }),
          }}
          style={[styles.webview, { height: webviewHeight }]}
          scrollEnabled={false}
          injectedJavaScript={AUTO_HEIGHT_JS}
          onMessage={(e: WebViewMessageEvent) => {
            const h = Number(e.nativeEvent.data);
            if (Number.isFinite(h) && h > 0) {
              setWebviewHeight(Math.max(h, MIN_WEBVIEW_HEIGHT));
            }
          }}
        />

        <View style={styles.commentsSection}>
          <Text style={styles.commentsTitle}>
            댓글 <Text style={styles.commentsCount}>{comments.length}</Text>
          </Text>

          {commentsLoading ? (
            <ActivityIndicator style={styles.commentsLoading} />
          ) : commentsListError ? (
            <View style={styles.commentsErrorBox}>
              <Text style={styles.emptyComments}>{commentsListError}</Text>
              <Pressable style={styles.retry} onPress={reloadComments}>
                <Text style={styles.retryText}>다시 시도</Text>
              </Pressable>
            </View>
          ) : comments.length === 0 ? (
            <Text style={styles.emptyComments}>첫 댓글을 남겨보세요</Text>
          ) : (
            comments.map((c) => (
              <View key={c.id} style={styles.commentItem}>
                <View style={styles.commentMetaRow}>
                  <Text style={styles.commentAuthor}>{c.authorName || '게스트'}</Text>
                  <Text style={styles.commentDate}>{fmtDateTime(c.createdAt)}</Text>
                </View>
                <Text style={styles.commentContent}>{c.content}</Text>
              </View>
            ))
          )}

          {/* 401로 인한 자동 로그아웃 시 아래 분기가 compose→loginPrompt로 즉시 전환되므로,
              submitError는 그 전환에 영향받지 않도록 분기 밖(공통 위치)에서 렌더한다. */}
          {submitError ? <Text style={styles.submitError}>{submitError}</Text> : null}

          {!commentsEnabled ? (
            <Text style={styles.disabledNotice}>이 게시판은 댓글이 비활성화되어 있습니다.</Text>
          ) : token ? (
            <View style={styles.composeBox}>
              <TextInput
                style={styles.composeInput}
                value={draft}
                onChangeText={setDraft}
                placeholder={user?.nickname ? `${user.nickname} 님, 댓글을 입력하세요` : '댓글을 입력하세요'}
                placeholderTextColor={theme.colors.textSecondary}
                multiline
                maxLength={1000}
              />
              <Pressable
                style={[
                  styles.submitButton,
                  (submitting || !draft.trim()) && styles.submitButtonDisabled,
                ]}
                onPress={handleSubmit}
                disabled={submitting || !draft.trim()}
              >
                <Text style={styles.submitButtonText}>{submitting ? '등록 중…' : '등록'}</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable style={styles.loginPrompt} onPress={() => router.push('/profile')}>
              <Text style={styles.loginPromptText}>로그인하고 댓글 작성하기</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scrollContent: {
    paddingBottom: theme.gap(4),
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
    gap: theme.gap(1),
    padding: theme.gap(3),
  },
  hint: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.text,
  },
  retry: {
    marginTop: theme.gap(1),
    paddingVertical: theme.gap(1),
    paddingHorizontal: theme.gap(2),
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
  },
  retryText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  header: {
    padding: theme.gap(2),
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    gap: theme.gap(0.5),
  },
  boardName: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.primary,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: theme.colors.text,
  },
  meta: {
    fontSize: 12,
    color: theme.colors.textSecondary,
  },
  webview: {
    backgroundColor: theme.colors.background,
  },
  commentsSection: {
    marginTop: theme.gap(1),
    padding: theme.gap(2),
    gap: theme.gap(1.5),
  },
  commentsTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: theme.colors.text,
  },
  commentsCount: {
    color: theme.colors.primary,
  },
  commentsLoading: {
    marginVertical: theme.gap(2),
  },
  commentsErrorBox: {
    alignItems: 'center',
    gap: theme.gap(1),
    paddingVertical: theme.gap(2),
  },
  emptyComments: {
    paddingVertical: theme.gap(2),
    textAlign: 'center',
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  commentItem: {
    borderRadius: 8,
    padding: theme.gap(1.5),
    backgroundColor: theme.colors.surface,
    gap: theme.gap(0.5),
  },
  commentMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.gap(1),
  },
  commentAuthor: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.text,
  },
  commentDate: {
    fontSize: 11,
    color: theme.colors.textSecondary,
  },
  commentContent: {
    fontSize: 14,
    color: theme.colors.text,
  },
  disabledNotice: {
    marginTop: theme.gap(1),
    padding: theme.gap(1.5),
    borderRadius: 8,
    backgroundColor: theme.colors.surface,
    textAlign: 'center',
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  composeBox: {
    marginTop: theme.gap(1),
    gap: theme.gap(1),
  },
  composeInput: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    paddingHorizontal: theme.gap(1.5),
    paddingVertical: theme.gap(1),
    fontSize: 14,
    color: theme.colors.text,
    backgroundColor: theme.colors.surface,
    textAlignVertical: 'top',
  },
  submitError: {
    fontSize: 12,
    color: theme.colors.up,
  },
  submitButton: {
    alignSelf: 'flex-end',
    paddingVertical: theme.gap(1),
    paddingHorizontal: theme.gap(2),
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  loginPrompt: {
    marginTop: theme.gap(1),
    padding: theme.gap(1.5),
    borderRadius: 8,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
  },
  loginPromptText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.primary,
  },
}));
