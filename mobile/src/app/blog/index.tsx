import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { BlogCard } from '@/features/blog/blog-card';
import { useBlogList } from '@/features/blog/use-blog-list';
import { useBoardStore } from '@/features/boards/store';
import type { Board } from '@/features/boards/types';
import { usePullRefresh } from '@/hooks/use-pull-refresh';

const PAGE_SIZE = 10;

/** 커뮤니티 목록 — 하단 탭에서 빠져 루트 Stack 화면(/blog, 헤더 '커뮤니티')이 됐다. 홈의 '커뮤니티 전체 보기'로 들어온다.
 *  상단 안전 영역은 Stack 헤더가 맡으므로 상단 여백을 따로 주지 않는다 */
export default function BlogScreen() {
  const { boards, loaded: boardsLoaded, error: boardsError, load: loadBoards } = useBoardStore();
  const [selectedBoardId, setSelectedBoardId] = useState<number | undefined>(undefined);
  const [page, setPage] = useState(1);

  useEffect(() => {
    loadBoards();
  }, [loadBoards]);

  // 게시판 로딩 완료 시 첫 번째 게시판을 기본 선택(웹의 첫 게시판 리다이렉트와 동일한 동작).
  useEffect(() => {
    if (boardsLoaded && boards.length > 0 && selectedBoardId === undefined) {
      setSelectedBoardId(boards[0].id);
    }
  }, [boardsLoaded, boards, selectedBoardId]);

  const { data, total, loading, error, reload, refresh } = useBlogList({
    boardId: selectedBoardId,
    page,
    size: PAGE_SIZE,
  });
  const refreshBoards = useBoardStore((s) => s.refresh);
  // 당겨서 새로고침: 게시판 목록(이름·순서 변경 반영)과 현재 게시판 글을 함께 다시 가져온다
  const { refreshing, onRefresh } = usePullRefresh(() => Promise.all([refreshBoards(), refresh()]));

  const handleSelectBoard = (boardId: number) => {
    if (boardId === selectedBoardId) return;
    setSelectedBoardId(boardId);
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (boardsError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>게시판을 불러오지 못했습니다</Text>
        <Text style={styles.hint}>{boardsError}</Text>
        <Pressable style={styles.retry} onPress={loadBoards}>
          <Text style={styles.retryText}>다시 시도</Text>
        </Pressable>
      </View>
    );
  }

  if (!boardsLoaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.hint}>게시판을 불러오는 중…</Text>
      </View>
    );
  }

  if (boards.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>게시판이 없습니다</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <BoardTabs boards={boards} selectedBoardId={selectedBoardId} onSelect={handleSelectBoard} />

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
          renderItem={({ item }) => <BlogCard post={item} />}
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

function BoardTabs({
  boards,
  selectedBoardId,
  onSelect,
}: {
  boards: Board[];
  selectedBoardId: number | undefined;
  onSelect: (id: number) => void;
}) {
  return (
    <FlatList
      style={styles.tabs}
      contentContainerStyle={styles.tabsContent}
      data={boards}
      horizontal
      showsHorizontalScrollIndicator={false}
      keyExtractor={(item) => String(item.id)}
      ItemSeparatorComponent={() => <View style={styles.tabSep} />}
      renderItem={({ item }) => {
        const selected = item.id === selectedBoardId;
        return (
          <Pressable
            style={[styles.tab, selected && styles.tabSelected]}
            onPress={() => onSelect(item.id)}
          >
            <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{item.name}</Text>
          </Pressable>
        );
      }}
    />
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
  tabs: {
    flexGrow: 0,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  tabsContent: {
    paddingHorizontal: theme.gap(2),
    paddingVertical: theme.gap(1.5),
  },
  tabSep: {
    width: theme.gap(1),
  },
  tab: {
    paddingVertical: theme.gap(0.75),
    paddingHorizontal: theme.gap(1.5),
    borderRadius: 999,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  tabSelected: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
  tabTextSelected: {
    color: '#ffffff',
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
