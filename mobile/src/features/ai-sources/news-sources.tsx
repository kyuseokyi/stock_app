import * as WebBrowser from 'expo-web-browser';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { formatSourceDate, type NewsSource } from './sources';

type Props = {
  sources: NewsSource[] | undefined;
  style?: StyleProp<ViewStyle>;
  /** 링크를 열기 직전 — 시트(Modal) 안에서 쓸 때 시트를 먼저 닫는 용도(iOS 에서 Modal 위로 브라우저가 안 뜨는 문제 방지) */
  onBeforeOpen?: () => void;
};

/**
 * AI 요약 카드 아래 "참고 기사" — 작은 제목 + 링크 최대 3개(제목 한 줄 말줄임, 날짜가 있으면 M.D).
 * 누르면 인앱 브라우저. sources 가 비거나 없으면 아무것도 그리지 않는다.
 */
export function NewsSources({ sources, style, onBeforeOpen }: Props) {
  if (!sources || sources.length === 0) return null;
  const open = (url: string) => {
    onBeforeOpen?.();
    void WebBrowser.openBrowserAsync(url).catch(() => {});
  };
  return (
    <View style={[styles.wrap, style]}>
      <Text style={styles.title}>참고 기사</Text>
      {sources.map((s) => {
        const date = formatSourceDate(s.pubDate);
        return (
          <Pressable
            key={s.url}
            onPress={() => open(s.url)}
            accessibilityRole="link"
            accessibilityLabel={`참고 기사 ${s.title}${date ? `, ${date}` : ''}`}
            hitSlop={4}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <Text style={styles.link} numberOfLines={1}>
              {s.title}
            </Text>
            {date ? <Text style={styles.date}>{date}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: 2 },
  title: { fontSize: 11, fontWeight: '700', color: theme.colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(0.75), minHeight: 28 },
  pressed: { opacity: 0.6 },
  link: { flex: 1, fontSize: 12, color: theme.colors.primary, textDecorationLine: 'underline' },
  date: { fontSize: 11, color: theme.colors.textSecondary },
}));
