// 신고 관리·회원 화면용 순수 함수(표시 문구 변환·입력 검증)

export const REPORT_REASON_LABELS: Record<string, string> = {
  abuse: '욕설·비하',
  spam: '스팸·광고',
  sexual: '음란·불쾌',
  privacy: '개인정보 노출',
  scam: '투자 사기·리딩방',
  other: '기타',
}

/** 사유 코드 → 화면 라벨(모르는 코드는 원문 그대로) */
export const reportReasonLabel = (code: string): string => REPORT_REASON_LABELS[code] ?? code

const REASON_ORDER = Object.keys(REPORT_REASON_LABELS)

/** 사유별 수 → [라벨, 수] 목록. 수 내림차순, 같으면 정해진 사유 순서. 0건은 뺀다 */
export const reasonCountEntries = (counts: Record<string, number>): Array<[string, number]> =>
  Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort(([a, na], [b, nb]) => {
      if (nb !== na) return nb - na
      const ia = REASON_ORDER.indexOf(a)
      const ib = REASON_ORDER.indexOf(b)
      return (ia < 0 ? REASON_ORDER.length : ia) - (ib < 0 ? REASON_ORDER.length : ib)
    })
    .map(([code, n]) => [reportReasonLabel(code), n])

export const NICKNAME_MIN = 1
export const NICKNAME_MAX = 20

/** 닉네임 검증 — 앞뒤 공백 제거 후 1~20자. 통과면 null, 아니면 안내 문구 */
export const validateNickname = (raw: string): string | null => {
  const name = raw.trim()
  if (name.length < NICKNAME_MIN) return '닉네임을 입력하세요.'
  if (name.length > NICKNAME_MAX) return `닉네임은 ${NICKNAME_MAX}자 이하로 입력하세요.`
  return null
}

// 서버 AuthProvider(KAKAO·GOOGLE·APPLE·NAVER). null 은 소셜이 아닌 계정(이메일·게스트 등)
const PROVIDER_LABELS: Record<string, string> = {
  naver: '네이버',
  kakao: '카카오',
  google: '구글',
  apple: '애플',
}

/** 가입 방식 코드 → 화면 라벨(없으면 '-', 모르는 코드는 원문) */
export const providerLabel = (provider: string | null | undefined): string =>
  provider ? (PROVIDER_LABELS[provider.toLowerCase()] ?? provider) : '-'

/** ISO 시각 → 'YYYY-MM-DD HH:mm'(브라우저 현지 시각). 잘못된 값은 원문 */
export const formatDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
