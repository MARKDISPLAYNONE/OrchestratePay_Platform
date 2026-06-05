package com.orchestratepay.consumer

import android.app.Application
import com.orchestratepay.consumer.api.ConsumerApiClient
import com.orchestratepay.consumer.db.ConsumerSessionManager
import com.orchestratepay.consumer.realtime.ConsumerWebSocketClient

class ConsumerApp : Application() {
    override fun onCreate() {
        super.onCreate()
        ConsumerSessionManager.init(this)
        ConsumerApiClient.init(BuildConfig.API_BASE_URL)
        ConsumerWebSocketClient.init(BuildConfig.WS_BASE_URL)

        // Re-connect WebSocket if a session already exists from a previous launch
        if (ConsumerSessionManager.isLoggedIn()) {
            ConsumerWebSocketClient.shared?.connect()
        }
    }
}
