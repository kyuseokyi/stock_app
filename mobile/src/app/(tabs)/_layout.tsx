import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

import { useScreenerFeaturesState } from '@/features/screener/use-screener-features';
import { screenerTabVisible } from '@/features/screener/visibility';

/** 하단 탭 5개 — 홈 · 마켓 · 스크리너 · 게임 · 내정보(스펙 2026-10-30 §1.2).
 *  커뮤니티는 탭에서 빠져 홈의 '커뮤니티 전체 보기' → /blog(Stack 화면)로 들어간다.
 *  스크리너 탭은 관리자 스위치 '종목 찾기(사용자 화면)'(STOCK_FINDER)가 켜졌을 때만 보인다 — 로딩 전·오류는 숨김 */
export default function TabsLayout() {
  const { theme } = useUnistyles();
  const showScreener = screenerTabVisible(useScreenerFeaturesState());

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.textSecondary,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: '홈',
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="market"
        options={{
          title: '마켓',
          tabBarIcon: ({ color, size }) => <Ionicons name="pulse-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="screener"
        options={{
          title: '스크리너',
          // href: null 이면 탭 버튼만 숨는다(화면은 남아 /screener 직접 진입은 화면이 마켓으로 돌려보냄)
          ...(showScreener ? {} : { href: null }),
          tabBarIcon: ({ color, size }) => <Ionicons name="search-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="game"
        options={{
          title: '게임',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="game-controller-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '내정보',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
