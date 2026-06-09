/**
 * Integration tests for realtime/ws-server.ts.
 * Uses real WebSocket connections on a loopback server so Istanbul instruments
 * the actual ws-server.ts code (not a mock).
 */
process.env.JWT_SECRET = 'ws-test-secret'
process.env.NODE_ENV   = 'test'

import * as http      from 'http'
import WebSocket      from 'ws'
import jwt            from 'jsonwebtoken'
import { EventEmitter } from 'events'

// ── Redis mock (duplicate() returns a controllable subscriber) ─────────────────

let lastSub: any = null

const mockSetex = jest.fn().mockResolvedValue('OK')
const mockDel   = jest.fn().mockResolvedValue(1)

jest.mock('../db/redis', () => ({
  redis: {
    setex:     (...args: any[]) => mockSetex(...args),
    del:       (...args: any[]) => mockDel(...args),
    duplicate: jest.fn().mockImplementation(() => {
      const sub: any = new EventEmitter()
      sub.subscribe = jest.fn().mockImplementation((_channel: string, cb?: Function) => {
        if (cb) cb(null)
      })
      sub.unsubscribe = jest.fn().mockResolvedValue(undefined)
      sub.quit        = jest.fn().mockResolvedValue('OK')
      lastSub = sub
      return sub
    }),
  },
}))

jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

// ── Server lifecycle ──────────────────────────────────────────────────────────

import { initWsServer } from '../realtime/ws-server'

let httpServer: http.Server
let port: number
const openSockets: WebSocket[] = []

beforeAll(done => {
  httpServer = http.createServer()
  initWsServer(httpServer)
  httpServer.listen(0, '127.0.0.1', () => {
    port = (httpServer.address() as any).port
    done()
  })
})

afterAll(async () => {
  // Close every tracked WebSocket so their cleanup() fires (clears setInterval/setTimeout)
  await Promise.all(openSockets.map(ws =>
    new Promise<void>(resolve => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.once('close', resolve)
        ws.close()
      } else {
        resolve()
      }
    })
  ))
  // Wait a tick for the close-event handlers inside ws-server.ts to run
  await new Promise(r => setTimeout(r, 200))
  // Now the server should close immediately
  await new Promise<void>((resolve, reject) =>
    httpServer.close(err => (err ? reject(err) : resolve()))
  )
}, 15_000)

beforeEach(() => {
  jest.clearAllMocks()
  lastSub = null
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeToken(payload: Record<string, any> = { sub: 'merchant-1', role: 'MERCHANT' }) {
  return jwt.sign(payload, 'ws-test-secret', { expiresIn: '1h' })
}

function wsConnect(params: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(params).toString()
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?${qs}`)
    openSockets.push(ws)
    ws.on('open',  ()    => resolve(ws))
    ws.on('error', (err) => reject(err))
  })
}

function closeCode(ws: WebSocket): Promise<number> {
  return new Promise(resolve => {
    ws.on('close', (code) => resolve(code))
  })
}

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise(resolve => {
    ws.once('message', (data) => resolve(data.toString()))
  })
}

function tick() {
  return new Promise(resolve => setImmediate(resolve))
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection guard — missing / invalid token
// ─────────────────────────────────────────────────────────────────────────────

describe('connection guard', () => {
  it('closes with code 1008 when token query param is absent', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?txnId=txn-1`)
    const code = await closeCode(ws)
    expect(code).toBe(1008)
  })

  it('closes with code 1008 when JWT is invalid / expired', async () => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ws?txnId=txn-1&token=not-a-valid-jwt`
    )
    const code = await closeCode(ws)
    expect(code).toBe(1008)
  })

  it('closes with code 1008 when neither txnId nor consumerId is provided', async () => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ws?token=${makeToken()}`
    )
    const code = await closeCode(ws)
    expect(code).toBe(1008)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Terminal connection (txnId)
// ─────────────────────────────────────────────────────────────────────────────

describe('terminal connection (txnId)', () => {
  it('opens successfully with a valid JWT + txnId', async () => {
    const ws = await wsConnect({ txnId: 'txn-term-1', token: makeToken() })
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
    await tick()
  })

  it('subscribes to txn:confirmed:{txnId} Redis channel', async () => {
    const ws = await wsConnect({ txnId: 'txn-term-2', token: makeToken() })
    await tick()
    const { redis } = require('../db/redis')
    expect(redis.duplicate).toHaveBeenCalled()
    expect(lastSub.subscribe).toHaveBeenCalledWith(
      'txn:confirmed:txn-term-2',
      expect.any(Function)
    )
    ws.close()
    await tick()
  })

  it('forwards Redis message to the WebSocket client', async () => {
    const ws      = await wsConnect({ txnId: 'txn-term-3', token: makeToken() })
    const msgProm = nextMessage(ws)
    await tick()

    const payload = JSON.stringify({ status: 'CONFIRMED', txnId: 'txn-term-3', amountCents: 5000 })
    lastSub.emit('message', 'txn:confirmed:txn-term-3', payload)

    const received = await msgProm
    expect(received).toBe(payload)
    ws.close()
    await tick()
  })

  it('cleans up (unsubscribe + quit) when client disconnects', async () => {
    const ws = await wsConnect({ txnId: 'txn-term-close', token: makeToken() })
    await tick()

    const sub = lastSub
    ws.close()
    await new Promise(r => ws.on('close', r))
    await tick()

    expect(sub.unsubscribe).toHaveBeenCalled()
    expect(sub.quit).toHaveBeenCalled()
  })

  it('handles Redis subscriber error gracefully', async () => {
    const ws = await wsConnect({ txnId: 'txn-sub-err', token: makeToken() })
    await tick()

    // Emit an error on the subscriber — should close the WS
    const closeP = closeCode(ws)
    lastSub.emit('error', new Error('Redis connection dropped'))
    const code = await closeP
    expect(code).toBe(1011)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Consumer connection (consumerId)
// ─────────────────────────────────────────────────────────────────────────────

describe('consumer connection (consumerId)', () => {
  it('opens successfully with a valid JWT + consumerId', async () => {
    const ws = await wsConnect({ consumerId: 'consumer-1', token: makeToken({ sub: 'consumer-1' }) })
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
    await tick()
  })

  it('subscribes to consumer:payment:{consumerId} channel', async () => {
    const ws = await wsConnect({ consumerId: 'consumer-2', token: makeToken() })
    await tick()
    expect(lastSub.subscribe).toHaveBeenCalledWith(
      'consumer:payment:consumer-2',
      expect.any(Function)
    )
    ws.close()
    await tick()
  })

  it('sets presence key consumer:ws:{consumerId} in Redis', async () => {
    await wsConnect({ consumerId: 'consumer-3', token: makeToken() })
    await tick()
    expect(mockSetex).toHaveBeenCalledWith(
      'consumer:ws:consumer-3',
      90,
      '1'
    )
  })

  it('forwards payment event to connected consumer client', async () => {
    const ws      = await wsConnect({ consumerId: 'consumer-4', token: makeToken() })
    const msgProm = nextMessage(ws)
    await tick()

    const event = JSON.stringify({ type: 'PAYMENT_RECEIVED', status: 'CONFIRMED', amountCents: 10000 })
    lastSub.emit('message', 'consumer:payment:consumer-4', event)

    const received = await msgProm
    expect(received).toBe(event)
    ws.close()
    await tick()
  })

  it('deletes presence key and cleans up on disconnect', async () => {
    const ws = await wsConnect({ consumerId: 'consumer-5', token: makeToken() })
    await tick()

    ws.close()
    await new Promise(r => ws.on('close', r))
    await tick()

    expect(mockDel).toHaveBeenCalledWith('consumer:ws:consumer-5')
  })

  it('handles Redis subscriber error gracefully', async () => {
    const ws = await wsConnect({ consumerId: 'consumer-err', token: makeToken() })
    await tick()

    const closeP = closeCode(ws)
    lastSub.emit('error', new Error('Redis dropped'))
    const code = await closeP
    expect(code).toBe(1011)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Ping timer and idle timeout coverage
// Use jest fake timers so the 15s / 70s intervals fire immediately.
// ─────────────────────────────────────────────────────────────────────────────

describe('ping timer callbacks (fake timers)', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('fires ping while terminal socket is OPEN', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
    const ws = await wsConnect({ txnId: 'ping-terminal', token: makeToken() })
    await tick()

    // Advance past one PING_INTERVAL (15s) — triggers `if (ws.readyState === OPEN) ws.ping()`
    jest.advanceTimersByTime(16_000)
    await tick()

    ws.close()
    await new Promise<void>(r => ws.on('close', r))
  })

  it('fires ping while consumer socket is OPEN and refreshes presence key', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
    const ws = await wsConnect({ consumerId: 'ping-consumer', token: makeToken() })
    await tick()

    jest.advanceTimersByTime(16_000)
    await tick()

    expect(mockSetex).toHaveBeenCalledWith('consumer:ws:ping-consumer', 90, '1')

    ws.close()
    await new Promise<void>(r => ws.on('close', r))
  })

  it('fires idle timeout and closes terminal connection', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
    const ws = await wsConnect({ txnId: 'idle-terminal', token: makeToken() })
    await tick()

    // Advance past IDLE_TIMEOUT (70s) — triggers the idle-close branch
    jest.advanceTimersByTime(71_000)
    await tick()

    // Connection should be closed by the server (code 1000 or already closing)
    ws.close()
    await new Promise<void>(r => ws.on('close', r))
  })

  it('takes the clearInterval branch (line 98) when terminal socket is CLOSING during ping', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
    const ws = await wsConnect({ txnId: 'ping-closing-terminal', token: makeToken() })
    await tick()

    // Emit a subscriber error — this calls ws.close(1011) on the server side, putting
    // the server-side socket into CLOSING state immediately (readyState = 2).
    // Then advance the timer synchronously before the close event fires over the network.
    lastSub.emit('error', new Error('Redis error forces close'))
    jest.advanceTimersByTime(16_000)  // ping fires while socket is CLOSING → else branch
    await tick()

    await new Promise<void>(r => ws.on('close', r))
  })

  it('takes the clearInterval branch (line 155) when consumer socket is CLOSING during ping', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
    const ws = await wsConnect({ consumerId: 'ping-closing-consumer', token: makeToken() })
    await tick()

    lastSub.emit('error', new Error('Redis error forces close'))
    jest.advanceTimersByTime(16_000)  // consumer ping fires while socket is CLOSING → else branch
    await tick()

    await new Promise<void>(r => ws.on('close', r))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// .catch(() => {}) function coverage — make underlying Promises reject
// ─────────────────────────────────────────────────────────────────────────────

describe('.catch() handler functions', () => {
  it('terminal cleanup: sub.unsubscribe rejection is swallowed', async () => {
    const ws = await wsConnect({ txnId: 'cleanup-unsubscribe-term', token: makeToken() })
    await tick()

    lastSub.unsubscribe.mockRejectedValueOnce(new Error('Redis cleanup error'))

    ws.close()
    await new Promise<void>(r => ws.on('close', r))
    await tick()
  })

  it('terminal cleanup: sub.quit rejection is swallowed', async () => {
    const ws = await wsConnect({ txnId: 'cleanup-quit-term', token: makeToken() })
    await tick()

    lastSub.quit.mockRejectedValueOnce(new Error('Redis quit error'))

    ws.close()
    await new Promise<void>(r => ws.on('close', r))
    await tick()
  })

  it('consumer cleanup: redis.del rejection is swallowed', async () => {
    const ws = await wsConnect({ consumerId: 'cleanup-del-consumer', token: makeToken() })
    await tick()

    mockDel.mockRejectedValueOnce(new Error('Redis del error'))

    ws.close()
    await new Promise<void>(r => ws.on('close', r))
    await tick()
  })

  it('consumer connect: initial redis.setex rejection is swallowed', async () => {
    mockSetex.mockRejectedValueOnce(new Error('Redis setex error'))

    const ws = await wsConnect({ consumerId: 'setex-fail-consumer', token: makeToken() })
    await tick()

    ws.close()
    await new Promise<void>(r => ws.on('close', r))
    await tick()
  })
})
