package com.orchestratepay.db

import android.content.Context
import androidx.room.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.format.DateTimeFormatter

// ─────────────────────────────────────────────────────────────────────────────
// ROOM DATABASE SCHEMA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AuditEntry — one row in the on-device audit log.
 *
 * CBK (Central Bank of Kenya) requirement: every payment-related event must be
 * logged with a timestamp and sufficient detail for post-facto reconciliation.
 * This table is append-only — we never UPDATE or DELETE rows.
 *
 * The log is stored in Room (SQLite) so it survives:
 *   - App crashes mid-transaction
 *   - Network outages
 *   - App updates
 *   - Device restarts
 */
@Entity(tableName = "audit_log")
data class AuditEntry(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val event: String,          // AuditEvent.name
    val detail: String,         // free-form context string
    val timestampIso: String,   // ISO-8601 UTC timestamp
    val sessionId: String       // merchant session ID (from JWT claim)
)

@Dao
interface AuditDao {
    @Insert
    suspend fun insert(entry: AuditEntry): Long

    /** Returns all audit entries for the current session — used for support queries */
    @Query("SELECT * FROM audit_log WHERE sessionId = :sessionId ORDER BY id ASC")
    suspend fun getSessionEntries(sessionId: String): List<AuditEntry>

    /** Returns entries newer than the given timestamp — for sync with backend */
    @Query("SELECT * FROM audit_log WHERE timestampIso > :since ORDER BY id ASC LIMIT 500")
    suspend fun getEntriesSince(since: String): List<AuditEntry>

    /** Total count — useful for health checks */
    @Query("SELECT COUNT(*) FROM audit_log")
    suspend fun count(): Long
}

@Database(entities = [AuditEntry::class], version = 1, exportSchema = false)
abstract class AuditDatabase : RoomDatabase() {
    abstract fun auditDao(): AuditDao

    companion object {
        @Volatile private var instance: AuditDatabase? = null

        fun init(context: Context) {
            instance = Room.databaseBuilder(
                context.applicationContext,
                AuditDatabase::class.java,
                "orchestrate_audit.db"
            )
            .fallbackToDestructiveMigration()  // dev only — replace with migrations in prod
            .build()
        }

        val current: AuditDatabase
            get() = instance ?: error("AuditDatabase not initialised")
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT EVENTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AuditEvent — every discrete event in the payment lifecycle.
 * Each event gets its own row in the audit_log table.
 */
enum class AuditEvent {
    // App lifecycle
    APP_STARTED,
    MERCHANT_LOGGED_IN,
    MERCHANT_LOGGED_OUT,
    SESSION_EXPIRED,

    // NFC layer
    NFC_TAG_DETECTED,       // static NDEF sticker tapped
    HCE_TAP_DETECTED,       // customer phone (HCE) tapped — APDU handshake completed, token verified client-side
    NFC_READ_FAILED,
    NFC_UNRECOGNISED_TAG,
    NFC_TOKEN_EXPIRED,      // HCE session token was stale when the POS read it
    QR_CODE_SCANNED,

    // Orchestrator
    PAYMENT_INTENT_RECEIVED,
    AMOUNT_ENTERED,
    API_ATTEMPT,
    STK_PUSH_SENT,
    POLL_STARTED,
    POLL_TIMEOUT,

    // Results
    PAYMENT_CONFIRMED,
    PAYMENT_DECLINED,
    PAYMENT_FAILED,
    MAX_RETRIES_EXCEEDED,
    ORCHESTRATOR_EXCEPTION,
    SERVER_ERROR,

    // Real-time delivery
    WS_FALLBACK,    // WebSocket failed; fell back to polling

    // Printing
    RECEIPT_PRINT_STARTED,
    RECEIPT_PRINT_SUCCESS,
    RECEIPT_PRINT_FAILED,

    // Reconciliation
    RECONCILIATION_RUN,
    TRANSACTION_RECONCILED
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGGER FACADE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AuditLogger — the public interface for writing audit events.
 *
 * Fire-and-forget: record() launches a coroutine on the IO dispatcher.
 * The caller never waits for the DB write. This means:
 *   1. The payment flow is never blocked by a slow DB write
 *   2. In extremely rare cases, the last few events before a crash might not be
 *      persisted — acceptable for audit log vs. unacceptable for the ledger
 */
class AuditLogger {
    private val dao = AuditDatabase.current.auditDao()
    private val scope = CoroutineScope(Dispatchers.IO)

    fun record(event: AuditEvent, detail: String = "") {
        scope.launch {
            val entry = AuditEntry(
                event        = event.name,
                detail       = detail.take(500),  // cap at 500 chars to prevent huge rows
                timestampIso = DateTimeFormatter.ISO_INSTANT.format(Instant.now()),
                sessionId    = SessionManager.getSessionId() ?: "unauthenticated"
            )
            try {
                dao.insert(entry)
            } catch (e: Exception) {
                // If the audit log itself fails, log to Android logcat only.
                // Never crash the payment flow because of an audit log failure.
                android.util.Log.e("AuditLogger", "Failed to write audit entry: ${e.message}")
            }
        }
    }
}
