package com.orchestratepay.consumer.realtime

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.orchestratepay.consumer.api.ConsumerApiClient
import com.orchestratepay.consumer.db.ConsumerSessionManager
import com.orchestratepay.consumer.ui.HomeActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * ConsumerNotificationService — Firebase Cloud Messaging handler.
 *
 * Two responsibilities:
 *   1. onNewToken: persist the new FCM device token locally and push it to the
 *      backend so mpesa-callback.ts can reach this device.
 *   2. onMessageReceived: display a system notification for CONFIRMED payments
 *      when the app is in the background (WebSocket is not running).
 *
 * Data payload schema (from mpesa-callback.ts sendFcmNotification call):
 *   { txnId, mpesaRef, amountCents, merchantName, status }
 */
class ConsumerNotificationService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        ConsumerSessionManager.saveFcmToken(token)
        if (ConsumerSessionManager.isLoggedIn()) {
            CoroutineScope(Dispatchers.IO).launch {
                runCatching { ConsumerApiClient.updateFcmToken(token) }
            }
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data        = message.data
        val txnId       = data["txnId"]           ?: return
        val amountCents = data["amountCents"]?.toIntOrNull() ?: return
        val merchantName = data["merchantName"]    ?: "Merchant"
        val mpesaRef    = data["mpesaRef"]
        val status      = data["status"]           ?: "CONFIRMED"

        if (status == "CONFIRMED") {
            showNotification(txnId, amountCents, merchantName, mpesaRef)
        }
    }

    private fun showNotification(
        txnId: String, amountCents: Int, merchantName: String, mpesaRef: String?
    ) {
        val channelId = "payments"
        val manager   = getSystemService(NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(channelId, "Payments", NotificationManager.IMPORTANCE_HIGH)
            )
        }

        val intent = Intent(this, HomeActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("txnId",    txnId)
            putExtra("mpesaRef", mpesaRef ?: "")
        }
        val pending = PendingIntent.getActivity(
            this, txnId.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val amountKsh = "%.2f".format(amountCents / 100.0)
        val body = buildString {
            append("KSh $amountKsh paid to $merchantName")
            if (!mpesaRef.isNullOrBlank()) append(" — Ref: $mpesaRef")
        }

        val notification = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(getString(R.string.payment_confirmed))
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        manager.notify(txnId.hashCode(), notification)
    }
}
