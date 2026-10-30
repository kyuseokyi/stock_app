import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

/** 하단 탭 5개 — 홈 · 시황 · 스크리너 · 게임 · 내정보(스펙 2026-10-30 §1.2).
 *  커뮤니티는 탭에서 빠져 홈의 '커뮤니티 전체 보기' → /blog(Stack 화면)로 들어간다 */
export default function TabsLayout() {
  const { theme } = useUnistyles();

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
          title: '시황',
          tabBarIcon: ({ color, size }) => <Ionicons name="pulse-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="screener"
        options={{
          title: '스크리너',
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
