// 클라이언트 토스트 — 전역 마운트된 NotificationToaster 가 window 이벤트로 수신해
// 우측 하단에 표시한다(별도 상태관리/라이브러리 없이 어디서든 호출 가능).
//   showToast('저장되었습니다')            // 기본(🔔)
//   showToast('이름을 입력하세요', { icon: '⚠️' })
export function showToast(text, { icon = '🔔' } = {}) {
  if (!text) return
  window.dispatchEvent(new CustomEvent('app:toast', { detail: { text, icon } }))
}
