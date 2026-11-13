import { Link } from 'react-router-dom'
import PolicyArticle, { PolicySection, SupportMail } from '../components/PolicyArticle'

const linkClass = 'font-semibold text-ink underline underline-offset-2'

// 고객지원 — App Store '지원 URL'(실제 연락처로 이어져야 함)과 Play 연락처로 낸다. 로그인 없이 열린다.
export default function SupportPage() {
  return (
    <PolicyArticle
      title="고객지원"
      effectiveDate="2026년 11월 13일"
      intro={
        <p>
          FunNote 이용 중 궁금한 점이나 불편한 점은 <SupportMail /> 로 보내 주세요. 영업일 기준 3일 안에 답장드립니다.
        </p>
      }>
      <PolicySection title="문의할 때 적어 주세요">
        <ul>
          <li>사용 기기(Android·iPhone·웹)와 앱 버전(내정보 맨 아래)</li>
          <li>로그인 방법(카카오·네이버)과 닉네임 — 계정 관련 문의일 때</li>
          <li>문제가 생긴 화면과 상황, 가능하면 화면 캡처</li>
        </ul>
      </PolicySection>

      <PolicySection title="자주 묻는 질문">
        <p>
          <strong>로그인이 안 돼요.</strong> 카카오·네이버 앱에서 로그인 상태를 확인한 뒤 다시 시도해 주세요. 다른 기기에서
          로그인하면 이전 기기는 자동으로 로그아웃됩니다.
        </p>
        <p>
          <strong>펀드 기록을 새 폰으로 옮기고 싶어요.</strong> 기록은 기기에만 저장됩니다. 앱의 내 펀드 → 기록 백업에서 Google
          Drive를 연결해 두면, 새 폰에서 같은 Google 계정으로 연결해 되살릴 수 있습니다. 백업하지 않고 앱을 지우면 기록을 되살릴 수
          없습니다.
        </p>
        <p>
          <strong>알림을 끄고 싶어요.</strong> 휴대폰 설정 → 알림 → FunNote에서 끌 수 있습니다.
        </p>
        <p>
          <strong>투자 추천을 해 주나요?</strong> 아니요. FunNote는 시장 정보와 기록 도구를 제공할 뿐 투자 권유나 자문을 하지
          않으며, 모의투자 게임은 실제 돈이 오가지 않는 가상 자금으로 진행됩니다.
        </p>
      </PolicySection>

      <PolicySection title="정책">
        <ul>
          <li>
            <Link to="/terms" className={linkClass}>이용약관</Link>
          </li>
          <li>
            <Link to="/privacy" className={linkClass}>개인정보처리방침</Link>
          </li>
          <li>
            <Link to="/account-deletion" className={linkClass}>계정 삭제 안내</Link>
          </li>
        </ul>
      </PolicySection>
    </PolicyArticle>
  )
}
