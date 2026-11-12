import { Link } from 'react-router-dom'
import PolicyArticle, { PolicySection, SupportMail } from '../components/PolicyArticle'

// 개인정보처리방침 — 서버가 실제로 저장하는 항목(shared/models.py)·탈퇴 처리(account_deletion.py)와 맞춘다.
// 수집 항목이나 외부 서비스가 바뀌면 이 문서와 시행일을 같이 고친다.
export default function PrivacyPage() {
  return (
    <PolicyArticle
      title="개인정보처리방침"
      effectiveDate="2026년 11월 12일"
      intro={
        <p>
          FunNote(이하 &lsquo;서비스&rsquo;)는 이용자의 개인정보를 소중히 다루며, 「개인정보 보호법」에 따라 아래와 같이
          개인정보를 처리합니다. 서비스는 서비스에 꼭 필요한 최소한의 정보만 받습니다.
        </p>
      }>
      <PolicySection title="1. 처리하는 개인정보 항목과 목적">
        <ul>
          <li>
            <strong>회원 가입·로그인(카카오·네이버 간편 로그인)</strong>: 간편 로그인 회원 식별번호, 닉네임 — 회원 식별과
            서비스 화면의 이름 표시. 이메일·전화번호·실명은 받지 않습니다.
          </li>
          <li>
            <strong>서비스 이용 중 생기는 정보</strong>: 작성한 댓글, 모의투자 게임 기록(가상 자금 거래·출석·퀴즈·랭킹),
            로그인 유지 정보 — 게시판·게임 기능 제공.
          </li>
          <li>
            <strong>알림(선택)</strong>: 푸시 알림 토큰, 알림 설정 — 알림을 켠 경우에만 시황·공지 알림 발송.
          </li>
        </ul>
      </PolicySection>

      <PolicySection title="2. 서버에 저장하지 않는 정보 — 펀드 기록">
        <p>
          &lsquo;내 펀드&rsquo;에 등록한 펀드 주소와 수익률 기록은 <strong>이용자의 기기(앱) 또는 브라우저에만</strong>{' '}
          저장되며 서비스 서버로 보내지 않습니다.
        </p>
        <p>
          앱에서 Google Drive 백업을 직접 켠 경우, 기록은 <strong>이용자 본인 Google Drive의 앱 전용 공간</strong>에
          저장됩니다. 서비스 운영자는 이 백업에 접근할 수 없으며, 백업은 이용자가 앱에서 연결을 해제하거나 Google 계정 설정에서
          삭제할 수 있습니다.
        </p>
        <p>백업하지 않고 앱을 삭제하면 기기에 있던 펀드 기록은 되살릴 수 없습니다.</p>
      </PolicySection>

      <PolicySection title="3. 보유 기간과 파기">
        <ul>
          <li>회원 정보는 회원 탈퇴 시 지체 없이 삭제합니다.</li>
          <li>탈퇴하면 작성한 댓글, 알림 토큰, 게임 기록이 함께 삭제됩니다.</li>
          <li>
            지난 시즌 랭킹·명예의 전당처럼 다른 이용자에게 공개된 기록은 닉네임을 &lsquo;탈퇴한 회원&rsquo;으로 바꿔 누구인지
            알 수 없게 처리한 뒤 남길 수 있습니다.
          </li>
          <li>전자 파일은 복구할 수 없는 방법으로 삭제합니다.</li>
        </ul>
      </PolicySection>

      <PolicySection title="4. 제3자 제공">
        <p>서비스는 이용자의 개인정보를 제3자에게 제공하지 않습니다. 법령에 따른 요청이 있는 경우는 예외로 합니다.</p>
      </PolicySection>

      <PolicySection title="5. 처리 위탁과 국외 이전">
        <p>서비스 운영을 위해 아래 업체의 서비스를 이용합니다.</p>
        <ul>
          <li>
            <strong>Oracle Cloud</strong> — 서버 운영과 데이터 보관
          </li>
          <li>
            <strong>Cloudflare, Inc.(미국)</strong> — 접속 경로 보호와 트래픽 중계
          </li>
          <li>
            <strong>Expo(650 Industries, Inc., 미국)·Google Firebase Cloud Messaging(미국)</strong> — 푸시 알림 발송(푸시 알림
            토큰, 알림 내용). 알림을 켠 경우에만 해당하며, 알림 발송 시 네트워크로 전송됩니다.
          </li>
          <li>
            <strong>카카오·네이버</strong> — 간편 로그인 인증
          </li>
        </ul>
        <p>국외 이전을 원하지 않으면 앱에서 알림을 끄거나 회원 탈퇴를 할 수 있습니다.</p>
      </PolicySection>

      <PolicySection title="6. 이용자의 권리와 행사 방법">
        <ul>
          <li>이용자는 언제든지 자신의 개인정보 열람·정정·삭제·처리 정지를 요구할 수 있습니다.</li>
          <li>
            회원 탈퇴는 앱 &lsquo;내정보 → 회원 탈퇴&rsquo; 또는 웹 &lsquo;내정보 → 회원 탈퇴&rsquo;에서 바로 할 수 있습니다.
            자세한 내용은 <Link to="/account-deletion" className="font-semibold text-ink underline underline-offset-2">계정 삭제 안내</Link>를
            확인해 주세요.
          </li>
          <li>
            간편 로그인 연결 해제는 카카오(카카오계정 → 연결된 서비스 관리), 네이버(내정보 → 이력관리 → 외부 사이트 연결)에서도
            할 수 있습니다.
          </li>
        </ul>
      </PolicySection>

      <PolicySection title="7. 자동 수집 장치">
        <p>
          웹에서는 로그인 유지와 펀드 기록 저장을 위해 브라우저 저장소를 사용합니다. 광고 추적이나 행태 분석을 위한 쿠키는 사용하지
          않습니다. 브라우저 설정에서 저장된 정보를 지울 수 있습니다.
        </p>
      </PolicySection>

      <PolicySection title="8. 안전성 확보 조치">
        <ul>
          <li>모든 통신은 암호화(HTTPS)해 전송합니다.</li>
          <li>개인정보에 접근할 수 있는 사람을 운영자로 한정하고, 데이터베이스는 외부에서 직접 접속할 수 없게 막아 둡니다.</li>
          <li>로그인 정보는 서명된 토큰으로 관리하며, 관리자 비밀번호는 암호화해 저장합니다.</li>
        </ul>
      </PolicySection>

      <PolicySection title="9. 만 14세 미만 아동">
        <p>서비스는 만 14세 미만 아동의 회원 가입을 받지 않습니다.</p>
      </PolicySection>

      <PolicySection title="10. 개인정보 보호책임자">
        <p>
          FunNote 운영팀 · <SupportMail />
        </p>
        <p>
          개인정보 침해에 대한 신고나 상담은 개인정보침해신고센터(privacy.kisa.or.kr, 국번 없이 118)나
          개인정보분쟁조정위원회(kopico.go.kr, 1833-6972)에도 할 수 있습니다.
        </p>
      </PolicySection>

      <PolicySection title="11. 처리방침의 변경">
        <p>이 처리방침이 바뀌면 시행 7일 전부터 서비스 공지와 이 페이지를 통해 알립니다.</p>
      </PolicySection>
    </PolicyArticle>
  )
}
