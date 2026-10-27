import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { useAuthStore } from '@/features/auth/store';
import { AcademySheet } from '@/features/game/components/academy-sheet';
import { DailyChart } from '@/features/game/components/candle-chart';
import { SrActionSheet } from '@/features/game/components/sr-action-sheet';
import { srEventName, type SrLevel } from '@/features/game/lib/sr-levels';
import { SrWatcher, type SrEvent } from '@/features/game/lib/sr-watch';
import { CoachBanner } from '@/features/game/components/coach-banner';
import { MarketStatusBanner } from '@/features/game/components/market-status-banner';
import { useForegroundInterval } from '@/features/game/lib/foreground-interval';
import { MARKET_STATUS_POLL_MS, shouldPollMarketStatus } from '@/features/game/lib/ws';
import { GameHeader } from '@/features/game/components/game-header';
import { GameToaster } from '@/features/game/components/game-toaster';
import { LeaderboardSheet } from '@/features/game/components/leaderboard-sheet';
import { OrderPanel } from '@/features/game/components/order-panel';
import { PositionCard } from '@/features/game/components/position-card';
import { QuestSheet } from '@/features/game/components/quest-sheet';
import { QuizBanner } from '@/features/game/components/quiz-banner';
import { QuizSheet } from '@/features/game/components/quiz-sheet';
import { RulesSheet } from '@/features/game/components/rules-sheet';
import { SentimentBar } from '@/features/game/components/sentiment-bar';
import { StreakRewardSheet } from '@/features/game/components/streak-reward-sheet';
import { isQuizPrimeTime } from '@/features/game/lib/quiz';
import { useTradingGameStore } from '@/features/game/store';
import type { Leverage, OrderOptions, Ratio, Side } from '@/features/game/types';
import { useGameSocket } from '@/features/game/use-game-socket';
import { reasonFromCode } from '@/lib/api/session-end';
import { BottomSheet, Button, Card, ListState } from '@/ui';

const RANK_POLL_MS = 30_000;
const PRIME_CHECK_MS = 60_000;

type ActiveModal = 'ranking' | 'rules' | 'quest' | 'academy' | 'quiz' | 'streak' | null;
type PrivateModal = Exclude<ActiveModal, 'ranking' | 'rules' | null>;

// 실시간 트레이딩 게임 — 상태별 분기: 서버 미설정/시즌 없음 → 준비 중, 연결 실패 → 재시도, 정상 → 트레이딩 화면.
// 시트(RN Modal)는 한 번에 하나(activeModal). 랭킹·규칙은 공개, 퀘스트·아카데미·퀴즈·주문은 로그인 필요(내정보 탭으로 이동).
export default function GameScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const expireSession = useAuthStore((s) => s.expireSession);
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
  const marketStatus = useTradingGameStore((s) => s.marketStatus);
  const loadMarketStatus = useTradingGameStore((s) => s.loadMarketStatus);
  const streamEpoch = useTradingGameStore((s) => s.streamEpoch);

  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [primeTime, setPrimeTime] = useState(() => isQuizPrimeTime(new Date()));
  const [refreshing, setRefreshing] = useState(false);
  const [loginPrompt, setLoginPrompt] = useState(false);
  const ready = status === 'ready';
  const focused = useIsFocused();
  const pushToast = useTradingGameStore((s) => s.pushToast);

  // 지지·저항 대응(설계 2026-10-27 §7) — 포지션 보유 + 이 화면을 보는 중일 때만 틱마다 감지.
  // 조건이 빠지면 reset(돌아왔을 때 그사이 움직임으로 시트가 바로 뜨지 않게 기준부터)
  const [srLevels, setSrLevels] = useState<SrLevel[]>([]);
  const [srEvent, setSrEvent] = useState<SrEvent | null>(null);
  const watcherRef = useRef(new SrWatcher());
  const hasPosition = position !== null;
  useEffect(() => {
    const w = watcherRef.current;
    if (!loggedIn || !hasPosition || !focused || lastPrice === null) {
      w.reset();
      return;
    }
    const events = w.update(srLevels, lastPrice, Date.now());
    // 다른 시트가 열려 있으면 버린다(재알림 간격은 이미 적용됨)
    if (events.length > 0 && activeModal === null && !loginPrompt) setSrEvent((cur) => cur ?? events[0]);
  }, [lastPrice, srLevels, hasPosition, focused, loggedIn, activeModal, loginPrompt]);
  // 포지션이 없어지면 남은 이벤트 버림(렌더 중 파생 상태 갱신)
  if (!hasPosition && srEvent !== null) setSrEvent(null);

  // 장운영 상태 배너 초기값 — 화면을 열 때·WS 재연결/앱 복귀(streamEpoch) 때. 이후 변화는 WS market_status
  const seasonTicker = season?.ticker;
  useEffect(() => {
    if (ready && focused) void loadMarketStatus();
  }, [ready, focused, seasonTicker, streamEpoch, loadMarketStatus]);
  // 배너가 떠 있는 동안만 재조회 — 해제 이벤트를 놓쳐 서버가 시간 초과로 정상 처리한 경우에도 배너가 내려가게
  useForegroundInterval(
    () => void loadMarketStatus(),
    MARKET_STATUS_POLL_MS,
    ready && focused && shouldPollMarketStatus(marketStatus),
  );

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

  // 로그아웃 시 로그인 전용 시트 닫기(랭킹·규칙은 공개라 유지)
  useEffect(() => {
    if (!loggedIn) setActiveModal((m) => (m === 'ranking' || m === 'rules' ? m : null));
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

  // 4401 → 로그아웃 + 사유별 안내(SESSION_REPLACED 다른 기기·SESSION_ENDED 로그아웃됨·REFRESH_REUSED 보안 로그아웃·그 외 만료)
  useGameSocket(token, ready, (reason) => expireSession(token, reasonFromCode(reason)));

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

  /** 비로그인 — OS 기본 Alert 대신 앱 디자인의 바텀시트로 안내하고 내정보 탭(간편 로그인)으로 보낸다 */
  const requireLogin = () => setLoginPrompt(true);
  const goLogin = () => {
    setLoginPrompt(false);
    router.push('/(tabs)/profile');
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
        {/* 큰 제목은 생략(하단 탭이 '게임') — 차트가 첫 화면에 더 크게 들어오게 */}
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
          onOpenRules={() => setActiveModal('rules')}
        />
        {/* 차트를 위로 — 아래 고정 주문 바와 한 화면에 들어오게. 코치·심리·안내는 차트 아래 */}
        <MarketStatusBanner status={marketStatus} />
        <DailyChart ticker={season.ticker} lastPrice={lastPrice} coach={coach} position={position} onSrLevels={setSrLevels} />
        {position ? (
          <PositionCard position={position} lastPrice={lastPrice} closing={closing} onClose={() => void closePosition()} />
        ) : null}
        {loggedIn ? null : (
          // 비로그인 — 주문 버튼은 눌러도 로그인 안내만 뜨므로, 무엇을 하는 곳인지와 참여 방법을 먼저 알린다(웹과 같은 문구)
          <Card>
            <Text style={styles.guestTitle}>로그인하고 참여해 보세요</Text>
            <Text style={styles.guestText}>가상 자금으로 실시간 시세에 상승·하락 주문을 넣고 주간 순위를 겨뤄요. 실제 돈은 들지 않아요.</Text>
            <Button label="로그인" onPress={goLogin} />
          </Card>
        )}
        <CoachBanner coach={coach} />
        <SentimentBar sentiment={sentiment} />
        {primeTime && !quizDisabled ? <QuizBanner onOpen={() => openPrivate('quiz')} /> : null}
      </ScrollView>
      {/* 주문 바는 스크롤 밖 화면 아래 고정(탭 바 바로 위) — 차트를 보면서 바로 건다 */}
      <OrderPanel
        hasPosition={position !== null}
        academyUnlocked={academyUnlocked}
        submitting={submitting}
        onOrder={handleOrder}
        onLockedLeverage={() => openPrivate('academy')}
        onOpenRules={() => setActiveModal('rules')}
      />

      {/* 시트가 열려 있으면 토스트는 시트 안(Sheet → GameToaster)에서 보인다 — 화면 오버레이는 시트에 가려지므로 숨김 */}
      {activeModal === null ? <GameToaster /> : null}
      {activeModal === 'ranking' ? (
        <LeaderboardSheet seasonId={season.id} seasonPeriod={season.period} myUserId={userId} onClose={closeModal} />
      ) : null}
      {activeModal === 'rules' ? <RulesSheet season={season} onClose={closeModal} /> : null}
      {activeModal === 'quest' ? <QuestSheet onClose={closeModal} /> : null}
      {activeModal === 'academy' ? <AcademySheet onClose={closeModal} /> : null}
      {activeModal === 'quiz' ? <QuizSheet onClose={closeModal} /> : null}
      {activeModal === 'streak' ? <StreakRewardSheet onClose={closeModal} /> : null}
      {srEvent !== null && position !== null ? (
        <SrActionSheet
          event={srEvent}
          name={srEventName(srEvent.type)}
          position={position}
          closing={closing}
          onClosePosition={() => {
            setSrEvent(null);
            void closePosition();
          }}
          onHold={() => {
            setSrEvent(null);
            pushToast({ kind: 'info', icon: '✊', message: '홀딩을 선택했어요. 다음 지지·저항에서 다시 알려 드릴게요.' });
          }}
          onDismiss={() => setSrEvent(null)}
        />
      ) : null}
      {loginPrompt ? (
        <BottomSheet title="로그인이 필요해요" onClose={() => setLoginPrompt(false)}>
          <Text style={styles.sheetText}>내정보 탭에서 간편 로그인으로 시작하고{'\n'}시즌에 참여해 보세요.</Text>
          <Button label="로그인하러 가기" onPress={goLogin} />
          <Button label="다음에 할게요" variant="secondary" onPress={() => setLoginPrompt(false)} />
        </BottomSheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1, backgroundColor: theme.colors.background },
  grow: { flexGrow: 1 },
  content: { paddingHorizontal: theme.gap(1.5), paddingBottom: theme.gap(4), gap: theme.gap(1) },
  screenTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: theme.colors.text,
    paddingHorizontal: theme.gap(2.5),
    paddingTop: theme.gap(2),
  },
  guestTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  guestText: { fontSize: 14, lineHeight: 20, color: theme.colors.textSecondary, marginTop: theme.gap(0.5), marginBottom: theme.gap(1.5) },
  sheetText: { fontSize: 15, lineHeight: 22, color: theme.colors.textSecondary, marginBottom: theme.gap(0.5) },
}));
