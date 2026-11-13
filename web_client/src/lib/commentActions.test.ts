import { describe, expect, it } from 'vitest'
import {
  blockedName,
  buildReportBody,
  canSubmitReport,
  commentErrorMessage,
  commentMenu,
  commentView,
  detailCode,
  errorParts,
  HIDDEN_COMMENT_TEXT,
  REPORT_REASONS,
} from './commentActions'

const base = { hidden: false, is_mine: false, author_id: 7 }
const err = (code: string) => ({ detail: { code, message: 'x' } })

describe('commentMenu', () => {
  it('가려진 댓글은 메뉴 없음', () => {
    expect(commentMenu({ ...base, hidden: true }, true)).toEqual({ kind: 'none' })
    expect(commentMenu({ ...base, hidden: true, is_mine: true }, true)).toEqual({ kind: 'none' })
    expect(commentMenu({ ...base, hidden: true }, false)).toEqual({ kind: 'none' })
  })
  it('비로그인은 로그인 안내', () => {
    expect(commentMenu(base, false)).toEqual({ kind: 'login' })
  })
  it('내 댓글은 삭제만', () => {
    expect(commentMenu({ ...base, is_mine: true }, true)).toEqual({ kind: 'actions', actions: ['delete'] })
  })
  it('남의 댓글은 신고·차단, 작성자를 모르면 신고만', () => {
    expect(commentMenu(base, true)).toEqual({ kind: 'actions', actions: ['report', 'block'] })
    expect(commentMenu({ ...base, author_id: null }, true)).toEqual({ kind: 'actions', actions: ['report'] })
  })
  it('옛 응답(hidden·is_mine 없음)은 보통 남의 댓글로', () => {
    expect(commentMenu({ author_id: 3 }, true)).toEqual({ kind: 'actions', actions: ['report', 'block'] })
  })
})

describe('commentView', () => {
  it('가려진 댓글은 안내 문구만', () => {
    expect(commentView({ hidden: true, author_name: null, content: '' }, '익명')).toEqual({ hidden: true, text: HIDDEN_COMMENT_TEXT })
    expect(HIDDEN_COMMENT_TEXT).toBe('신고로 가려진 댓글이에요')
  })
  it('보통 댓글은 작성자(없으면 대체 이름)와 내용', () => {
    expect(commentView({ author_name: '철수', content: '안녕' }, '익명')).toEqual({ hidden: false, author: '철수', text: '안녕' })
    expect(commentView({ author_name: null, content: 'a' }, '익명')).toMatchObject({ author: '익명' })
  })
})

describe('신고 사유·본문', () => {
  it('사유 6개, 서버 값 순서', () => {
    expect(REPORT_REASONS.map((r) => r.value)).toEqual(['abuse', 'spam', 'sexual', 'privacy', 'scam', 'other'])
    expect(REPORT_REASONS.find((r) => r.value === 'other')?.label).toBe('기타(직접 입력)')
  })
  it('기타는 1~200자 입력이 있어야 신고 가능', () => {
    expect(canSubmitReport(null, '')).toBe(false)
    expect(canSubmitReport('abuse', '')).toBe(true)
    expect(canSubmitReport('other', '  ')).toBe(false)
    expect(canSubmitReport('other', 'a'.repeat(200))).toBe(true)
    expect(canSubmitReport('other', 'a'.repeat(201))).toBe(false)
  })
  it('detail 은 기타일 때만', () => {
    expect(buildReportBody('spam', '무시')).toEqual({ reason: 'spam' })
    expect(buildReportBody('other', ' 이유 ')).toEqual({ reason: 'other', detail: '이유' })
  })
})

describe('blockedName', () => {
  it('닉네임이 없으면 알 수 없는 사용자', () => {
    expect(blockedName('영희')).toBe('영희')
    expect(blockedName(null)).toBe('알 수 없는 사용자')
  })
})

describe('commentErrorMessage', () => {
  it('code 추출', () => {
    expect(detailCode(err('ALREADY_REPORTED'))).toBe('ALREADY_REPORTED')
    expect(detailCode({ detail: '문자열' })).toBeUndefined()
  })
  it('서버 코드별 문구', () => {
    expect(commentErrorMessage('submit', 403, err('COMMENT_BANNED'))).toBe('운영 정책 위반으로 댓글을 쓸 수 없어요')
    expect(commentErrorMessage('submit', 403, err('TERMS_REQUIRED'))).toBe('약관에 동의해야 댓글을 쓸 수 있어요')
    expect(commentErrorMessage('report', 409, err('ALREADY_REPORTED'))).toBe('이미 신고한 댓글이에요')
    expect(commentErrorMessage('report', 400, err('CANNOT_REPORT_OWN'))).toBe('내 댓글은 신고할 수 없어요')
    expect(commentErrorMessage('report', 404, err('COMMENT_NOT_FOUND'))).toBe('이미 삭제된 댓글이에요')
    expect(commentErrorMessage('block', 400, err('CANNOT_BLOCK_SELF'))).toBe('나 자신은 차단할 수 없어요')
    expect(commentErrorMessage('block', 400, err('CANNOT_BLOCK_ADMIN'))).toBe('운영자는 차단할 수 없어요')
    expect(commentErrorMessage('block', 404, err('USER_NOT_FOUND'))).toBe('이미 탈퇴한 사용자예요')
  })
  it('기존 작성 문구 유지 — 코드 없는 403·401·네트워크', () => {
    expect(commentErrorMessage('submit', 403, { detail: 'Comments disabled' })).toBe('이 게시판은 댓글을 받지 않아요.')
    expect(commentErrorMessage('submit', 401, undefined)).toBe('로그인이 만료됐어요. 다시 로그인해 주세요.')
    expect(commentErrorMessage('submit', undefined, undefined)).toBe('댓글을 등록하지 못했어요. 잠시 후 다시 시도해 주세요.')
  })
  it('422·기본·연결 실패', () => {
    expect(commentErrorMessage('report', 422, { detail: [] })).toBe('신고 사유를 확인해 주세요.')
    expect(commentErrorMessage('unblock', 500, null)).toBe('차단을 해제하지 못했어요. 잠시 후 다시 시도해 주세요.')
    expect(commentErrorMessage('block', undefined, undefined)).toContain('서버에 연결할 수 없어요')
  })
  it('axios 가 아닌 오류는 상태 없음', () => {
    expect(errorParts(new Error('x'))).toEqual({ status: undefined, body: undefined })
  })
})
