/**
 * realtime/ws-server.ts — WebSocket server for real-time payment status push.
 *
 * WHY THIS EXISTS:
 * The Android app's polling loop (15 × 2.5s = 37.5s) wastes battery and mobile
 * data. Callbacks typically arrive in 3–10 seconds, but the app can only detect
 * them on the next 2.5s poll. This server bridges Redis pub/sub → WebSocket so
 * the terminal gets the result within ~100ms of the callback landing.
 *
 * ARCHITECTURE:
 *   Safaricom callback → mpesa-callback.ts → redis.publish("txn:confirmed:{id}")
 *                                                         ↓
 *   Android terminal ← WebSocket ← ws-server.ts (Redis subscriber per connection)
 *
 * PROTOCOL (raw WebSocket, no Socket.io — OkHttp can handle it natively):
 *   1. Android connects: wss://host/ws?txnId=<uuid>&token=<jwt>
 *   2. Server validates JWT, subscribes to Redis "txn:confirmed:{txnId}"
 *   3. When Redis message arrives, server forwards it to the WebSocket and closes
 *   4. Android parses the JSON payload — same shape as the polling response
 *
 * FALLBACK: If WebSocket fails to connect (firewall, poor 3G), PaymentOrchestrator
 * falls back to HTTP polling automatically.
 *
 * TIMEOUT: Android imposes a 60-second client timeout. After 60s with no event,
 * the app falls back to polling or shows a "check with customer" message.
 * Server closes idle connections after 70 seconds via ping/pong.
 */
import { Server } from 'http'
import WebSocket, { WebSocketServer } from 'ws'
import jwt from 'jsonwebtoken'
import { URL } from 'url'
import { redis } from '../db/redis'
import { logger } from '../util/logger'

const IDLE_TIMEOUT_MS = 70_000   // close connection if no payment arrives in 70s
const PING_INTERVAL_MS = 15_000  // keep TCP alive on Kenyan 3G

// Redis presence key TTL for consumer connections (seconds).
// Refreshed on each keepalive ping — mpesa-callback checks this before sending FCM.
const CONSUMER_PRESENCE_TTL = 90

export function initWsServer(httpServer: Server): void {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

  logger.info('WebSocket server ready', { path: '/ws' })

  wss.on('connection', (ws: WebSocket, req) => {
    const params     = new URL(req.url ?? '', 'http://localhost').searchParams
    const txnId      = params.get('txnId')
    const consumerId = params.get('consumerId')
    const token      = params.get('token')

    if (!token) { ws.close(1008, 'token required'); return }

    let payload: any
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET!)
    } catch {
      ws.close(1008, 'Invalid or expired token')
      return
    }

    // Route to the appropriate handler based on connection type
    if (consumerId) {
      handleConsumerConnection(ws, consumerId, payload)
    } else if (txnId) {
      handleTerminalConnection(ws, txnId)
    } else {
      ws.close(1008, 'txnId or consumerId required')
    }
  })
}

// ─── Merchant terminal connection (one-shot, per transaction) ────────────────

function handleTerminalConnection(ws: WebSocket, txnId: string) {
  logger.info('WS: terminal subscribed', { txnId })

  const channel = `txn:confirmed:${txnId}`
  const sub = redis.duplicate()

  sub.on('error', (err) => {
    logger.error('WS: terminal subscriber error', { txnId, error: err.message })
    ws.close(1011, 'Internal error')
  })

  void sub.subscribe(channel, (err) => {
    if (err) { logger.error('WS: subscribe failed', { channel, error: err.message }); ws.close(1011, 'Subscribe failed') }
  })

  sub.on('message', (_ch: string, message: string) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(message)
    cleanup()
  })

  const pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.ping()
    else clearInterval(pingTimer)
  }, PING_INTERVAL_MS)

  const idleTimer = setTimeout(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1000, 'Payment window expired')
      logger.info('WS: terminal idle timeout', { txnId })
    }
    cleanup()
  }, IDLE_TIMEOUT_MS)

  function cleanup() {
    clearInterval(pingTimer)
    clearTimeout(idleTimer)
    sub.unsubscribe().catch(() => {})
    sub.quit().catch(() => {})
  }

  ws.on('close', () => { cleanup(); logger.debug('WS: terminal disconnected', { txnId }) })
  ws.on('error', (err) => { logger.error('WS: terminal socket error', { txnId, error: err.message }); cleanup() })
}

// ─── Consumer wallet connection (persistent, multi-payment) ──────────────────
// Subscribes to consumer:payment:{consumerId} — mpesa-callback publishes here.
// Maintains a Redis presence key so mpesa-callback knows to skip FCM if WS is live.

function handleConsumerConnection(ws: WebSocket, consumerId: string, _payload: any) {
  logger.info('WS: consumer wallet connected', { consumerId })

  const channel     = `consumer:payment:${consumerId}`
  const presenceKey = `consumer:ws:${consumerId}`
  const sub = redis.duplicate()

  // Mark consumer as WebSocket-connected so mpesa-callback prefers WS over FCM
  redis.setex(presenceKey, CONSUMER_PRESENCE_TTL, '1').catch(() => {})

  sub.on('error', (err) => {
    logger.error('WS: consumer subscriber error', { consumerId, error: err.message })
    ws.close(1011, 'Internal error')
  })

  void sub.subscribe(channel, (err) => {
    if (err) { logger.error('WS: consumer subscribe failed', { channel, error: err.message }); ws.close(1011, 'Subscribe failed') }
  })

  // Unlike terminal connections, consumer connections are persistent.
  // Each incoming payment event is forwarded but the connection stays open.
  sub.on('message', (_ch: string, message: string) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(message)
  })

  const pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping()
      // Refresh presence key on each ping — consumer is still connected
      redis.setex(presenceKey, CONSUMER_PRESENCE_TTL, '1').catch(() => {})
    } else {
      clearInterval(pingTimer)
    }
  }, PING_INTERVAL_MS)

  function cleanup() {
    clearInterval(pingTimer)
    redis.del(presenceKey).catch(() => {})
    sub.unsubscribe().catch(() => {})
    sub.quit().catch(() => {})
  }

  ws.on('close', () => { cleanup(); logger.debug('WS: consumer wallet disconnected', { consumerId }) })
  ws.on('error', (err) => { logger.error('WS: consumer socket error', { consumerId, error: err.message }); cleanup() })
}
