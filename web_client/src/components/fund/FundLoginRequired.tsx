import { FUND_LOGIN_DESCRIPTION } from '../../lib/fundGate'
import { openLogin } from '../../store/loginPrompt'
import Button from '../ui/Button'
import Card from '../ui/Card'
import EmptyState from '../ui/EmptyState'
import PageHeader from '../ui/PageHeader'

// 비로그인으로 내 펀드 화면(/me/funds, /me/funds/:id)에 직접 들어왔을 때 — 다른 곳으로 튕기지 않고 로그인 안내 카드를 보여 준다.
// 로그인 후에는 지금 보던 주소로 돌아온다(returnTo).
export default function FundLoginRequired({ returnTo }: { returnTo: string }) {
  return (
    <div>
      <PageHeader title="내 펀드" className="mb-5" />
      <Card>
        <EmptyState
          emoji="🔒"
          title="로그인이 필요한 메뉴예요"
          description="로그인 후 내 펀드 수익률과 운용 리포트를 확인해 보세요"
          action={
            <Button onClick={() => openLogin({ description: FUND_LOGIN_DESCRIPTION, returnTo })}>로그인하기</Button>
          }
        />
      </Card>
    </div>
  )
}
