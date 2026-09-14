import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { BlogPost } from './types';

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

export function BlogCard({ post }: { post: BlogPost }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle} numberOfLines={1}>
        {post.title}
      </Text>
      <Text style={styles.cardSnippet} numberOfLines={2}>
        {stripHtml(post.content)}
      </Text>
      <Text style={styles.cardMeta}>
        조회 {post.viewCount} · {fmtDate(post.createdAt)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.gap(2),
    gap: theme.gap(0.5),
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.text,
  },
  cardSnippet: {
    fontSize: 13,
    lineHeight: 18,
    color: theme.colors.textSecondary,
  },
  cardMeta: {
    marginTop: theme.gap(0.5),
    fontSize: 12,
    color: theme.colors.textSecondary,
  },
}));
