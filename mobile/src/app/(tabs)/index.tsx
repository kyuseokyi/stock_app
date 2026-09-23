import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { BlogCard } from '@/features/blog/blog-card';
import { useFeaturedPosts } from '@/features/blog/use-featured-posts';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { data, loading, error, reload } = useFeaturedPosts();

  if (loading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator />
        <Text style={styles.hint}>불러오는 중…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.errorTitle}>추천 글을 불러오지 못했습니다</Text>
        <Text style={styles.hint}>{error}</Text>
        <Pressable style={styles.retry} onPress={reload}>
          <Text style={styles.retryText}>다시 시도</Text>
        </Pressable>
      </View>
    );
  }

  if (data.length === 0) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.title}>📌 추천 글</Text>
        <Text style={styles.hint}>아직 추천 글이 없습니다</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={[styles.listContent, { paddingTop: insets.top + 16 }]}
      data={data}
      keyExtractor={(item) => String(item.id)}
      ListHeaderComponent={<Text style={styles.title}>📌 추천 글</Text>}
      renderItem={({ item }) => <BlogCard post={item} />}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
    />
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
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: theme.colors.text,
    marginBottom: theme.gap(1.5),
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
}));
