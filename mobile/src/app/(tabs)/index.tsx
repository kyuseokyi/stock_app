import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { HOME_FEED_MIN_POSTS } from '@/features/ads/ad-config';
import { HouseAdSlot } from '@/features/ads/house-ad-card';
import { useAdConfig } from '@/features/ads/use-ad-config';
import { BlogCard } from '@/features/blog/blog-card';
import type { BlogPost } from '@/features/blog/types';
import { useFeaturedPosts } from '@/features/blog/use-featured-posts';
import { HomeFundCard } from '@/features/home/home-fund-card';
import { HomeGameEduCard } from '@/features/home/home-game-edu-card';
import { HomeMarketStrip, useHomeMarketStrip } from '@/features/home/home-market-strip';
import { HOME_POST_LIMIT } from '@/features/home/home-sections';
import { HomePushPrompt } from '@/features/push/home-push-prompt';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { ProfileHeaderButton } from '@/ui';

// 목록 소품은 모듈 수준으로 — 지수 30초 갱신마다 화면이 다시 그려져도 구분선·행이 다시 마운트되지 않게
const postKey = (item: BlogPost) => String(item.id);
const renderPost = ({ item }: { item: BlogPost }) => <BlogCard post={item} />;
const PostSeparator = () => <View style={styles.sep} />;

/**
 * 홈 — 3단(docs/app_identity_and_nav_redesign_spec.md 2장, 웹 HomePage 와 같은 순서):
 *   ① 내 펀드 카드(최상단) → ② 추천 블로그 글 + 오늘의 실전 투자 교육(게임·퀴즈) → ③ 오늘 시장 참고(지수·환율 작게, 시장 더보기).
 * 예전 홈의 시황 요약(home-summary·home-brief-banner·home-indices·home-movers, use-home-summary)은 지우지 않고 보존한다 —
 * 다시 켜려면 여기서 <HomeSummary summary={useHomeSummary()} /> 를 바꿔 끼운다(브리핑·급등락 조회·폴링은 지금은 하지 않음).
 */
export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data: allPosts, loading, error, reload, refresh } = useFeaturedPosts();
  const data = allPosts.slice(0, HOME_POST_LIMIT); // 아래 교육 카드·시장 참고가 너무 멀어지지 않게
  const strip = useHomeMarketStrip();
  const ads = useAdConfig();

  // 시장 참고 칸은 실패해도 받아 둔 값을 유지하고 그 칸에서만 다시 시도한다 — 토스트는 지금까지처럼 추천 글이 실패했을 때만
  const refreshAll = async () => {
    const [posts] = await Promise.allSettled([refresh(), strip.refresh()]);
    if (posts.status === 'rejected') throw posts.reason;
  };
  const { refreshing, onRefresh } = usePullRefresh(refreshAll);

  // 시트는 Fragment 의 두 번째 자리에 고정 — 다시 마운트되지 않는다
  return (
    <>
      {/* 요약과 추천 글이 따로 로딩되도록 목록을 항상 그린다. 빈 상태·오류도 목록 안에 둬서 당겨서 새로고침이 되게 한다 */}
      <FlatList
        style={[styles.list, { marginTop: insets.top }]} // 상태 표시줄 여백은 스크롤 밖 — 안에 두면 스크롤 때 내용이 그 밑으로 지나감
        contentContainerStyle={[styles.listContent, { paddingTop: 8 }]}
        data={data}
        keyExtractor={postKey}
        ListHeaderComponent={
          // 함수가 아니라 요소로 넘겨 머리글이 다시 마운트되지 않게 한다(급등·급락 칩 선택 유지)
          <>
            {/* 제목 줄 + 오른쪽 내정보 버튼(하단 탭에서 내정보가 빠짐) */}
            <View style={styles.topRow}>
              <Text style={styles.brand} accessibilityRole="header">FunNote</Text>
              <ProfileHeaderButton />
            </View>
            {/* ① 내 펀드 */}
            <HomeFundCard />
            {/* ② 추천 블로그 글 — 헤더 오른쪽에서 블로그 탭으로 보낸다 */}
            <View style={[styles.header, styles.sectionGap]}>
              <Text style={styles.title} accessibilityRole="header">📌 추천 블로그 글</Text>
              <Pressable
                onPress={() => router.push('/community')}
                style={styles.moreHit}
                accessibilityRole="link"
                accessibilityLabel="블로그 전체 보기">
                <Text style={styles.moreLink}>블로그 전체 보기 ›</Text>
              </Pressable>
            </View>
          </>
        }
        renderItem={renderPost}
        ItemSeparatorComponent={PostSeparator}
        // 광고 자리(MOB_HOME_FEED_NATIVE) — 추천 글이 3개 이상일 때 추천 글 끝에 하나.
        // 그 아래 ② 실전 투자 교육 → ③ 오늘 시장 참고. 요소로 넘겨 다시 마운트되지 않게
        ListFooterComponent={
          <>
            {data.length >= HOME_FEED_MIN_POSTS ? (
              <HouseAdSlot config={ads} slotKey="MOB_HOME_FEED_NATIVE" style={styles.adGap} />
            ) : null}
            <View style={styles.sectionGap}>
              <HomeGameEduCard />
            </View>
            <View style={styles.sectionGap}>
              <HomeMarketStrip strip={strip} />
            </View>
          </>
        }
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
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
    gap: theme.gap(1),
    padding: theme.gap(3),
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.gap(1),
  },
  brand: {
    fontSize: 24,
    fontWeight: '800',
    color: theme.colors.text,
  },
  sectionGap: {
    marginTop: theme.gap(3.5), // 섹션 간 24~32px(디자인 언어)
  },
  moreHit: {
    minHeight: 44,
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.gap(0.5),
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
  adGap: {
    marginTop: theme.gap(1.5), // 글 사이 구분선과 같은 간격
  },
}));
