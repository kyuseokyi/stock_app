// 배포 뒤 옛 화면 조각(lazy chunk) 로드 실패 → 한 번만 새로고침해 새 index.html·새 조각을 받는다.
//
// 왜: 화면을 lazy import 로 나눠 두었는데, 인앱 브라우저(카카오톡 등)가 배포 전 index.html 을 들고 있으면
// 이미 사라진 옛 해시 조각을 요청한다 → 404 → "데이터를 못 받아 오는" 화면. Vite 는 이때 window 에
// 'vite:preloadError' 를 보낸다. 새로고침이 무한 반복되지 않게 짧은 시간 안에는 한 번만 한다.
const KEY = 'chunk-reload-at'
const WINDOW_MS = 30_000

export function installChunkReload(win: Window = window): void {
  win.addEventListener('vite:preloadError', (event) => {
    let last = 0
    try {
      last = Number(win.sessionStorage.getItem(KEY) || 0)
    } catch {
      // 저장소를 못 쓰는 환경 — 반복 방지를 못 하므로 새로고침하지 않고 오류를 그대로 둔다
      return
    }
    if (Date.now() - last < WINDOW_MS) return // 방금 새로고침했는데도 실패 → 오류 화면으로
    try {
      win.sessionStorage.setItem(KEY, String(Date.now()))
    } catch {
      return
    }
    event.preventDefault() // 오류를 던지지 않고 새로고침으로 대신한다
    win.location.reload()
  })
}
