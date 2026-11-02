import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { BlogCard } from '@/features/blog/blog-card';
import type { BlogPost } from '@/features/blog/types';
import { useFeaturedPosts } from '@/features/blog/use-featured-posts';
import { HomeSummary } from '@/features/home/home-summary';
import { useHomeSummary } from '@/features/home/use-home-summary';
import { HomePushPrompt } from '@/features/push/home-push-prompt';
import { usePullRefresh } from '@/hooks/use-pull-refresh';

// 목록 소품은 모듈 수준으로 — 지수 30초 갱신마다 화면이 다시 그려져도 구분선·행이 다시 마운트되지 않게
const postKey = (item: BlogPost) => String(item.id);
const renderPost = ({ item }: { item: BlogPost }) => <BlogCard post={item} />;
const PostSeparator = () => <View style={styles.sep} />;

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data, loading, error, reload, refresh } = useFeaturedPosts();
  const summary = useHomeSummary();

  // 요약은 실패해도 조용히 숨기고 받아 둔 값을 유지한다 — 토스트는 지금까지처럼 추천 글이 실패했을 때만
  const refreshAll = async () => {
    const [posts] = await Promise.allSettled([refresh(), summary.refresh()]);
    if (posts.status === 'rejected') throw posts.reason;
  };
  const { refreshing, onRefresh } = usePullRefresh(refreshAll);

  // 시트는 Fragment 의 두 번째 자리에 고정 — 다시 마운트되지 않는다
  return (
    <>
      {/* 요약과 추천 글이 따로 로딩되도록 목록을 항상 그린다. 빈 상태·오류도 목록 안에 둬서 당겨서 새로고침이 되게 한다 */}
      <FlatList
        style={styles.list}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: insets.top + 16 },
          data.length === 0 && styles.grow,
        ]}
        data={data}
        keyExtractor={postKey}
        ListHeaderComponent={
          // 함수가 아니라 요소로 넘겨 머리글이 다시 마운트되지 않게 한다(급등·급락 칩 선택 유지)
          <>
            <HomeSummary summary={summary} />
            {/* 커뮤니티는 하단 탭에서 빠졌으므로 추천 글 헤더 오른쪽에서 전체 목록(/blog)으로 보낸다 */}
            <View style={styles.header}>
              <Text style={styles.title} accessibilityRole="header">📌 추천 글</Text>
              <Pressable
                onPress={() => router.push('/blog')}
                hitSlop={8}
                accessibilityRole="link"
                accessibilityLabel="커뮤니티 전체 보기">
                <Text style={styles.moreLink}>커뮤니티 전체 보기 ›</Text>
              </Pressable>
            </View>
          </>
        }
        renderItem={renderPost}
        ItemSeparatorComponent={PostSeparator}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          loading ? (
            <View style={styles.center}>
              <ActivityIndicator />
              <Text style={styles.hint}>불러오는 중…</Text>
            </View>
          ) : error ? (
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
    fontSize: 18,
    fontWeight: '700',
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
    padding: theme.gap(2.5),
  },
  sep: {
    height: theme.gap(1.5),
  },
  grow: {
    flexGrow: 1,
  },
}));
