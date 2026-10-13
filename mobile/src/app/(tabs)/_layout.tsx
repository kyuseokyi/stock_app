import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

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
        name="blog"
        options={{
          title: '블로그',
          tabBarIcon: ({ color, size }) => <Ionicons name="newspaper-outline" color={color} size={size} />,
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
