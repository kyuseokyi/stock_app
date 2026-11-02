import { describe, expect, it } from 'vitest'
import { deriveStockApiUrl } from './stockApiUrl'

describe('deriveStockApiUrl', () => {
  it('끝의 /graphql 을 뗀다', () => {
    expect(deriveStockApiUrl('http://localhost:8002/graphql')).toBe('http://localhost:8002')
    expect(deriveStockApiUrl('https://api.example.com/graphql/')).toBe('https://api.example.com')
    expect(deriveStockApiUrl('https://api.example.com/GraphQL')).toBe('https://api.example.com')
  })
  it('같은 도메인 프록시 상대 주소도 그대로 쓴다', () => {
    expect(deriveStockApiUrl('/_api/stock/graphql')).toBe('/_api/stock')
  })
  it('공백·끝 슬래시를 정리하고, graphql 이 없으면 그대로', () => {
    expect(deriveStockApiUrl('  https://api.example.com/  ')).toBe('https://api.example.com')
    expect(deriveStockApiUrl('https://graphql.example.com/api')).toBe('https://graphql.example.com/api')
  })
})
