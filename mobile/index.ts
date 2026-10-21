// Unistyles를 먼저 초기화(StyleSheet.configure)한 뒤 앱을 부팅한다.
import './unistyles';
// 백그라운드 태스크 정의 — 화면 없이 깨어날 때(앱 종료 상태의 무음 push·정기 작업)는 라우트(_layout)가 평가되지 않으므로 엔트리에서
import './src/features/fund/background/tasks';
import 'expo-router/entry';
