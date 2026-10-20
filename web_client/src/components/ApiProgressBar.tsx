import { useEffect, useState } from 'react'
import { isApiBusy, subscribeApiBusy } from '../lib/apiActivity'

/** 이보다 빨리 끝난 요청은 표시하지 않는다(짧은 요청·주기 조회마다 깜빡이지 않게) */
const SHOW_DELAY_MS = 200

/** API 요청이 진행 중이면 화면 맨 위 얇은 진행 표시줄(좌→우 반복). 앱에 한 번만 둔다. */
export default function ApiProgressBar() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onChange = (busy: boolean) => {
      if (timer) clearTimeout(timer)
      timer = undefined
      if (busy) timer = setTimeout(() => setVisible(true), SHOW_DELAY_MS)
      else setVisible(false)
    }
    onChange(isApiBusy())
    const unsub = subscribeApiBusy(onChange)
    return () => {
      unsub()
      if (timer) clearTimeout(timer)
    }
  }, [])

  if (!visible) return null
  return (
    <div
      role="progressbar"
      aria-label="불러오는 중"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px] overflow-hidden"
    >
      <div className="api-progress-bar h-full w-[35%] rounded-full bg-brand" />
    </div>
  )
}
