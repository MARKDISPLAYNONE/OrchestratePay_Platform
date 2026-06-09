package com.orchestratepay.offline

import android.content.Context
import android.util.Log
import com.orchestratepay.api.OrchestrateApiClient
import com.orchestratepay.api.TransactionRequest
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter

private const val TAG = "QueueSyncService"
private const val MAX_RETRIES = 5
private const val PRUNE_OLDER_THAN_MS = 24 * 60 * 60 * 1000L  // 24 hours

/**
 * QueueSyncService — flushes the offline queue when connectivity is restored.
 *
 * Call start() once from OrchestaPayApp. It observes ConnectivityMonitor and
 * on every false→true transition attempts to drain the queue.
 *
 * Each queued intent is submitted as a new transaction. If the backend returns
 * 409 Conflict (idempotency key already used), the entry is dropped — the
 * payment was already processed, likely before connectivity was lost.
 *
 * Items that have been in the queue for > 24 hours are pruned — the merchant
 * would have noticed the failure and asked the customer to pay again.
 */
class QueueSyncService(private val context: Context) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val db    = OfflineQueueDatabase.get(context)

    fun start() {
        scope.launch {
            ConnectivityMonitor.observe(context)
                .filter { isOnline -> isOnline }
                .collect { flushQueue() }
        }
    }

    private suspend fun flushQueue() {
        val pending = db.dao().getAll()
        if (pending.isEmpty()) return

        Log.i(TAG, "Connectivity restored — flushing ${pending.size} queued intent(s)")

        // Prune stale entries first (older than 24h)
        db.dao().pruneOlderThan(System.currentTimeMillis() - PRUNE_OLDER_THAN_MS)

        for (item in pending) {
            if (item.retryCount >= MAX_RETRIES) {
                Log.w(TAG, "Dropping queued intent after $MAX_RETRIES retries: ${item.idempotencyKey}")
                db.dao().remove(item)
                continue
            }

            try {
                val request = TransactionRequest(
                    merchantId     = item.merchantId,
                    tagId          = item.tagId,
                    nfcUid         = item.rawUid,
                    source         = item.source,
                    amountCents    = item.amountCents,
                    idempotencyKey = item.idempotencyKey,
                    timestamp      = item.queuedAt,
                )
                val response = OrchestrateApiClient.current.submitTransaction(request)

                if (response.isSuccessful || response.code() == 409) {
                    // 409 = already processed (idempotent success)
                    db.dao().remove(item)
                    Log.i(TAG, "Queued intent synced: ${item.idempotencyKey} (HTTP ${response.code()})")
                } else {
                    db.dao().incrementRetry(item.idempotencyKey)
                    Log.w(TAG, "Sync attempt failed (HTTP ${response.code()}): ${item.idempotencyKey}")
                }
            } catch (e: Exception) {
                db.dao().incrementRetry(item.idempotencyKey)
                Log.e(TAG, "Sync attempt threw: ${e.message} for ${item.idempotencyKey}")
            }
        }
    }

    fun stop() = scope.cancel()
}
