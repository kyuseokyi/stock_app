import { Ionicons } from '@expo/vector-icons';
import { Tabs, usePathname } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

import { useAuthStore } from '@/features/auth/store';
import { FundLoginSheet } from '@/features/fund/components/fund-login-sheet';
import { FUNDS_TAB_PATH, fundTabPressAction, openFundLoginSheet } from '@/features/fund/fund-gate';
import { rememberLoginReturn } from '@/features/fund/login-return';
import { gameVisible } from '@/features/market-access/access';
import { useGameAccess } from '@/features/market-access/use-game-access';
import { useScreenerFeaturesState } from '@/features/screener/use-screener-features';
import { screenerTabVisible } from '@/features/screener/visibility';

/** 하단 탭 — 홈 · 내 펀드 · 블로그 · 게임 · 시장 · (스크리너). 순서는 웹 상단 메뉴와 같다(선언 순서 = 탭 순서).
 *  스크리너 탭은 관리자 스위치 '종목 찾기(사용자 화면)'(STOCK_FINDER)가 켜졌을 때만 시장 다음에 보인다 — 로딩 전·오류는 숨김.
 *  내정보(profile)는 탭 버튼만 숨기고(href: null) 라우트·화면은 그대로 — 탭 화면 제목 줄 오른쪽 ProfileHeaderButton 으로 연다.
 *  '내 펀드'는 비로그인이면 탭 이동을 막고 로그인 안내 시트(FundLoginSheet — 홈 카드와 같은 시트)를 띄운다.
 *  단 이미 로그인 화면(내정보)에 있으면 시트 없이 '로그인 뒤 내 펀드로' 만 기억한다(내정보가 안내 문구를 보여 줌).
 *  게임 탭은 실제 시세 게임 허용(seasons/active features.real_market, A안)일 때만 — 모름·실패·시즌 없음은 숨김(href: null).
 *  (docs/app_identity_and_nav_redesign_spec.md 1장) */
export default function TabsLayout() {
  const { theme } = useUnistyles();
  const showScreener = screenerTabVisible(useScreenerFeaturesState());
  const showGame = gameVisible(useGameAccess());
  // 현재 경로 — 경로가 바뀌면 레이아웃이 다시 그려져 탭 리스너도 새 값을 잡는다
  const pathname = usePathname();

  return (
    <>
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
          name="funds"
          options={{
            title: '내 펀드',
            tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" color={color} size={size} />,
          }}
          listeners={{
            tabPress: (e) => {
              // 눌린 순간의 로그인 상태(렌더 때 잡힌 값이 아니라 스토어의 현재 값)
              const action = fundTabPressAction(pathname, useAuthStore.getState().user !== null);
              if (action === 'go') return;
              e.preventDefault();
              if (action === 'remember') rememberLoginReturn(FUNDS_TAB_PATH);
              else openFundLoginSheet();
            },
          }}
        />
        <Tabs.Screen
          name="community"
          options={{
            title: '블로그',
            tabBarIcon: ({ color, size }) => <Ionicons name="book-outline" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="game"
          options={{
            title: '게임',
            // href: null 이면 탭 버튼만 숨는다(직접 진입하면 게임 화면이 안내 카드를 보여 줌)
            ...(showGame ? {} : { href: null }),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="game-controller-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="market"
          options={{
            title: '시장',
            tabBarIcon: ({ color, size }) => <Ionicons name="pulse-outline" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="screener"
          options={{
            title: '스크리너',
            // href: null 이면 탭 버튼만 숨는다(화면은 남아 /screener 직접 진입은 화면이 시장 탭으로 돌려보냄)
            ...(showScreener ? {} : { href: null }),
            tabBarIcon: ({ color, size }) => <Ionicons name="search-outline" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: '내정보',
            href: null, // 탭 버튼만 숨김 — /profile 라우트·화면(로그인·알림·차단·약관·탈퇴 메뉴)은 그대로
            tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} />,
          }}
        />
      </Tabs>
      <FundLoginSheet />
    </>
  );
}
