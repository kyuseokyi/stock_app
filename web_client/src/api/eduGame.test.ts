import { AxiosError, AxiosHeaders } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const get = vi.fn()
vi.mock('./gameClient', () => ({ gameClient: { get: (...args: unknown[]) => get(...args) } }))

import { getEduFeatures } from './eduGame'

const axiosErr = (status: number) =>
  new AxiosError('fail', 'ERR', { headers: new AxiosHeaders() }, null, {
    status, statusText: '', data: {}, headers: {}, config: { headers: new AxiosHeaders() },
  })

describe('getEduFeatures (탭 노출 판단 — features, 옛 서버는 state 폴백)', () => {
  beforeEach(() => get.mockReset())

  it('features 응답의 두 값을 그대로 쓰고 state 는 부르지 않는다', async () => {
    get.mockResolvedValueOnce({ data: { enabled: true, real_market_switch: false } })
    await expect(getEduFeatures()).resolves.toEqual({ enabled: true, real_market_switch: false })
    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith('/api/game/edu/features')
  })

  it('404(features 없는 옛 서버)면 state 로 한 번 폴백한다', async () => {
    get.mockRejectedValueOnce(axiosErr(404))
    get.mockResolvedValueOnce({ data: { enabled: true, real_market_switch: true, season: null, candles: [] } })
    await expect(getEduFeatures()).resolves.toEqual({ enabled: true, real_market_switch: true })
    expect(get.mock.calls.map((c) => c[0])).toEqual(['/api/game/edu/features', '/api/game/edu/state'])
  })

  it('404 가 아닌 오류는 폴백하지 않고 그대로 던진다(호출부가 닫힘 처리)', async () => {
    get.mockRejectedValueOnce(axiosErr(500))
    await expect(getEduFeatures()).rejects.toBeInstanceOf(AxiosError)
    expect(get).toHaveBeenCalledTimes(1)
  })
})
