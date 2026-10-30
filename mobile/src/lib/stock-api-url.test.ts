import { deriveStockApiUrl } from './stock-api-url';

describe('deriveStockApiUrl', () => {
  it('끝의 /graphql 을 뗀다', () => {
    expect(deriveStockApiUrl('http://localhost:8002/graphql')).toBe('http://localhost:8002');
  });
  it('끝 슬래시가 있어도 뗀다', () => {
    expect(deriveStockApiUrl('https://stock.example.com/graphql/')).toBe('https://stock.example.com');
  });
  it('경로 앞부분(프록시 접두사)은 남긴다', () => {
    expect(deriveStockApiUrl('https://example.com/stock/graphql')).toBe('https://example.com/stock');
  });
  it('/graphql 이 없으면 끝 슬래시만 뗀다', () => {
    expect(deriveStockApiUrl('https://example.com/')).toBe('https://example.com');
  });
  it('중간의 graphql 글자는 건드리지 않는다', () => {
    expect(deriveStockApiUrl('https://graphql.example.com/graphql')).toBe('https://graphql.example.com');
  });
});
