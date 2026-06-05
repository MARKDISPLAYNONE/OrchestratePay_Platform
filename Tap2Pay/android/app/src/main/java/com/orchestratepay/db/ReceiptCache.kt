package com.orchestratepay.db

import android.content.Context
import android.util.Log
import androidx.room.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.format.DateTimeFormatter

/**
 * ReceiptRecord — one confirmed payment cached locally on the terminal.
 *
 * Why a separate DB from AuditDatabase?
 *   - AuditDatabase is append-only compliance data (7-year retention).
 *   - ReceiptCache is merchant-facing; old entries are pruned after 500 rows.
 *   - Keeping them separate means schema changes never cross-affect each other.
 *
 * consumerPhone is ALWAYS the masked form ("25471****78").
 * The raw phone number must never be stored here.
 */
@Entity(tableName = "receipt_cache")
data class ReceiptRecord(
    @PrimaryKey val txnId: String,
    val mpesaRef: String,
    val amountCents: Long,
    val merchantName: String,
    val consumerPhone: String,       // masked — "25471****78"
    val kraPin: String?,
    val confirmedAtIso: String,      // ISO-8601 UTC, e.g. "2024-05-18T14:30:00Z"
    val printedAt: String? = null    // ISO-8601 UTC of last physical print, null = never
)

@Dao
interface ReceiptDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(receipt: ReceiptRecord): Long

    @Query("SELECT * FROM receipt_cache WHERE txnId = :txnId LIMIT 1")
    suspend fun getByTxnId(txnId: String): ReceiptRecord?

    /** Returns up to 100 most-recent receipts for the history screen. */
    @Query("SELECT * FROM receipt_cache ORDER BY confirmedAtIso DESC LIMIT 100")
    suspend fun getRecent(): List<ReceiptRecord>

    @Query("UPDATE receipt_cache SET printedAt = :ts WHERE txnId = :txnId")
    suspend fun markPrinted(txnId: String, ts: String)

    /**
     * Prune rows beyond the 500 most-recent. The terminal is not a long-term
     * archive — the backend daraja_callback_log satisfies CBK 7-year retention.
     */
    @Query("""
        DELETE FROM receipt_cache
        WHERE txnId NOT IN (
            SELECT txnId FROM receipt_cache
            ORDER BY confirmedAtIso DESC
            LIMIT 500
        )
    """)
    suspend fun pruneOld()

    @Query("SELECT COUNT(*) FROM receipt_cache")
    suspend fun count(): Long
}

@Database(entities = [ReceiptRecord::class], version = 1, exportSchema = false)
abstract class ReceiptDatabase : RoomDatabase() {
    abstract fun receiptDao(): ReceiptDao

    companion object {
        @Volatile private var instance: ReceiptDatabase? = null

        fun init(context: Context) {
            instance = Room.databaseBuilder(
                context.applicationContext,
                ReceiptDatabase::class.java,
                "orchestrate_receipts.db"
            ).build()
        }

        val current: ReceiptDatabase
            get() = instance ?: error("ReceiptDatabase not initialised — call init() in Application.onCreate()")
    }
}

/**
 * ReceiptCache — public façade for storing and retrieving receipts.
 *
 * save() is fire-and-forget: the caller (success screen) is never blocked by a
 * slow DB write. The receipt appears on-screen immediately; the DB write follows.
 *
 * get() and getRecent() are suspend functions — always call from a coroutine.
 */
object ReceiptCache {
    private val scope = CoroutineScope(Dispatchers.IO)

    private val dao: ReceiptDao
        get() = ReceiptDatabase.current.receiptDao()

    fun save(record: ReceiptRecord) {
        scope.launch {
            try {
                dao.insert(record)
                dao.pruneOld()
            } catch (e: Exception) {
                Log.e("ReceiptCache", "Failed to cache receipt ${record.txnId}: ${e.message}")
            }
        }
    }

    suspend fun get(txnId: String): ReceiptRecord? = dao.getByTxnId(txnId)

    suspend fun getRecent(): List<ReceiptRecord> = dao.getRecent()

    fun markPrinted(txnId: String) {
        scope.launch {
            try {
                val ts = DateTimeFormatter.ISO_INSTANT.format(Instant.now())
                dao.markPrinted(txnId, ts)
            } catch (e: Exception) {
                Log.e("ReceiptCache", "Failed to mark receipt printed: ${e.message}")
            }
        }
    }
}
