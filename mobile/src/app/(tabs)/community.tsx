import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { infeedInterval, isInfeedAfter } from '@/features/ads/ad-config';
import { HouseAdSlot } from '@/features/ads/house-ad-card';
import { useAdConfig } from '@/features/ads/use-ad-config';
import { BlogCard } from '@/features/blog/blog-card';
import { useBlogList } from '@/features/blog/use-blog-list';
import { boardChips, resolveBoardFilter, type BoardFilter } from '@/features/boards/filter';
import { useBoardStore } from '@/features/boards/store';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { Chip } from '@/ui';

const PAGE_SIZE = 10;

/** 커뮤니티 탭 — 기본은 '전체'(활성 게시판의 새 글), 칩으로 게시판을 고른다. '전체'일 때만 카드에 게시판 이름을 붙인다.
 *  탭 화면은 Stack 헤더가 없어 상단 안전 영역을 직접 비운다 */
export default function CommunityScreen() {
  const insets = useSafeAreaInsets();
  const { boards, loaded: boardsLoaded, error: boardsError, load: loadBoards } = useBoardStore();
  const refreshBoards = useBoardStore((s) => s.refresh);
  const [selected, setSelected] = useState<BoardFilter>(null);
  const [page, setPage] = useState(1);
  const ads = useAdConfig();
  const adEvery = infeedInterval(ads, 'MOB_COMMUNITY_INFEED');

  useEffect(() => {
    loadBoards();
  }, [loadBoards]);

  const filter = resolveBoardFilter(selected, boards, boardsLoaded);
  // 고른 게시판이 숨겨져 '전체'로 돌아가면 쪽 번호도 처음으로
  useEffect(() => {
    if (filter !== selected) {
      setSelected(filter);
      setPage(1);
    }
  }, [filter, selected]);

  const { data, total, loading, error, reload, refresh } = useBlogList({
    boardId: filter,
    page,
    size: PAGE_SIZE,
  });
  // 당겨서 새로고침: 게시판 목록(이름·순서 변경 반영)과 현재 글을 함께 다시 가져온다
  const { refreshing, onRefresh } = usePullRefresh(() => Promise.all([refreshBoards(), refresh()]));

  const handleSelect = (value: BoardFilter) => {
    if (value === filter) return;
    setSelected(value);
    setPage(1);
  };

  const boardName = (id: number) => boards.find((b) => b.id === id)?.name;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Text style={styles.title} accessibilityRole="header">커뮤니티</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsBar} contentContainerStyle={styles.chips}>
        {boardChips(boards).map((c) => (
          <Chip key={c.value ?? 'all'} label={c.label} selected={c.value === filter} onPress={() => handleSelect(c.value)} />
        ))}
        {/* 게시판 목록만 실패해도 '전체' 글은 볼 수 있으니 화면을 막지 않는다 */}
        {boardsError ? <Chip label="게시판 다시 불러오기" onPress={loadBoards} /> : null}
      </ScrollView>

      {/* 처음 불러올 때만 전체 로딩. 빈 상태·오류도 목록 안에 둬서 당겨서 새로고침이 되게 한다 */}
      {loading && data.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.hint}>불러오는 중…</Text>
        </View>
      ) : (
        <FlatList
          style={styles.list}
          contentContainerStyle={[styles.listContent, data.length === 0 && styles.grow]}
          data={data}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item, index }) => (
            <>
              <BlogCard post={item} boardName={filter === null ? boardName(item.boardId) : undefined} />
              {/* 광고 자리(MOB_COMMUNITY_INFEED) — 목록 data 에 끼우지 않고 interval 번째 글 아래에 붙인다(key·페이지 계산 그대로) */}
              {isInfeedAfter(index, adEvery) ? (
                <HouseAdSlot config={ads} slotKey="MOB_COMMUNITY_INFEED" style={styles.adGap} />
              ) : null}
            </>
          )}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            error ? (
              <View style={styles.center}>
                <Text style={styles.errorTitle}>커뮤니티를 불러오지 못했습니다</Text>
                <Text style={styles.hint}>{error}</Text>
                <Pressable style={styles.retry} onPress={reload}>
                  <Text style={styles.retryText}>다시 시도</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.center}>
                <Text style={styles.hint}>아직 글이 없습니다</Text>
                <Text style={styles.hint}>화면을 아래로 당기면 새로고침돼요</Text>
              </View>
            )
          }
          ListFooterComponent={
            total > PAGE_SIZE ? (
              <Pagination page={page} totalPages={totalPages} onChange={setPage} />
            ) : null
          }
        />
      )}
    </View>
  );
}

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  return (
    <View style={styles.pagination}>
      <Pressable
        style={[styles.pageButton, page <= 1 && styles.pageButtonDisabled]}
        disabled={page <= 1}
        onPress={() => onChange(page - 1)}
      >
        <Text style={[styles.pageButtonText, page <= 1 && styles.pageButtonTextDisabled]}>이전</Text>
      </Pressable>
      <Text style={styles.pageStatus}>
        {page} / {totalPages}
      </Text>
      <Pressable
        style={[styles.pageButton, page >= totalPages && styles.pageButtonDisabled]}
        disabled={page >= totalPages}
        onPress={() => onChange(page + 1)}
      >
        <Text style={[styles.pageButtonText, page >= totalPages && styles.pageButtonTextDisabled]}>
          다음
        </Text>
      </Pressable>
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
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: theme.colors.text,
    paddingHorizontal: theme.gap(2),
    paddingTop: theme.gap(2),
  },
  chipsBar: { flexGrow: 0, flexShrink: 0 }, // ScrollView 기본 flexShrink:1 — 목록이 길면 칩 줄이 눌린다
  chips: { gap: theme.gap(1), paddingHorizontal: theme.gap(2), paddingVertical: theme.gap(1.5) },
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
  adGap: {
    marginTop: theme.gap(1.5), // 글 사이 구분선과 같은 간격
  },
  pagination: {
    marginTop: theme.gap(2),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.gap(2),
  },
  pageButton: {
    paddingVertical: theme.gap(0.75),
    paddingHorizontal: theme.gap(1.5),
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  pageButtonDisabled: {
    opacity: 0.4,
  },
  pageButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.text,
  },
  pageButtonTextDisabled: {
    color: theme.colors.textSecondary,
  },
  pageStatus: {
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  grow: {
    flexGrow: 1,
  },
}));
