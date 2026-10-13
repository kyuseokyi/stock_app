import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { useAuthStore } from '@/features/auth/store';
import { AcademySheet } from '@/features/game/components/academy-sheet';
import { DailyChart } from '@/features/game/components/candle-chart';
import { CoachBanner } from '@/features/game/components/coach-banner';
import { GameHeader } from '@/features/game/components/game-header';
import { GameToaster } from '@/features/game/components/game-toaster';
import { LeaderboardSheet } from '@/features/game/components/leaderboard-sheet';
import { OrderPanel } from '@/features/game/components/order-panel';
import { PositionCard } from '@/features/game/components/position-card';
import { QuestSheet } from '@/features/game/components/quest-sheet';
import { QuizBanner } from '@/features/game/components/quiz-banner';
import { QuizSheet } from '@/features/game/components/quiz-sheet';
import { SentimentBar } from '@/features/game/components/sentiment-bar';
import { StreakRewardSheet } from '@/features/game/components/streak-reward-sheet';
import { isQuizPrimeTime } from '@/features/game/lib/quiz';
import { useTradingGameStore } from '@/features/game/store';
import type { Leverage, OrderOptions, Ratio, Side } from '@/features/game/types';
import { useGameSocket } from '@/features/game/use-game-socket';
import { ListState } from '@/ui';

const RANK_POLL_MS = 30_000;
const PRIME_CHECK_MS = 60_000;

type ActiveModal = 'ranking' | 'quest' | 'academy' | 'quiz' | 'streak' | null;
type PrivateModal = Exclude<ActiveModal, 'ranking' | null>;

// 실시간 트레이딩 게임 — 상태별 분기: 서버 미설정/시즌 없음 → 준비 중, 연결 실패 → 재시도, 정상 → 트레이딩 화면.
// 시트(RN Modal)는 한 번에 하나(activeModal). 랭킹은 공개, 퀘스트·아카데미·퀴즈·주문은 로그인 필요(내정보 탭으로 이동).
export default function GameScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const loggedIn = token !== null;

  const status = useTradingGameStore((s) => s.status);
  const season = useTradingGameStore((s) => s.season);
  const account = useTradingGameStore((s) => s.account);
  const position = useTradingGameStore((s) => s.position);
  const myRank = useTradingGameStore((s) => s.myRank);
  const coach = useTradingGameStore((s) => s.coach);
  const academyUnlocked = useTradingGameStore((s) => s.academyUnlocked);
  const streak = useTradingGameStore((s) => s.streak);
  const quizDisabled = useTradingGameStore((s) => s.quizDisabled);
  const lastPrice = useTradingGameStore((s) => s.lastPrice);
  const sentiment = useTradingGameStore((s) => s.sentiment);
  const submitting = useTradingGameStore((s) => s.submitting);
  const closing = useTradingGameStore((s) => s.closing);
  const loadSeason = useTradingGameStore((s) => s.loadSeason);
  const loadPrivate = useTradingGameStore((s) => s.loadPrivate);
  const resetPrivate = useTradingGameStore((s) => s.resetPrivate);
  const refreshRank = useTradingGameStore((s) => s.refreshRank);
  const placeOrder = useTradingGameStore((s) => s.placeOrder);
  const closePosition = useTradingGameStore((s) => s.closePosition);
  const pushToast = useTradingGameStore((s) => s.pushToast);

  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [primeTime, setPrimeTime] = useState(() => isQuizPrimeTime(new Date()));
  const [refreshing, setRefreshing] = useState(false);
  const ready = status === 'ready';
  const focused = useIsFocused();

  useEffect(() => {
    void loadSeason();
  }, [loadSeason]);

  // 탭은 마운트된 채 유지되므로, 탭에 다시 들어올 때 시즌(+로그인 시 개인 데이터)을 재조회한다.
  // 최초 포커스는 위 마운트 로드와 겹치므로 건너뜀. 최신 값은 ref 로 읽어 포커스 콜백이 재등록되지 않게 한다.
  const focusStateRef = useRef({ ready, loggedIn });
  useEffect(() => {
    focusStateRef.current = { ready, loggedIn };
  }, [ready, loggedIn]);
  const firstFocusRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocusRef.current) {
        firstFocusRef.current = false;
        return;
      }
      void (async () => {
        await loadSeason();
        // loadPrivate 안에서 계좌/포지션/순위(refreshTrading)까지 함께 갱신된다
        if (focusStateRef.current.ready && focusStateRef.current.loggedIn) await loadPrivate();
      })();
    }, [loadSeason, loadPrivate]),
  );

  // 로그인 상태가 바뀌면 개인 데이터 로드/초기화
  useEffect(() => {
    if (!ready) return;
    if (loggedIn) void loadPrivate();
    else resetPrivate();
  }, [ready, loggedIn, loadPrivate, resetPrivate]);

  // 로그아웃 시 로그인 전용 시트 닫기(랭킹은 공개라 유지)
  useEffect(() => {
    if (!loggedIn) setActiveModal((m) => (m === 'ranking' ? m : null));
  }, [loggedIn]);

  // 보유 중 실시간 ROI 로 순위가 움직이므로 주기적으로 갱신(탭이 포커스일 때만 — WS 는 유지)
  useEffect(() => {
    if (!ready || !loggedIn || !focused) return;
    const t = setInterval(() => void refreshRank(), RANK_POLL_MS);
    return () => clearInterval(t);
  }, [ready, loggedIn, focused, refreshRank]);

  // 장 마감 후/주말 퀴즈 배너 — 1분마다 재판정(화면을 켜 둔 채 15:30 을 넘기는 경우)
  useEffect(() => {
    const t = setInterval(() => setPrimeTime(isQuizPrimeTime(new Date())), PRIME_CHECK_MS);
    return () => clearInterval(t);
  }, []);

  useGameSocket(token, ready, () =>
    pushToast({ kind: 'error', icon: '🔑', message: '로그인이 만료되었어요. 다시 로그인해 주세요' }),
  );

  // 시즌 없음/오류 상태의 당겨서 새로고침(시즌만 재조회)
  const onRetry = async () => {
    setRefreshing(true);
    try {
      await loadSeason();
    } finally {
      setRefreshing(false);
    }
  };

  const header = <Text style={styles.screenTitle}>트레이딩 게임</Text>;

  // 준비 중/연결 실패 — 당겨서 새로고침으로 재시도
  const retryScroll = (children: ReactNode) => (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      {header}
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.grow}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRetry()} />}>
        {children}
      </ScrollView>
    </View>
  );
  if (status === 'unavailable' || status === 'no-season') {
    return retryScroll(
      <ListState
        mode="empty"
        emoji="🎮"
        title="시즌을 준비하고 있어요"
        hint="곧 실시간 가상 트레이딩이 열려요. 조금만 기다려 주세요!"
      />,
    );
  }
  if (status === 'error') {
    return retryScroll(
      <ListState
        mode="error"
        title="게임 서버에 연결할 수 없어요"
        hint="잠시 후 다시 시도해 주세요."
        onRetry={() => void loadSeason()}
      />,
    );
  }
  if (!ready || !season) {
    return (
      <View style={[styles.flex, { paddingTop: insets.top }]}>
        {header}
        <ListState mode="loading" />
      </View>
    );
  }

  /** 비로그인 — Alert 로 안내하고 내정보 탭(게스트 로그인)으로 보낸다. web 은 Alert 미지원이라 토스트 + 즉시 이동 */
  const requireLogin = () => {
    if (Platform.OS === 'web') {
      pushToast({ kind: 'info', icon: '🔑', message: '내정보 탭에서 로그인하고 시즌에 참여하세요' });
      router.push('/(tabs)/profile');
      return;
    }
    Alert.alert('로그인이 필요해요', '내정보 탭에서 닉네임으로 시작할 수 있어요.', [
      { text: '취소', style: 'cancel' },
      { text: '로그인하러 가기', onPress: () => router.push('/(tabs)/profile') },
    ]);
  };

  const handleOrder = (side: Side, ratio: Ratio, leverage: Leverage, opts?: OrderOptions) => {
    if (!loggedIn) {
      requireLogin();
      return;
    }
    void placeOrder(side, ratio, leverage, opts);
  };

  const openPrivate = (m: PrivateModal) => {
    if (!loggedIn) {
      requireLogin();
      return;
    }
    setActiveModal(m);
  };
  const closeModal = () => setActiveModal(null);

  // 당겨서 새로고침 — 시즌 + (로그인 시) 개인 데이터 재조회
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadSeason();
      if (loggedIn) await loadPrivate();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <View style={styles.flex}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}>
        <Text style={[styles.screenTitle, styles.titleInScroll]}>트레이딩 게임</Text>
        <GameHeader
          season={season}
          account={account}
          myRank={myRank}
          loggedIn={loggedIn}
          streak={streak}
          showQuiz={!quizDisabled}
          onOpenRanking={() => setActiveModal('ranking')}
          onOpenQuest={() => openPrivate('quest')}
          onOpenQuiz={() => openPrivate('quiz')}
          onOpenStreak={() => openPrivate('streak')}
        />
        <CoachBanner coach={coach} />
        {loggedIn ? (
          <SentimentBar sentiment={sentiment} />
        ) : (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>로그인하면 실시간 시세와 주문이 열려요</Text>
          </View>
        )}
        <DailyChart ticker={season.ticker} lastPrice={lastPrice} coach={coach} position={position} />
        {position ? (
          <PositionCard position={position} lastPrice={lastPrice} closing={closing} onClose={() => void closePosition()} />
        ) : null}
        {primeTime && !quizDisabled ? <QuizBanner onOpen={() => openPrivate('quiz')} /> : null}
        <OrderPanel
          hasPosition={position !== null}
          academyUnlocked={academyUnlocked}
          submitting={submitting}
          onOrder={handleOrder}
          onLockedLeverage={() => openPrivate('academy')}
        />
      </ScrollView>

      {/* 시트가 열려 있으면 토스트는 시트 안(Sheet → GameToaster)에서 보인다 — 화면 오버레이는 시트에 가려지므로 숨김 */}
      {activeModal === null ? <GameToaster /> : null}
      {activeModal === 'ranking' ? <LeaderboardSheet seasonId={season.id} myUserId={userId} onClose={closeModal} /> : null}
      {activeModal === 'quest' ? <QuestSheet onClose={closeModal} /> : null}
      {activeModal === 'academy' ? <AcademySheet onClose={closeModal} /> : null}
      {activeModal === 'quiz' ? <QuizSheet onClose={closeModal} /> : null}
      {activeModal === 'streak' ? <StreakRewardSheet onClose={closeModal} /> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1, backgroundColor: theme.colors.background },
  grow: { flexGrow: 1 },
  content: { paddingHorizontal: theme.gap(2), paddingBottom: theme.gap(4), gap: theme.gap(1.5) },
  screenTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: theme.colors.text,
    paddingHorizontal: theme.gap(2.5),
    paddingTop: theme.gap(2),
  },
  titleInScroll: { paddingHorizontal: theme.gap(0.5), paddingTop: theme.gap(1), paddingBottom: theme.gap(0.5) },
  notice: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.gap(2) },
  noticeText: { fontSize: 14, color: theme.colors.textSecondary },
}));
