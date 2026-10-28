import { describe, test, expect } from 'vitest'
import { parseQuizMarkdown } from './quizMarkdown'

describe('parseQuizMarkdown', () => {
  test('생성기 템플릿 — 제목·목록·인용', () => {
    const md = '### 골든크로스\n- 5일선 100 / 20일선 98: 상향 돌파\n- RSI(14) 55.0: 중립 구간입니다.\n\n> 패턴은 확률일 뿐입니다.'
    expect(parseQuizMarkdown(md)).toEqual([
      { kind: 'heading', text: '골든크로스' },
      { kind: 'item', text: '5일선 100 / 20일선 98: 상향 돌파' },
      { kind: 'item', text: 'RSI(14) 55.0: 중립 구간입니다.' },
      { kind: 'quote', text: '패턴은 확률일 뿐입니다.' },
    ])
  })

  test('관리자가 고친 일반 문장·빈 문자열', () => {
    expect(parseQuizMarkdown('그냥 문장\n* 별표 항목')).toEqual([
      { kind: 'para', text: '그냥 문장' },
      { kind: 'item', text: '별표 항목' },
    ])
    expect(parseQuizMarkdown('')).toEqual([])
  })

  test('# 뒤 공백 없는 줄은 문단(해시태그 오인 방지)', () => {
    expect(parseQuizMarkdown('#해시')).toEqual([{ kind: 'para', text: '#해시' }])
  })
})
