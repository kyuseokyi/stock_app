import { describe, test, expect } from 'vitest'
import { AxiosError, type AxiosResponse } from 'axios'
import { deleteAccountErrorMessage } from './deleteAccount'

// 앱은 (status, body) 를 받고 웹은 axios 오류 객체를 받는다 — 같은 경우를 axios 오류로 만들어 확인
const httpError = (status: number, data: unknown) =>
  new AxiosError('fail', 'ERR_BAD_RESPONSE', undefined, undefined, { status, data } as AxiosResponse)

describe('deleteAccountErrorMessage', () => {
  test('CONFIRM_REQUIRED', () => {
    expect(deleteAccountErrorMessage(httpError(400, { detail: { code: 'CONFIRM_REQUIRED', message: 'x' } }))).toBe(
      '탈퇴 확인에 실패했어요. 다시 시도해 주세요.',
    )
  })
  test('ADMIN_CANNOT_DELETE', () => {
    expect(deleteAccountErrorMessage(httpError(403, { detail: { code: 'ADMIN_CANNOT_DELETE', message: 'x' } }))).toBe(
      '관리자 계정은 탈퇴할 수 없어요.',
    )
  })
  test('401 은 로그인 만료', () => {
    expect(deleteAccountErrorMessage(httpError(401, { detail: 'Not authenticated' }))).toBe(
      '로그인이 만료되었어요. 다시 로그인해 주세요.',
    )
  })
  test('네트워크 오류(응답 없음)·axios 오류가 아닌 값', () => {
    const msg = '서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.'
    expect(deleteAccountErrorMessage(new AxiosError('Network Error', 'ERR_NETWORK'))).toBe(msg)
    expect(deleteAccountErrorMessage(undefined)).toBe(msg)
    expect(deleteAccountErrorMessage(new Error('x'))).toBe(msg)
  })
  test('모르는 코드·문자열 detail·빈 본문은 기본 문구', () => {
    const fallback = '탈퇴에 실패했어요. 잠시 후 다시 시도해 주세요.'
    expect(deleteAccountErrorMessage(httpError(500, { detail: { code: 'WHAT' } }))).toBe(fallback)
    expect(deleteAccountErrorMessage(httpError(400, { detail: 'oops' }))).toBe(fallback)
    expect(deleteAccountErrorMessage(httpError(500, 'Internal Server Error'))).toBe(fallback)
    expect(deleteAccountErrorMessage(httpError(500, null))).toBe(fallback)
  })
})
