import { describe, expect, it } from 'vitest'
import { smColsFor } from './tileGrid'

describe('smColsFor', () => {
  it('카드 개수만큼 열(최대 4)', () => {
    expect(smColsFor(2)).toBe('sm:grid-cols-2')
    expect(smColsFor(3)).toBe('sm:grid-cols-3')
    expect(smColsFor(4)).toBe('sm:grid-cols-4')
    expect(smColsFor(7)).toBe('sm:grid-cols-4')
  })
  it('0·1개는 한 열', () => {
    expect(smColsFor(0)).toBe('sm:grid-cols-1')
    expect(smColsFor(1)).toBe('sm:grid-cols-1')
  })
})
