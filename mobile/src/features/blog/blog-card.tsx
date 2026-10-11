import { useRouter } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Card } from '@/ui';
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
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(`/blog/${post.id}`)}
      style={({ pressed }) => [pressed && styles.pressed]}>
      <Card>
        <Text style={styles.title} numberOfLines={1}>
          {post.title}
        </Text>
        <Text style={styles.snippet} numberOfLines={2}>
          {stripHtml(post.content)}
        </Text>
        <Text style={styles.meta}>
          조회 {post.viewCount} · {fmtDate(post.createdAt)}
        </Text>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  pressed: { opacity: 0.7 },
  title: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  snippet: { fontSize: 13, lineHeight: 18, color: theme.colors.textSecondary },
  meta: { marginTop: theme.gap(0.5), fontSize: 12, color: theme.colors.textSecondary },
}));
