---
name: orchestratepay-websocket
description: >
  Design, implement, and debug WebSocket connections in OrchestratePay — both the Node.js
  server (realtime/ws-server.ts) and the Android clients (merchant terminal polling upgrade,
  consumer wallet ConsumerWebSocketClient). Covers the ws library server API, OkHttp WebSocket
  on Android, connection URL format and authentication, the two Redis pub/sub channels
  (terminal one-shot vs. consumer persistent), consumer presence key, reconnection strategy
  with exponential backoff, Android background restrictions (Doze mode), Kenya 3G network
  conditions, adding new real-time event types, and debugging tools. Use this skill when
  the terminal shows a delayed confirmation, the consumer wallet misses a payment push,
  WebSocket connections drop on mobile data, you are adding a new server-push event, or
  investigating double-notification (WebSocket + FCM).
---

# OrchestratePay — WebSocket Real-Time System

## Architecture in one diagram

```
Safaricom M-Pesa callback
        │
        ▼
  mpesa-callback.ts
        │
        ├─ redis.publish("txn:confirmed:{txnId}", payload)
        │         └──▶ ws-server.ts finds subscriber
        │                     └──▶ terminal WebSocket  (one-shot, closes after send)
        │
        └─ redis.publish("consumer:payment:{consumerId}", payload)
                  └──▶ ws-server.ts finds subscriber
                              └──▶ consumer wallet WebSocket  (persistent)
                  also checks consumer:ws:{consumerId}:
                    present  → WebSocket delivered, skip FCM
                    absent   → send FCM push notification instead
```

## Server: `realtime/ws-server.ts`

### Initialisation
```typescript
import { initWsServer } from './realtime/ws-server'
const httpServer = http.createServer(app)
initWsServer(httpServer)               // mounts on same port as Express; path = /ws
httpServer.listen(PORT)
```

### Connection URL format
```
Terminal:        wss://host/ws?txnId={uuid}&token={jwt}
Consumer wallet: wss://host/ws?consumerId={uuid}&token={jwt}
```

### Connection routing logic
```typescript
// consumerId takes priority — if both params present, treated as consumer connection
if (consumerId)  → subscribe to consumer:payment:{consumerId}
else if (txnId)  → subscribe to txn:confirmed:{txnId}
else             → ws.close(1008, "txnId or consumerId required")
```

JWT is validated on every connection (`jwt.verify`). Missing or expired token → `close(1008, "token required")`.

### Timing constants
| Constant | Value | Purpose |
|---|---|---|
| `IDLE_TIMEOUT_MS` | 70,000 ms | Close idle **terminal** connections after 70 s |
| `PING_INTERVAL_MS` | 15,000 ms | Server-sent ping — keeps 3G NAT alive, refreshes presence TTL |
| `CONSUMER_PRESENCE_TTL` | 90 s | Redis TTL for `consumer:ws:{id}` key |
| Android client timeout | 60,000 ms | Terminal/wallet falls back to polling after 60 s |

Server idle timeout (70 s) is intentionally longer than Android's (60 s) so the server never closes a connection the client is still expecting.

### Consumer presence key
```typescript
// On consumer wallet connect:
redis.setex(`consumer:ws:${consumerId}`, 90, "1")

// Refreshed on every ping (every 15 s — 6 refreshes before 90 s TTL expires):
redis.setex(`consumer:ws:${consumerId}`, 90, "1")

// On disconnect:
redis.del(`consumer:ws:${consumerId}`)
```

`mpesa-callback.ts` checks this key to decide WS vs FCM:
```typescript
const wsPresent = await redis.exists(`consumer:ws:${consumerId}`)
if (wsPresent) {
    await redis.publish(`consumer:payment:${consumerId}`, payload)
} else {
    await sendFcmNotification({ fcmToken, title, body, data })
}
```

### Message shape (same as polling response)
```json
{
  "txnId": "uuid",
  "status": "CONFIRMED",
  "amountCents": 50000,
  "mpesaRef": "ODE3K5Z8",
  "consumerPhone": "254712****78"
}
```
Terminal statuses: `CONFIRMED`, `DECLINED`, `FAILED` — close connection after receiving any of these.
Non-terminal: `PENDING`, `STK_SENT` — keep polling (WS message should not carry these in practice).

### Adding a new real-time event type
1. Add a Redis pub/sub channel: follow `{entity}:{event}:{id}` naming
2. Publish from the relevant route handler after the DB write
3. Add a new `else if` branch in `ws-server.ts` to subscribe on the new query param
4. Update the Android client to parse the new message shape
5. Update the presence key check if the new event also needs FCM fallback

## Android: merchant terminal WebSocket client

The terminal upgrades from polling (2.5 s interval) to WebSocket once the `txnId` is known.

```kotlin
// OkHttp WebSocket (already bundled with Retrofit's OkHttpClient)
val client = OkHttpClient.Builder()
    .pingInterval(20, TimeUnit.SECONDS)   // client-side ping — belt-and-suspenders for 3G
    .connectTimeout(10, TimeUnit.SECONDS)
    .readTimeout(0, TimeUnit.MILLISECONDS) // infinite read — we wait indefinitely for a push
    .build()

val request = Request.Builder()
    .url("wss://${host}/ws?txnId=${txnId}&token=${SessionManager.getToken()}")
    .build()

val listener = object : WebSocketListener() {
    override fun onMessage(webSocket: WebSocket, text: String) {
        val response = gson.fromJson(text, TransactionResponse::class.java)
        when (response.status) {
            "CONFIRMED", "DECLINED", "FAILED" -> {
                webSocket.close(1000, "done")
                mainHandler.post { onResult(response) }
            }
        }
    }
    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        // Fall back to polling if WebSocket fails
        mainHandler.post { startPollingFallback(txnId) }
    }
    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        if (!resultReceived) startPollingFallback(txnId)
    }
}

val ws = client.newWebSocket(request, listener)
// Fallback: if no message after 60 s, close WS and switch to polling
handler.postDelayed({
    ws.close(1000, "timeout")
    startPollingFallback(txnId)
}, 60_000L)
```

**readTimeout must be 0** — a non-zero read timeout would close the socket if no bytes arrive for that duration, which happens normally when the consumer takes 30 s to enter their PIN.

## Android: consumer wallet persistent connection

The consumer wallet keeps one persistent WebSocket for the duration of the app session.

```kotlin
// Reconnect with exponential backoff
private var reconnectDelayMs = 1_000L
private val MAX_RECONNECT_DELAY = 30_000L

fun connect() {
    val url = "wss://${host}/ws?consumerId=${consumerId}&token=${getToken()}"
    ws = client.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
        override fun onOpen(ws: WebSocket, resp: Response) {
            reconnectDelayMs = 1_000L  // reset backoff on successful connect
        }
        override fun onMessage(ws: WebSocket, text: String) {
            // Parse and notify TapToPayFragment
            notifyPaymentReceived(gson.fromJson(text, PaymentPushMessage::class.java))
        }
        override fun onFailure(ws: WebSocket, t: Throwable, resp: Response?) {
            scheduleReconnect()
        }
        override fun onClosed(ws: WebSocket, code: Int, reason: String) {
            if (code != 1000) scheduleReconnect()  // 1000 = intentional close, don't reconnect
        }
    })
}

private fun scheduleReconnect() {
    handler.postDelayed({ connect() }, reconnectDelayMs)
    reconnectDelayMs = minOf(reconnectDelayMs * 2, MAX_RECONNECT_DELAY)
}
```

## Kenya 3G network conditions

Kenyan mobile data (Safaricom, Airtel) has aggressive carrier-grade NAT with **30–45 second idle timeouts**. A WebSocket with no bytes in either direction for ~40 s will be silently dropped by the carrier.

**Mitigation already in place**:
- Server pings every 15 s (`PING_INTERVAL_MS`)
- Android client pings every 20 s (`pingInterval(20, SECONDS)`)
- Together they ensure bytes flow in both directions every 15 s — well under the ~40 s carrier timeout

**If you see intermittent disconnects**: reduce `pingInterval` further. Do not increase it.

## Android background restrictions (Doze mode)

Android 6+ Doze mode suspends network access for background apps. The consumer wallet WebSocket will be disconnected when the phone is idle (screen off, not charging, stationary).

**Behaviour**: the connection is cut, FCM takes over, and when the consumer opens the app the wallet reconnects automatically (exponential backoff).

**Do not fight Doze**: FCM is specifically designed to work through Doze — it uses high-priority messages (`priority: high`) to wake the app. The WS/FCM architecture handles this correctly already.

## Redis pub/sub on the server

Two dedicated Redis clients per connected WebSocket (subscriber cannot share a connection
that also runs regular commands):
```typescript
const sub = new Redis(process.env.REDIS_URL!)  // subscriber connection
sub.subscribe(channel)
sub.on('message', (chan, msg) => ws.send(msg))
ws.on('close', () => { sub.unsubscribe(); sub.quit() })
```

**Avoid**: sharing the main `redis` singleton for pub/sub subscriptions. Once a connection is in subscriber mode, it cannot issue regular commands.

## Debugging

### Server-side
```bash
# Check how many WebSocket connections are currently open
GET /admin/stats → infrastructure.websocket_connections

# Live Redis pub/sub events
redis-cli SUBSCRIBE txn:confirmed:*
redis-cli SUBSCRIBE consumer:payment:*

# Check consumer presence keys
redis-cli KEYS consumer:ws:*
redis-cli TTL consumer:ws:{consumerId}
```

### Android-side
```bash
# Live WebSocket frames in Logcat
adb logcat | grep -i "websocket\|OkHttp"

# Check if consumer is connected
redis-cli EXISTS consumer:ws:{consumerId}
# 1 = connected, 0 = not connected (FCM path will be used)
```

### Simulating a payment push (dev/test)
```bash
redis-cli PUBLISH txn:confirmed:some-txn-uuid \
  '{"txnId":"some-txn-uuid","status":"CONFIRMED","amountCents":50000}'
```
The connected terminal will immediately receive this and show the confirmation screen.

## Common failures

| Symptom | Root cause | Fix |
|---|---|---|
| Terminal waits full 60 s then shows "check with customer" | WebSocket failed, polling kicked in | Check JWT validity; verify wss:// port 443 is not firewalled |
| Consumer wallet misses payment, only gets FCM | `consumer:ws:{id}` presence key expired | Verify ping interval; check server uptime |
| Double notification (WS + FCM) | Presence key expired milliseconds before callback arrived | Accept this race — it's cosmetic; FCM fires ≤1 extra notification |
| WebSocket drops every ~40 s on 3G | Carrier NAT idle timeout | Reduce ping interval to 15 s or less |
| `Error: use of closed client` on subscribe | Reusing main Redis connection for pub/sub | Create a dedicated sub Redis client per WS connection |
| Consumer wallet never reconnects after background | Doze mode killed the reconnect handler | Use `AlarmManager` or `WorkManager` for reconnect scheduling in background |

## See also
- `orchestratepay-realtime-notifications` — higher-level architecture (WS + FCM + Redis channels)
- `orchestratepay-android-kotlin` — Android threading model, OkHttp singleton, coroutines
