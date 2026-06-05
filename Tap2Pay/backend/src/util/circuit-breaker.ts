import { logger } from './logger'

type State = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

export class CircuitOpenError extends Error {
  readonly code = 'CIRCUIT_OPEN'
  constructor(name: string) {
    super(`Service '${name}' is unavailable — circuit breaker is OPEN`)
    this.name = 'CircuitOpenError'
  }
}

/**
 * Three-state circuit breaker for external service calls (Daraja, etc.).
 *
 * CLOSED  → normal operation, all requests pass through
 * OPEN    → service deemed down, requests fail immediately (fast-fail)
 * HALF-OPEN → after resetMs, allow one probe request through
 *              success → CLOSED; failure → back to OPEN
 *
 * Trips OPEN after `threshold` consecutive failures within any window.
 * Resets to HALF-OPEN after `resetMs` milliseconds.
 */
export class CircuitBreaker {
  private state: State = 'CLOSED'
  private failures = 0
  private lastFailedAt = 0

  constructor(
    private readonly name: string,
    private readonly threshold = 5,
    private readonly resetMs = 30_000
  ) {}

  async fire<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailedAt < this.resetMs) {
        throw new CircuitOpenError(this.name)
      }
      this.state = 'HALF_OPEN'
      logger.warn('Circuit breaker probing service', { name: this.name })
    }

    try {
      const result = await fn()
      this.recordSuccess()
      return result
    } catch (err) {
      this.recordFailure(err)
      throw err
    }
  }

  private recordSuccess() {
    if (this.state !== 'CLOSED') {
      logger.info('Circuit breaker closed — service recovered', { name: this.name })
    }
    this.state = 'CLOSED'
    this.failures = 0
  }

  private recordFailure(err: unknown) {
    this.failures++
    this.lastFailedAt = Date.now()

    const shouldOpen = this.failures >= this.threshold || this.state === 'HALF_OPEN'
    if (shouldOpen) {
      this.state = 'OPEN'
      logger.error('Circuit breaker OPEN — fast-failing subsequent requests', {
        name: this.name,
        failures: this.failures,
        resetInMs: this.resetMs,
        error: (err as Error)?.message
      })
    }
  }

  get status(): State { return this.state }
  get failureCount(): number { return this.failures }
}
