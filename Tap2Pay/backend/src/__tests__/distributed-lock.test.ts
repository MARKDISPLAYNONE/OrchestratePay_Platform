// Tests for Redis-based distributed lock
import { withDistributedLock } from '../util/distributed-lock'

const mockRedisSet = jest.fn()
const mockRedisGet = jest.fn()
const mockRedisDel = jest.fn()

jest.mock('../db/redis', () => ({
  redis: {
    set: (...args: any[]) => mockRedisSet(...args),
    get: (...args: any[]) => mockRedisGet(...args),
    del: (...args: any[]) => mockRedisDel(...args),
  },
}))

describe('withDistributedLock', () => {
  beforeEach(() => jest.clearAllMocks())

  it('runs fn and returns true when lock is acquired', async () => {
    mockRedisSet.mockResolvedValue('OK')   // SET NX succeeds
    mockRedisGet.mockResolvedValue('token-match')  // simulate ownership
    mockRedisDel.mockResolvedValue(1)

    const fn = jest.fn().mockResolvedValue(undefined)
    const result = await withDistributedLock('test-lock', 30, fn)

    expect(result).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('skips fn and returns false when lock is already held', async () => {
    mockRedisSet.mockResolvedValue(null)  // SET NX fails — key exists

    const fn = jest.fn()
    const result = await withDistributedLock('test-lock', 30, fn)

    expect(result).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('releases lock after fn completes', async () => {
    let capturedToken: string | undefined
    mockRedisSet.mockImplementation((...args: any[]) => {
      capturedToken = args[1]  // capture the token written
      return Promise.resolve('OK')
    })
    mockRedisGet.mockImplementation(() => Promise.resolve(capturedToken))
    mockRedisDel.mockResolvedValue(1)

    const fn = jest.fn().mockResolvedValue(undefined)
    await withDistributedLock('release-test', 30, fn)

    expect(mockRedisDel).toHaveBeenCalledWith('lock:release-test')
  })

  it('releases lock even if fn throws', async () => {
    let capturedToken: string | undefined
    mockRedisSet.mockImplementation((...args: any[]) => {
      capturedToken = args[1]
      return Promise.resolve('OK')
    })
    mockRedisGet.mockImplementation(() => Promise.resolve(capturedToken))
    mockRedisDel.mockResolvedValue(1)

    const fn = jest.fn().mockRejectedValue(new Error('fn failure'))

    await expect(withDistributedLock('error-lock', 30, fn)).rejects.toThrow('fn failure')
    expect(mockRedisDel).toHaveBeenCalledWith('lock:error-lock')
  })

  it('runs fn without lock when Redis is unavailable (fail open)', async () => {
    mockRedisSet.mockRejectedValue(new Error('Redis connection refused'))

    const fn = jest.fn().mockResolvedValue(undefined)
    const result = await withDistributedLock('failopen-lock', 30, fn)

    expect(result).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)  // ran despite Redis being down
  })
})
