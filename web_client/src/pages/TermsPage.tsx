import { Link } from 'react-router-dom'
import PolicyArticle, { PolicySection, SupportMail } from '../components/PolicyArticle'

const linkClass = 'font-semibold text-ink underline underline-offset-2'

// 이용약관 — 첫 로그인 때 동의를 받는다(서버 TERMS_VERSION 과 시행일을 함께 바꾼다).
// Play UGC 정책: 콘텐츠를 만들기 전에 동의를 받고, 금지 콘텐츠를 약관에 정의해야 한다.
export default function TermsPage() {
  return (
    <PolicyArticle
      title="이용약관"
      effectiveDate="2026년 11월 13일"
      intro={
        <p>
          이 약관은 FunNote(이하 &lsquo;서비스&rsquo;)를 이용할 때 이용자와 운영자(FunNote 운영팀) 사이의 권리·의무를 정합니다.
          간편 로그인으로 처음 가입할 때 이 약관에 동의해야 회원 기능을 이용할 수 있습니다.
        </p>
      }>
      <PolicySection title="1. 서비스 내용">
        <ul>
          <li>국내외 증시 시황, 종목·테마 정보, AI가 정리한 시장 요약 등 정보 제공</li>
          <li>가상 자금으로 하는 모의투자 게임과 랭킹</li>
          <li>펀드 수익률 기록(기기에만 저장)과 알림</li>
        </ul>
        <p>서비스는 무료이며, 운영상 필요에 따라 기능을 바꾸거나 중단할 수 있습니다. 중요한 변경은 미리 알립니다.</p>
      </PolicySection>

      <PolicySection title="2. 투자 정보에 관한 고지">
        <ul>
          <li>
            서비스가 제공하는 모든 정보는 <strong>참고용</strong>이며 특정 종목의 매수·매도를 권유하거나 투자 자문을 하지 않습니다.
          </li>
          <li>정보는 지연되거나 틀릴 수 있습니다. 투자 판단과 그 결과의 책임은 이용자 본인에게 있습니다.</li>
          <li>
            서비스는 증권 매매, 계좌 연동, 자금 이체를 하지 않습니다. <strong>모의투자 게임은 실제 돈이 오가지 않는 가상 자금</strong>
            으로 진행되며, 게임 안의 자산·보상은 현금이나 다른 재산으로 바꿀 수 없습니다.
          </li>
        </ul>
      </PolicySection>

      <PolicySection title="3. 금지 행위">
        <p>이용자는 닉네임, 댓글 등 서비스에 올리는 내용에 다음을 담아서는 안 됩니다.</p>
        <ul>
          <li>욕설, 비하, 혐오 표현, 특정인에 대한 괴롭힘이나 위협</li>
          <li>음란하거나 폭력적인 내용, 불법 정보</li>
          <li>스팸, 광고, 유료 리딩방·투자 사기 권유, 시세 조종을 노린 허위 정보</li>
          <li>다른 사람의 개인정보 노출, 명예훼손, 저작권 등 권리 침해</li>
          <li>다른 사람이나 운영자를 사칭하는 행위, 서비스 운영을 방해하는 행위(비정상 접근, 자동화된 대량 요청 등)</li>
        </ul>
      </PolicySection>

      <PolicySection title="4. 신고와 조치">
        <ul>
          <li>부적절한 내용을 발견하면 앱의 신고 기능이나 <SupportMail /> 로 알려 주세요.</li>
          <li>
            운영자는 신고나 자체 확인으로 금지 행위를 발견하면 해당 내용을 숨기거나 삭제하고, 정도에 따라 댓글 작성 제한, 이용 정지,
            회원 자격 박탈 조치를 할 수 있습니다.
          </li>
          <li>이용자는 원하지 않는 다른 이용자를 차단할 수 있습니다.</li>
        </ul>
      </PolicySection>

      <PolicySection title="5. 계정">
        <ul>
          <li>계정은 본인만 사용해야 하며, 다른 사람에게 빌려주거나 넘길 수 없습니다.</li>
          <li>
            이용자는 언제든지 앱이나 웹의 내정보에서 탈퇴할 수 있습니다(
            <Link to="/account-deletion" className={linkClass}>계정 삭제 안내</Link>). 개인정보 처리는{' '}
            <Link to="/privacy" className={linkClass}>개인정보처리방침</Link>을 따릅니다.
          </li>
        </ul>
      </PolicySection>

      <PolicySection title="6. 책임의 한계">
        <ul>
          <li>운영자는 천재지변, 통신 장애, 외부 데이터 제공처의 오류처럼 운영자 책임이 아닌 사유로 생긴 손해를 책임지지 않습니다.</li>
          <li>운영자는 서비스 정보를 이용한 투자로 생긴 손익을 책임지지 않습니다.</li>
          <li>무료 서비스 특성상, 운영자의 고의 또는 중대한 과실이 없는 한 서비스 이용과 관련한 손해를 책임지지 않습니다.</li>
        </ul>
      </PolicySection>

      <PolicySection title="7. 약관의 변경과 문의">
        <p>
          약관을 바꾸면 시행 7일 전부터 서비스 안에서 알리고, 바뀐 약관에 다시 동의를 받을 수 있습니다. 이 약관은 대한민국 법을
          따릅니다. 문의는 <SupportMail /> 로 보내 주세요.
        </p>
      </PolicySection>
    </PolicyArticle>
  )
}
