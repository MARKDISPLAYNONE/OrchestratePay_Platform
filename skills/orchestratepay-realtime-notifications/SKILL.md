---
name: orchestratepay-realtime-notifications
description: >
  Build and debug the real-time payment push pipeline — WebSocket server (realtime/ws-server.ts),
  Firebase Cloud Messaging fallback (util/fcm.ts), Redis pub/sub channels, consumer presence
  tracking, and the Android consumer wallet client (ConsumerWebSocketClient.kt /
  ConsumerNotificationService.kt). Use this skill when payment confirmations are slow to appear,
  the Android app polls instead of receiving instant pushes, FCM is not firing, WebSocket
  connections are dropped on 3G, you are adding a new real-time event type, or you need to
  understand the WS → FCM fallback decision.
---

# OrchestratePay — Real-Time Notifications

## Architecture overview
```
Safaricom callback arrives
        │
        ▼
  mpesa-callback.ts
    redis.publish("txn:confirmed:{txnId}", jsonPayload)      ← for merchant terminal
    redis.publish("consumer:payment:{consumerId}", payload)  ← for consumer wallet
        │
        ├──► ws-server.ts ──► Android (WebSocket) ~100ms latency
        │         │
        │         └── mpesa-callback checks consumer:ws:{id} presence key first
        │
        └──► util/fcm.ts ──► Firebase → Android push  ~500ms latency
                  └── only sent if WebSocket presence key is absent
```

## Redis pub/sub channels
| Channel | Who publishes | Who subscribes | Notes |
|---|---|---|---|
| `txn:confirmed:{txnId}` | `mpesa-callback.ts` | Terminal WS connection | One-shot: connection closes after delivery |
| `consumer:payment:{consumerId}` | `mpesa-callback.ts` | Consumer wallet WS connection | Persistent: connection stays open for future payments |

## WebSocket connection protocol
```
Terminal:         wss://host/ws?txnId={uuid}&token={jwt}
Consumer wallet:  wss://host/ws?consumerId={uuid}&token={jwt}
```
1. Server validates JWT → invalid or expired = `close(1008, "Invalid or expired token")`
2. Server subscribes to the appropriate Redis channel
3. When Redis publishes, server forwards the JSON message to the WebSocket
4. Terminal connection closes after the first message (one-shot — one transaction per connection)
5. Consumer wallet connection stays open (persistent — receives multiple incoming payments)

## Consumer presence key
When a consumer wallet connects:
```
Redis SETEX consumer:ws:{consumerId} 90 "1"
```
Refreshed on every ping (every 15s). `mpesa-callback.ts` checks this key:
- Key **exists** → consumer is live on WebSocket → **skip FCM** (avoid double notification)
- Key **absent** → consumer is not connected → **send FCM**

## Timing constants
| Constant | Value | Purpose |
|---|---|---|
| `IDLE_TIMEOUT_MS` | 70,000 ms | Server closes idle terminal connections after 70s |
| `PING_INTERVAL_MS` | 15,000 ms | TCP keepalive — prevents mid-flow drops on Kenyan 3G |
| `CONSUMER_PRESENCE_TTL` | 90 s | Redis presence key TTL, refreshed on each ping |
| Android client timeout | 60 s | App falls back to "check with customer" after 60s |

## FCM (`util/fcm.ts`)
- Requires `FIREBASE_SERVICE_ACCOUNT_JSON` env var (JSON string from Firebase Console)
- If env var is absent: silently no-ops — FCM is gracefully disabled
- `sendFcmNotification()` **never throws** — errors are logged and swallowed
- Android channel: `payments`, priority: `high`, sound: `default`

## FCM payload shape
```typescript
{
  fcmToken:    string,              // device FCM token from the consumer's DB record
  title:       string,              // e.g. "Payment Confirmed"
  body:        string,              // e.g. "KSh 500.00 from Wanjiku"
  data: {
    txnId:       string,
    amountCents: string,            // FCM data values must be strings
    status:      string,
  }
}
```

## Adding a new real-time event type
1. Choose a Redis channel name using the `{entity}:{event}:{id}` convention
2. Publish from the relevant route handler after the DB write
3. If the event targets a consumer: reuse `consumer:payment:{consumerId}` (already subscribed)
4. If the event targets a merchant terminal: reuse `txn:confirmed:{txnId}` (existing)
5. For a new connection type, add a new query param handler in `ws-server.ts`
6. Update `ConsumerWebSocketClient.kt` to parse the new message shape

## Common failures
| Symptom | Cause | Fix |
|---|---|---|
| App polling instead of WS push | WebSocket connection failing silently | Check JWT validity; check firewall allows WSS port 443 |
| Double notification (WS + FCM) | Presence key expired before callback arrived | Increase `CONSUMER_PRESENCE_TTL` or reduce processing latency |
| Terminal stuck waiting forever | Redis pub/sub subscriber error | Check `GET /admin/stats` → `infrastructure.redis` |
| FCM not arriving | `FIREBASE_SERVICE_ACCOUNT_JSON` not set | Set env var; look for "FCM disabled" in server logs |
| WebSocket disconnects on 3G | Aggressive carrier NAT closing idle TCP | Ping interval already set to 15s — check carrier firewall rules |
