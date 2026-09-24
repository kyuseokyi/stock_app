import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { WebView } from 'react-native-webview';

import { useBlogDetail } from '@/features/blog/use-blog-detail';
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

export default function BlogDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useUnistyles();
  // 게시판 이름 조회용. 홈(featured) 탭에서 바로 진입 시 게시판 목록이 아직 로드되지
  // 않았을 수 있으므로(블로그 탭에서만 loadBoards 호출) 여기서도 멱등 로드를 보장한다.
  const loadBoards = useBoardStore((s) => s.load);
  // boards 배열을 구독해야 로드 완료 시 재렌더된다(boardName 함수 참조 자체는 불변).
  useBoardStore((s) => s.boards);
  const boardName = useBoardStore((s) => s.boardName);
  const { data: post, loading, error, reload } = useBlogDetail(Number(id));

  useEffect(() => {
    loadBoards();
  }, [loadBoards]);

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

  return (
    <View style={styles.screen}>
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
        style={styles.webview}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
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
    flex: 1,
    backgroundColor: theme.colors.background,
  },
}));
