package com.orchestratepay.offline

import android.content.Context
import androidx.room.*
import kotlinx.coroutines.flow.Flow
import java.time.Instant

/**
 * OfflineQueue — Room database for NFC_TAG and QR_CODE PaymentIntents that
 * could not be sent while the terminal was offline.
 *
 * HCE_PHONE intents are NEVER queued here — their 60-second session token
 * expires long before connectivity can be restored.
 */
@Entity(tableName = "offline_queue")
data class QueuedIntent(
    @PrimaryKey val idempotencyKey: String,
    val merchantId:    String,
    val tagId:         String?,
    val rawUid:        String?,
    val source:        String,    // NFC_TAG | QR_CODE only
    val amountCents:   Long,
    val queuedAt:      Long = System.currentTimeMillis(),
    val retryCount:    Int  = 0,
    val lastAttemptAt: Long? = null
)

@Dao
interface OfflineQueueDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun enqueue(intent: QueuedIntent)

    @Query("SELECT * FROM offline_queue ORDER BY queuedAt ASC")
    fun observeAll(): Flow<List<QueuedIntent>>

    @Query("SELECT * FROM offline_queue ORDER BY queuedAt ASC")
    suspend fun getAll(): List<QueuedIntent>

    @Query("SELECT COUNT(*) FROM offline_queue")
    suspend fun count(): Int

    @Delete
    suspend fun remove(intent: QueuedIntent)

    @Query("UPDATE offline_queue SET retryCount = retryCount + 1, lastAttemptAt = :now WHERE idempotencyKey = :key")
    suspend fun incrementRetry(key: String, now: Long = System.currentTimeMillis())

    @Query("DELETE FROM offline_queue WHERE queuedAt < :cutoff")
    suspend fun pruneOlderThan(cutoff: Long)
}

@Database(entities = [QueuedIntent::class], version = 1, exportSchema = false)
abstract class OfflineQueueDatabase : RoomDatabase() {
    abstract fun dao(): OfflineQueueDao

    companion object {
        @Volatile private var INSTANCE: OfflineQueueDatabase? = null

        fun get(context: Context): OfflineQueueDatabase =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    OfflineQueueDatabase::class.java,
                    "offline_queue.db"
                ).build().also { INSTANCE = it }
            }
    }
}
