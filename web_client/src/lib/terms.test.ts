import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'
import { agreeTermsErrorMessage, shouldShowTermsModal, TERMS_VERSION } from './terms'

const need = { terms_required: true }

describe('shouldShowTermsModal', () => {
  it('로그인 + terms_required=true 면 표시', () => {
    expect(shouldShowTermsModal('t', need, '/')).toBe(true)
    expect(shouldShowTermsModal('t', need, '/me')).toBe(true)
  })
  it('비로그인·동의 완료·필드 없는 옛 저장값은 표시하지 않음', () => {
    expect(shouldShowTermsModal(null, need, '/')).toBe(false)
    expect(shouldShowTermsModal('t', null, '/')).toBe(false)
    expect(shouldShowTermsModal('t', { terms_required: false }, '/')).toBe(false)
    expect(shouldShowTermsModal('t', {}, '/')).toBe(false)
  })
  it('약관·방침 화면에서는 읽을 수 있게 표시하지 않음(끝 슬래시 포함)', () => {
    expect(shouldShowTermsModal('t', need, '/terms')).toBe(false)
    expect(shouldShowTermsModal('t', need, '/privacy')).toBe(false)
    expect(shouldShowTermsModal('t', need, '/terms/')).toBe(false)
    expect(shouldShowTermsModal('t', need, '/support')).toBe(true)
  })
  it('버전은 서버 상수와 같은 값', () => {
    expect(TERMS_VERSION).toBe('2026-11-13')
  })
})

describe('agreeTermsErrorMessage', () => {
  const httpError = (status: number) =>
    new AxiosError('x', 'ERR', undefined, undefined, {
      status,
      statusText: '',
      data: {},
      headers: {},
      config: { headers: new AxiosHeaders() },
    })
  it('409 → 새로고침 안내, 네트워크 → 연결 안내', () => {
    expect(agreeTermsErrorMessage(httpError(409))).toContain('새로고침')
    expect(agreeTermsErrorMessage(new Error('net'))).toContain('서버에 연결할 수 없어요')
    expect(agreeTermsErrorMessage(httpError(500))).toContain('잠시 후 다시 시도')
  })
})
