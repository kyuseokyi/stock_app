import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

// 진행 중인 API 요청 수 — 화면 맨 위 진행 표시줄(<ApiProgressBar/>)이 구독한다.
// axios 인스턴스 4개(blog·auth·game·기본 axios)에 installApiActivity 를 붙여 모든 API 호출을 센다.
// (알림 SSE·게임 WebSocket 은 axios 가 아니라 세지 않는다 — 계속 열려 있는 연결이라 표시하면 안 됨)

type Listener = (busy: boolean) => void

let pending = 0
const listeners = new Set<Listener>()

function emit(busy: boolean): void {
  listeners.forEach((l) => l(busy))
}

/** 요청 시작을 알리고, 끝낼 때 부를 함수를 돌려준다(여러 번 불러도 한 번만 반영). */
export function beginRequest(): () => void {
  pending += 1
  if (pending === 1) emit(true)
  let done = false
  return () => {
    if (done) return
    done = true
    pending -= 1
    if (pending === 0) emit(false)
  }
}

export function isApiBusy(): boolean {
  return pending > 0
}

export function subscribeApiBusy(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

type ActivityConfig = InternalAxiosRequestConfig & { __apiActivityEnd?: () => void }

function finish(config: ActivityConfig | undefined): void {
  const end = config?.__apiActivityEnd
  if (!end) return
  delete config.__apiActivityEnd
  end()
}

/**
 * axios 인스턴스에 요청 수 세기를 붙인다. installRetry 뒤에 호출한다 — 재시도는 같은 config 로 다시 보내므로
 * 이미 세고 있는 config 는 다시 세지 않고, 재시도 대기 중에도 표시가 이어진다.
 */
export function installApiActivity(instance: AxiosInstance): void {
  const marked = instance as AxiosInstance & { __apiActivityInstalled?: boolean }
  if (marked.__apiActivityInstalled) return
  marked.__apiActivityInstalled = true
  instance.interceptors.request.use((config: ActivityConfig) => {
    if (!config.__apiActivityEnd) config.__apiActivityEnd = beginRequest()
    return config
  })
  instance.interceptors.response.use(
    (res) => {
      finish(res.config as ActivityConfig)
      return res
    },
    (err: unknown) => {
      finish((err as { config?: ActivityConfig } | null)?.config)
      return Promise.reject(err)
    },
  )
}
