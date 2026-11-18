import { FundListScreen } from '../fund/index';

/**
 * 하단 탭 '내 펀드'(/funds) — 내정보 메뉴·푸시 알림에서 여는 스택 화면(/fund)과 같은 목록 화면을 탭 모양으로 쓴다.
 * 펀드 리포트·히스토리·백업은 지금처럼 /fund/... 스택 경로로 연다(푸시 딥링크 경로 그대로).
 * 비로그인 탭 터치는 탭 레이아웃이 막고 안내 시트를 띄운다. 그래도 들어오면(딥링크·로그아웃) 화면 가운데 로그인 안내 카드.
 */
export default function FundsTab() {
  return <FundListScreen variant="tab" />;
}
