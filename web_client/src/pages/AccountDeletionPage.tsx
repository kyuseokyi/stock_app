import { Link } from 'react-router-dom'
import PolicyArticle, { PolicySection, SupportMail } from '../components/PolicyArticle'

// 계정 삭제 안내 — Google Play 데이터 보안 양식의 '앱 밖에서 삭제를 요청하는 방법' 주소. 로그인 없이 읽혀야 한다.
// 삭제 범위는 backend/apps/auth/services/account_deletion.py 와 맞춘다.
export default function AccountDeletionPage() {
  return (
    <PolicyArticle
      title="계정 삭제 안내"
      effectiveDate="2026년 11월 12일"
      intro={
        <p>
          FunNote 계정과 관련 데이터는 언제든지 직접 삭제할 수 있습니다. 앱을 지운 경우에도 아래 방법으로 삭제를 요청할 수
          있습니다.
        </p>
      }>
      <PolicySection title="1. 바로 삭제하기">
        <ul>
          <li>
            <strong>앱</strong>: 내정보 → 맨 아래 &lsquo;회원 탈퇴&rsquo; → 확인
          </li>
          <li>
            <strong>웹</strong>: <Link to="/me" className="font-semibold text-ink underline underline-offset-2">내정보</Link>{' '}
            에서 로그인 → &lsquo;회원 탈퇴&rsquo; → 확인
          </li>
        </ul>
        <p>탈퇴는 바로 처리되며 되돌릴 수 없습니다.</p>
      </PolicySection>

      <PolicySection title="2. 로그인할 수 없을 때 — 메일로 요청">
        <p>
          <SupportMail /> 로 &lsquo;계정 삭제 요청&rsquo;이라고 보내 주세요. 가입할 때 쓴 간편 로그인 종류(카카오·네이버)와
          서비스에서 쓰던 닉네임을 적어 주시면 본인 확인 후 영업일 기준 7일 안에 삭제하고 결과를 회신합니다.
        </p>
      </PolicySection>

      <PolicySection title="3. 삭제되는 데이터">
        <ul>
          <li>회원 정보(간편 로그인 식별번호, 닉네임)와 로그인 유지 정보</li>
          <li>작성한 댓글</li>
          <li>푸시 알림 토큰과 알림 설정</li>
          <li>모의투자 게임 기록(계좌, 거래, 출석, 퀴즈, 이번 시즌 랭킹)</li>
          <li>앱에서 탈퇴한 경우, 그 기기에 저장된 펀드 기록</li>
        </ul>
      </PolicySection>

      <PolicySection title="4. 남는 데이터">
        <ul>
          <li>
            지난 시즌 랭킹·명예의 전당 기록은 닉네임을 &lsquo;탈퇴한 회원&rsquo;으로 바꿔 누구인지 알 수 없게 한 뒤 남습니다.
          </li>
          <li>
            Google Drive에 백업한 펀드 기록은 이용자 본인 Drive에 있어 서비스가 지울 수 없습니다. Google Drive → 설정 → 앱
            관리에서 FunNote 데이터를 삭제할 수 있습니다.
          </li>
          <li>
            카카오 간편 로그인 연결은 탈퇴 시 자동으로 해제됩니다. 네이버는 네이버 내정보 → 이력관리 → 외부 사이트 연결에서
            FunNote 연결을 해제해 주세요.
          </li>
        </ul>
        <p>
          자세한 내용은 <Link to="/privacy" className="font-semibold text-ink underline underline-offset-2">개인정보처리방침</Link>을
          확인해 주세요.
        </p>
      </PolicySection>
    </PolicyArticle>
  )
}
