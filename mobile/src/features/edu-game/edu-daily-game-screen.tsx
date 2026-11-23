import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { useAuthStore } from '@/features/auth/store';
import { formatPrice } from '@/features/game/lib/format';
import { useForegroundInterval } from '@/features/game/lib/foreground-interval';
import { noteEduEnabled } from '@/features/market-access/use-edu-game-access';
import { BottomSheet, Button, Card, formatPct, formatWon, ListState, ProfileHeaderButton, showToast } from '@/ui';

import { getEduLeaderboard, getEduState, submitEduAction } from './api';
import { EduActionPanel } from './components/edu-action-panel';
import { EduChart } from './components/edu-chart';
import { EduCrowdBar } from './components/edu-crowd-bar';
import { EduLeaderboardCard } from './components/edu-leaderboard-card';
import { crowdVisible, eduErrorInfo, eduPanelMode, statusChipLabel } from './lib/edu-game';
import type { EduActionRequest, EduLeaderboard, EduState } from './types';

const CLOCK_TICK_MS = 30_000; // 남은 시간 문구 갱신
const SETTLE_GRACE_MS = 2 * 60_000; // 정산 시각이 이만큼 지나면 새 캔들을 받으러 한 번 다시 묻는다
const DEFAULT_DISCLAIMER = '본 차트는 투자 교육을 위해 서버가 자체 생성한 가상 일봉 데이터이며 실제 상장 종목과 무관합니다.';

/**
 * 교육용 합성 종가 게임 화면(docs/edu_synthetic_daily_game_spec_and_plan.md 5절) — 실시간 게임(GameScreen)과 완전히 별개.
 * 헤더(배지·표시명·종가·등락·오늘 참가 상태) → 차트(합성 일봉 + 이평·볼린저·매물대 POC·지지/저항) → 면책 → 코치 해설
 * → 의사결정 패널(비로그인/제출 완료/미보유/보유) → 참가자 비율(제출 뒤 공개) → 시즌 순위.
 * 탭 포커스·로그인 사용자 변경·당겨서 새로고침 때 상태를 다시 받는다. 서버 오류 문구는 그대로 토스트로.
 */
export function EduDailyGameScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const viewer = useAuthStore((s) => s.user?.id ?? null);

  const [state, setState] = useState<EduState | null>(null);
  const [failed, setFailed] = useState(false);
  const [board, setBoard] = useState<EduLeaderboard | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loginPrompt, setLoginPrompt] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // 늦게 온 이전 응답이 새 응답을 덮지 않게 요청 번호로 거른다
  const reqSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++reqSeq.current;
    try {
      const s = await getEduState();
      if (seq !== reqSeq.current) return;
      setState(s);
      setFailed(false);
      setNowMs(Date.now());
      noteEduEnabled(s.enabled, s.real_market_switch); // 탭 노출·게임 모드 판단값도 맞춘다(관리자가 끈 직후 등)
      if (s.enabled) {
        getEduLeaderboard()
          .then((b) => {
            if (seq === reqSeq.current) setBoard(b);
          })
          .catch(() => undefined); // 순위는 부가 정보 — 실패하면 이전 값 유지
      }
    } catch {
      if (seq === reqSeq.current) setFailed(true); // 받아 둔 화면이 있으면 그대로 두고 오류 상태만
    }
  }, []);

  // 탭 포커스(처음 포함)·로그인 사용자 변경 때 재조회 — 탭은 마운트된 채 유지되므로 다시 들어올 때도 최신으로
  const focused = useIsFocused();
  useFocusEffect(
    useCallback(() => {
      void load();
      // viewer: 로그인·로그아웃하면 포커스 중이어도 다시 받는다(콜백이 바뀌어야 다시 실행됨)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, viewer]),
  );

  // 남은 시간 문구 갱신 + 정산 시각이 지나면 한 번 새로 받기(새 캔들·참가 가능 상태)
  const reloadedFor = useRef<string | null>(null);
  useForegroundInterval(
    () => {
      const now = Date.now();
      setNowMs(now);
      const next = state?.next_settlement_at ?? null;
      if (next && reloadedFor.current !== next && Date.parse(next) + SETTLE_GRACE_MS < now) {
        reloadedFor.current = next;
        void load();
      }
    },
    CLOCK_TICK_MS,
    focused && state?.enabled === true,
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const onSubmit = async (req: EduActionRequest) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      // 보고 있던 봉 번호를 함께 — 그사이 정산으로 새 캔들이 열렸으면 서버가 409 STALE_DAY(못 본 종가로 체결 방지)
      const res = await submitEduAction({ ...req, day_index: state?.season?.current_day_index });
      const bonus = res.bonus_cash_awarded > 0 ? ` (+${formatWon(res.bonus_cash_awarded)})` : '';
      const streak = res.streak !== null && res.streak > 1 ? ` 🔥 ${res.streak}일 연속 참가!` : '';
      showToast(`${req.action === 'HOLD_WATCH' ? '👏 ' : ''}${res.message}${bonus}${streak}`);
      await load();
    } catch (err) {
      const info = eduErrorInfo(err);
      showToast(info.message);
      // 이미 참가함(→ 제출 완료 패널)·새 캔들 열림 STALE_DAY(→ 새 봉으로 다시 결정 가능)·꺼짐 → 서버 상태로 맞춘다
      if (info.stale) await load();
    } finally {
      setSubmitting(false);
    }
  };

  const goLogin = () => {
    setLoginPrompt(false);
    router.push('/(tabs)/profile');
  };

  const header = (
    <View style={styles.compactRow}>
      <Text style={styles.compactTitle} accessibilityRole="header">종가 게임</Text>
      <ProfileHeaderButton />
    </View>
  );

  if (state === null || !state.enabled || !state.season || !state.today) {
    return (
      <View style={[styles.flex, { paddingTop: insets.top }]}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, styles.grow, { paddingTop: 8 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}>
          {header}
          {state === null && !failed ? (
            <ListState mode="loading" />
          ) : state === null ? (
            <ListState mode="error" title="게임 서버에 연결할 수 없어요" hint="잠시 후 다시 시도해 주세요." onRetry={() => void load()} />
          ) : (
            <ListState mode="empty" emoji="📘" title="지금은 종가 게임이 열려 있지 않아요" hint="곧 다시 열릴 예정이에요." />
          )}
        </ScrollView>
      </View>
    );
  }

  const { season, today, account } = state;
  const mode = eduPanelMode(state);
  const changeStyle = today.change_pct > 0 ? styles.up : today.change_pct < 0 ? styles.down : null;
  const position = account?.position ?? null;

  return (
    <View style={styles.flex}>
      <ScrollView
        style={[styles.flex, { marginTop: insets.top }]}
        contentContainerStyle={[styles.content, { paddingTop: 8 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}>
        {header}
        {/* 헤더: 배지 + 오늘 참가 상태 칩 / 표시명 / 종가·등락 / 내 계좌 요약 */}
        <Card>
          <View style={styles.badgeRow}>
            <Text style={styles.badge}>📘 교육용 종가 게임</Text>
            <Text style={[styles.status, mode === 'submitted' ? styles.statusDone : null]}>
              {statusChipLabel(mode, state.next_settlement_at)}
            </Text>
          </View>
          <Text style={styles.name} numberOfLines={2}>
            {season.display_name}
          </Text>
          <View style={styles.priceRow}>
            <Text style={styles.price}>{formatPrice(today.close)}원</Text>
            <Text style={[styles.change, changeStyle]}>{formatPct(today.change_pct)}</Text>
            <Text style={styles.day}>{`Day ${season.current_day_index} · ${today.date}`}</Text>
          </View>
          {account ? (
            <View style={styles.accountRow}>
              <Stat label="총자산" value={formatWon(account.total_asset)} />
              <Stat label="수익률" value={formatPct(account.current_roi)} tone={account.current_roi} />
              <Stat label="참가" value={`${account.participation_days}일`} />
            </View>
          ) : null}
        </Card>
        <EduChart candles={state.candles} today={today} position={position} />
        <Text style={styles.disclaimer}>{state.disclaimer ?? DEFAULT_DISCLAIMER}</Text>
        {today.coach_comment || today.pattern_tag ? (
          <Card style={styles.coach}>
            <Text style={styles.coachTitle}>🧑‍🏫 오늘의 차트 해설</Text>
            {today.pattern_tag ? <Text style={styles.tag}>{today.pattern_tag}</Text> : null}
            {today.coach_comment ? <Text style={styles.coachText}>{today.coach_comment}</Text> : null}
          </Card>
        ) : null}
        <EduActionPanel
          state={state}
          mode={mode}
          submitting={submitting}
          nowMs={nowMs}
          onSubmit={(req) => void onSubmit(req)}
          onLogin={() => setLoginPrompt(true)}
        />
        {crowdVisible(mode) ? (
          <Card>
            <EduCrowdBar crowd={state.crowd} />
          </Card>
        ) : null}
        <EduLeaderboardCard board={board} />
      </ScrollView>
      {loginPrompt ? (
        <BottomSheet title="로그인이 필요해요" onClose={() => setLoginPrompt(false)}>
          <Text style={styles.sheetText}>내정보 탭에서 간편 로그인으로 시작하고{'\n'}오늘의 종가 게임에 참가해 보세요.</Text>
          <Button label="로그인하러 가기" onPress={goLogin} />
          <Button label="다음에 할게요" variant="secondary" onPress={() => setLoginPrompt(false)} />
        </BottomSheet>
      ) : null}
    </View>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: number }) {
  const color = tone === undefined || tone === 0 ? null : tone > 0 ? styles.up : styles.down;
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, color]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1, backgroundColor: theme.colors.background },
  grow: { flexGrow: 1 },
  content: { paddingHorizontal: theme.gap(1.5), paddingBottom: theme.gap(4), gap: theme.gap(1) },
  compactRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: theme.gap(1), marginTop: -theme.gap(0.5) },
  compactTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.textSecondary },
  badgeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.gap(1), marginBottom: theme.gap(1) },
  badge: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.primary,
    backgroundColor: theme.colors.primarySoft,
    borderRadius: theme.radius.chip,
    paddingVertical: 4,
    paddingHorizontal: theme.gap(1),
    overflow: 'hidden',
  },
  status: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.safe,
    backgroundColor: theme.colors.safeSoft,
    borderRadius: theme.radius.chip,
    paddingVertical: 4,
    paddingHorizontal: theme.gap(1),
    overflow: 'hidden',
  },
  statusDone: { color: theme.colors.textSecondary, backgroundColor: theme.colors.fill },
  name: { fontSize: 18, fontWeight: '700', color: theme.colors.text },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: theme.gap(1), marginTop: theme.gap(0.5), flexWrap: 'wrap' },
  price: { fontSize: 24, fontWeight: '800', color: theme.colors.text },
  change: { fontSize: 15, fontWeight: '700', color: theme.colors.textSecondary },
  day: { fontSize: 12, color: theme.colors.textSecondary, marginLeft: 'auto' },
  up: { color: theme.colors.up },
  down: { color: theme.colors.down },
  accountRow: {
    flexDirection: 'row',
    marginTop: theme.gap(1.5),
    paddingTop: theme.gap(1.5),
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  stat: { flex: 1, gap: 2 },
  statLabel: { fontSize: 12, color: theme.colors.textSecondary },
  statValue: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  disclaimer: { fontSize: 11, lineHeight: 16, color: theme.colors.textSecondary, paddingHorizontal: theme.gap(1) },
  coach: { backgroundColor: theme.colors.surfaceBlue },
  coachTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.text, marginBottom: theme.gap(0.75) },
  tag: {
    alignSelf: 'flex-start',
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.primary,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.chip,
    paddingVertical: 3,
    paddingHorizontal: theme.gap(1),
    overflow: 'hidden',
    marginBottom: theme.gap(0.75),
  },
  coachText: { fontSize: 14, lineHeight: 21, color: theme.colors.text },
  sheetText: { fontSize: 15, lineHeight: 22, color: theme.colors.textSecondary, marginBottom: theme.gap(0.5) },
}));
