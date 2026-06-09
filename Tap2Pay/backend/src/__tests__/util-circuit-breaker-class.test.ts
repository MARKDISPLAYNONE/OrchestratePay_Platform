/**
 * Unit tests for util/circuit-breaker.ts — the actual CircuitBreaker class.
 * (Separate from circuit-breaker.test.ts which tests a pure-model simulation.)
 */
process.env.NODE_ENV = 'test'

jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { CircuitBreaker, CircuitOpenError } from '../util/circuit-breaker'

describe('CircuitBreaker', () => {
  it('starts in CLOSED state', () => {
    const cb = new CircuitBreaker('test-service')
    expect(cb.status).toBe('CLOSED')
    expect(cb.failureCount).toBe(0)
  })

  it('executes the wrapped function and returns its result', async () => {
    const cb = new CircuitBreaker('test-service')
    const result = await cb.fire(async () => 42)
    expect(result).toBe(42)
    expect(cb.failureCount).toBe(0)
    expect(cb.status).toBe('CLOSED')
  })

  it('re-throws the error from the wrapped function', async () => {
    const cb = new CircuitBreaker('test-service', 10)
    await expect(cb.fire(async () => { throw new Error('network error') }))
      .rejects.toThrow('network error')
    expect(cb.failureCount).toBe(1)
  })

  it('opens after reaching the failure threshold', async () => {
    const cb = new CircuitBreaker('test-service', 3)
    const failFn = () => Promise.reject(new Error('fail'))
    for (let i = 0; i < 3; i++) {
      await cb.fire(failFn).catch(() => {})
    }
    expect(cb.status).toBe('OPEN')
  })

  it('throws CircuitOpenError immediately when OPEN', async () => {
    const cb = new CircuitBreaker('test-service', 1, 60_000)
    await cb.fire(async () => { throw new Error('fail') }).catch(() => {})
    expect(cb.status).toBe('OPEN')

    await expect(cb.fire(async () => 'should not run'))
      .rejects.toThrow(CircuitOpenError)
  })

  it('CircuitOpenError has code CIRCUIT_OPEN', async () => {
    const cb = new CircuitBreaker('daraja', 1, 60_000)
    await cb.fire(async () => { throw new Error('fail') }).catch(() => {})
    try {
      await cb.fire(async () => 'ok')
    } catch (err: any) {
      expect(err).toBeInstanceOf(CircuitOpenError)
      expect(err.code).toBe('CIRCUIT_OPEN')
      expect(err.name).toBe('CircuitOpenError')
      expect(err.message).toContain('daraja')
    }
  })

  it('transitions to HALF_OPEN after resetMs and allows one probe', async () => {
    const cb = new CircuitBreaker('test-service', 1, 0)  // immediate reset
    await cb.fire(async () => { throw new Error('fail') }).catch(() => {})
    expect(cb.status).toBe('OPEN')

    // After resetMs = 0, the next fire should transition to HALF_OPEN and run
    const result = await cb.fire(async () => 'probe-ok')
    expect(result).toBe('probe-ok')
    expect(cb.status).toBe('CLOSED')
    expect(cb.failureCount).toBe(0)
  })

  it('reopens immediately if the HALF_OPEN probe fails', async () => {
    const cb = new CircuitBreaker('test-service', 1, 0)
    await cb.fire(async () => { throw new Error('fail') }).catch(() => {})
    expect(cb.status).toBe('OPEN')

    // Probe fails → back to OPEN
    await cb.fire(async () => { throw new Error('still down') }).catch(() => {})
    expect(cb.status).toBe('OPEN')
  })

  it('success resets failure count in CLOSED state', async () => {
    const cb = new CircuitBreaker('test-service', 5)
    for (let i = 0; i < 3; i++) {
      await cb.fire(async () => { throw new Error('fail') }).catch(() => {})
    }
    expect(cb.failureCount).toBe(3)

    await cb.fire(async () => 'success')
    expect(cb.failureCount).toBe(0)
    expect(cb.status).toBe('CLOSED')
  })

  it('does not open before threshold is reached', async () => {
    const cb = new CircuitBreaker('test-service', 5)
    for (let i = 0; i < 4; i++) {
      await cb.fire(async () => { throw new Error('fail') }).catch(() => {})
    }
    expect(cb.status).toBe('CLOSED')
    expect(cb.failureCount).toBe(4)
  })
})
