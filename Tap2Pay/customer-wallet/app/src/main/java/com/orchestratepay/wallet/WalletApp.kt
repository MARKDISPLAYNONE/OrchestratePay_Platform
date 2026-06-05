package com.orchestratepay.wallet

import android.app.Application
import com.orchestratepay.wallet.api.WalletApiClient

class WalletApp : Application() {

    override fun onCreate() {
        super.onCreate()
        WalletApiClient.init(BuildConfig.BASE_URL)
    }
}
