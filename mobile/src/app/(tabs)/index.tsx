import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { BlogCard } from '@/features/blog/blog-card';
import { useFeaturedPosts } from '@/features/blog/use-featured-posts';
import { HomePushPrompt } from '@/features/push/home-push-prompt';
import { usePullRefresh } from '@/hooks/use-pull-refresh';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data, loading, error, reload, refresh } = useFeaturedPosts();
  const { refreshing, onRefresh } = usePullRefresh(refresh);

  // 처음 불러올 때만 전체 화면 로딩 — 당겨서 새로고침 중에는 목록을 그대로 둔다
  const content =
    loading && data.length === 0 ? (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator />
        <Text style={styles.hint}>불러오는 중…</Text>
      </View>
    ) : (
      // 빈 상태·오류도 목록 안에 둬서 당겨서 새로고침이 되게 한다
      <FlatList
        style={styles.list}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: insets.top + 16 },
          data.length === 0 && styles.grow,
        ]}
        data={data}
        keyExtractor={(item) => String(item.id)}
        ListHeaderComponent={
          // 커뮤니티는 하단 탭에서 빠졌으므로 추천 글 헤더 오른쪽에서 전체 목록(/blog)으로 보낸다
          <View style={styles.header}>
            <Text style={styles.title}>📌 추천 글</Text>
            <Pressable
              onPress={() => router.push('/blog')}
              hitSlop={8}
              accessibilityRole="link"
              accessibilityLabel="커뮤니티 전체 보기">
              <Text style={styles.moreLink}>커뮤니티 전체 보기 ›</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item }) => <BlogCard post={item} />}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          error ? (
            <View style={styles.center}>
              <Text style={styles.errorTitle}>추천 글을 불러오지 못했습니다</Text>
              <Text style={styles.hint}>{error}</Text>
              <Pressable style={styles.retry} onPress={reload}>
                <Text style={styles.retryText}>다시 시도</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.center}>
              <Text style={styles.hint}>아직 추천 글이 없습니다</Text>
              <Text style={styles.hint}>화면을 아래로 당기면 새로고침돼요</Text>
            </View>
          )
        }
      />
    );

  // 시트는 Fragment 의 두 번째 자리에 고정 — 로딩→목록 전환에도 다시 마운트되지 않는다
  return (
    <>
      {content}
      <HomePushPrompt />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
    gap: theme.gap(1),
    padding: theme.gap(3),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.gap(1.5),
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: theme.colors.text,
  },
  moreLink: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.primary,
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
  list: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  listContent: {
    padding: theme.gap(2),
  },
  sep: {
    height: theme.gap(1.5),
  },
  grow: {
    flexGrow: 1,
  },
}));
