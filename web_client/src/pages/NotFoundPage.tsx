import { useNavigate } from 'react-router-dom'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'

// 없는 주소 — 말없이 홈으로 보내지 않고 이유를 알려 준 뒤 홈·스크리너로 갈 수 있게. 탭 제목은 Layout(lib/pageTitle)이 넣는다
export default function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <EmptyState
      emoji="🧭"
      title="페이지를 찾을 수 없어요"
      description="주소가 바뀌었거나 없어진 페이지예요. 주소를 다시 확인해 주세요."
      action={
        <div className="flex gap-2">
          <Button onClick={() => navigate('/')}>홈으로</Button>
          <Button variant="secondary" onClick={() => navigate('/screener')}>스크리너</Button>
        </div>
      }
    />
  )
}
