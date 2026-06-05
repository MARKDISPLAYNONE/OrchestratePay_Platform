---
name: orchestratepay-offline-first
description: >
  Build offline-first resilience into OrchestratePay's Android POS.
  Covers the offline transaction queue (Room DB), connectivity monitoring,
  queue sync on reconnection, STK Push deferred firing, offline receipt cache,
  conflict resolution on sync, and UX for offline-aware payment flows.
  Use this skill for: offline payment queuing, sync-on-reconnect, network state
  monitoring, Room database schema for pending queue, idempotency during sync,
  and "business never stops" UX patterns.
---

# OrchestratePay — Edge-Based Resilience (Offline-First)

## The offline problem in Kenyan retail

4G coverage in Kenyan markets, roadside kiosks, and matatu stages is unreliable.
A POS that shows "No connection" when a customer has their phone ready to tap is
a lost sale and a damaged merchant relationship.

**Important constraint**: STK Push requires a live Daraja API call — it cannot be
queued and replayed offline because:
- The consumer's phone must receive the prompt in near-real-time
- The idempotency key is time-bound (60-second minute window)

The offline queue therefore stores **payment intent records** that are converted
to live STK Push calls the moment connectivity returns, NOT pre-fired transactions.

## Offline queue schema (Room)

```kotlin
// db/OfflineQueue.kt
@Entity(tableName = "offline_queue")
data class QueuedPayment(
    @PrimaryKey val localId: String = UUID.randomUUID().toString(),
    val merchantId: String,
    val tagId: String?,
    val consumerPhone: String?,    // HCE_PHONE taps
    val hceToken: String?,
    val hceExp: Long?,
    val amountCents: Long,
    val source: String,            // NFC_TAG | HCE_PHONE | QR_CODE
    val rawUid: String?,
    val queuedAtMs: Long = System.currentTimeMillis(),
    val idempotencyKey: String,    // pre-computed before queuing
    val status: String = "QUEUED", // QUEUED | SYNCING | SYNCED | FAILED
    val syncAttempts: Int = 0,
    val lastError: String? = null
)

@Dao
interface OfflineQueueDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun enqueue(payment: QueuedPayment)

    @Query("SELECT * FROM offline_queue WHERE status = 'QUEUED' ORDER BY queuedAtMs ASC")
    suspend fun getPending(): List<QueuedPayment>

    @Query("UPDATE offline_queue SET status='SYNCING' WHERE localId=:id")
    suspend fun markSyncing(id: String)

    @Query("UPDATE offline_queue SET status=:status, lastError=:err, syncAttempts=syncAttempts+1 WHERE localId=:id")
    suspend fun updateStatus(id: String, status: String, err: String?)

    @Query("DELETE FROM offline_queue WHERE status='SYNCED' AND queuedAtMs < :before")
    suspend fun pruneOld(before: Long)
}
```

## Connectivity monitor

```kotlin
// network/ConnectivityMonitor.kt
class ConnectivityMonitor(context: Context) {

    private val connectivityManager =
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    val isOnline: Boolean
        get() {
            val network = connectivityManager.activeNetwork ?: return false
            val caps    = connectivityManager.getNetworkCapabilities(network) ?: return false
            return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                   caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        }

    // Emits true/false on network state changes — collect in a coroutine
    val networkState: Flow<Boolean> = callbackFlow {
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network)  { trySend(true) }
            override fun onLost(network: Network)       { trySend(false) }
        }
        connectivityManager.registerDefaultNetworkCallback(callback)
        awaitClose { connectivityManager.unregisterNetworkCallback(callback) }
    }
}
```

## Offline queue sync service

```kotlin
// sync/QueueSyncService.kt
class QueueSyncService(
    private val queueDao: OfflineQueueDao,
    private val apiClient: OrchestrateApiClient,
    private val auditLog: AuditLogger,
    private val scope: CoroutineScope
) {
    fun startMonitoring(connectivity: ConnectivityMonitor) {
        scope.launch {
            connectivity.networkState
                .filter { isOnline -> isOnline }
                .collect { flushQueue() }
        }
    }

    suspend fun flushQueue() {
        val pending = queueDao.getPending()
        if (pending.isEmpty()) return

        for (item in pending) {
            queueDao.markSyncing(item.localId)

            val intent = item.toPaymentIntent()
            val result = runCatching {
                apiClient.initiatePayment(item.toTransactionRequest())
            }

            result.fold(
                onSuccess = { response ->
                    queueDao.updateStatus(item.localId, "SYNCED", null)
                    auditLog.record(AuditEvent.PAYMENT_INTENT_RECEIVED,
                        "queued=${item.localId} synced via ${item.source}")
                },
                onFailure = { err ->
                    val newStatus = if (item.syncAttempts >= 3) "FAILED" else "QUEUED"
                    queueDao.updateStatus(item.localId, newStatus, err.message)
                }
            )

            delay(300)  // brief pause between syncs — avoid thundering herd
        }
    }
}
```

## HCE_PHONE offline constraint

HCE tap sessions are 60-second TTL. If the POS is offline when the customer taps:
- The HCE token will be EXPIRED before connectivity returns
- Do NOT queue HCE_PHONE intents — show the merchant "No connection — ask customer to tap again when signal returns"
- Silently queueing an expired HCE token wastes a sync attempt with a guaranteed 401

```kotlin
// In MerchantDashboardActivity.onTagDetected():
if (intent.source == PaymentSource.HCE_PHONE && !connectivity.isOnline) {
    showError("No connection — cannot process phone tap offline. Ask customer to tap again.")
    return
}
// NFC_TAG and QR_CODE can be queued (no TTL on the tag itself)
```

## Offline UX states

| State | POS shows |
|-------|-----------|
| Online | Normal payment flow |
| Offline, NFC_TAG tapped | "Saved offline — will process when signal returns" + queue count badge |
| Offline, HCE_PHONE tapped | "No signal — phone tap needs internet. Tap sticker instead." |
| Back online | Brief "Syncing X payments..." banner → normal flow |
| Queued item fails 3× | "1 payment could not be sent — tap to review" |

## Idempotency during sync

The idempotency key is pre-computed at queue time (not at sync time):
```kotlin
val key = IdempotencyKeyGen.generate(intent, amountCents)
// Stored with the QueuedPayment — same key used on every sync retry
```

This means if the POS syncs, the network drops mid-response, and the POS retries:
the backend's idempotency cache returns the original result with no second STK Push.

## Key invariants

1. Never queue HCE_PHONE taps — tokens expire in 60 seconds
2. Pre-compute idempotency key at enqueue time, not at sync time
3. Max 3 sync attempts per queued item — prevent infinite loops on server errors
4. Prune `SYNCED` items older than 7 days to keep the queue table lean
5. The queue is for retry, not for deferred payment — show the merchant exactly
   what is pending so they can manually re-initiate if needed
6. Offline receipt cache (ReceiptCache.kt) is separate from the offline queue —
   one is for outbound payment intents, the other is for inbound confirmed receipts
