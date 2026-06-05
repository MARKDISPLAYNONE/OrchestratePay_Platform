package com.orchestratepay.consumer.ui

import android.app.AlertDialog
import android.app.PendingIntent
import android.content.Intent
import android.nfc.NfcAdapter
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.Fragment
import com.google.android.material.bottomnavigation.BottomNavigationView
import com.orchestratepay.consumer.R
import com.orchestratepay.consumer.realtime.ConsumerPaymentEvent
import com.orchestratepay.consumer.realtime.ConsumerWebSocketClient

/**
 * HomeActivity — root container for the bottom navigation.
 *
 * Also owns the WebSocket payment listener. When a payment arrives via WebSocket,
 * it shows a confirmation dialog regardless of which tab is active, then refreshes
 * the HomeFragment if it's currently shown.
 */
class HomeActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_home)

        val navView = findViewById<BottomNavigationView>(R.id.bottom_nav)

        // Start on Home tab
        if (savedInstanceState == null) {
            loadFragment(HomeFragment())
        }

        navView.setOnItemSelectedListener { item ->
            val fragment: Fragment = when (item.itemId) {
                R.id.nav_home    -> HomeFragment()
                R.id.nav_pay     -> TapToPayFragment()
                R.id.nav_history -> TransactionHistoryFragment()
                R.id.nav_loyalty -> LoyaltyFragment()
                R.id.nav_profile -> ProfileFragment()
                else             -> return@setOnItemSelectedListener false
            }
            loadFragment(fragment)
            true
        }

        // Handle FCM tap-through: if launched with txnId extra, show receipt dialog
        intent?.getStringExtra("txnId")?.let { txnId ->
            val mpesaRef = intent.getStringExtra("mpesaRef") ?: ""
            showPaymentDialog(txnId, mpesaRef)
        }

        // WebSocket payment events while app is in foreground
        ConsumerWebSocketClient.shared?.onPaymentReceived = { event ->
            runOnUiThread { showPaymentEventDialog(event) }
        }
    }

    override fun onResume() {
        super.onResume()
        // Forward merchant display tag taps to NfcTagPaymentActivity while app is open.
        // Without this, the OS would launch a new HomeActivity instead of the payment screen.
        val pending = PendingIntent.getActivity(
            this, 0,
            Intent(this, NfcTagPaymentActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        NfcAdapter.getDefaultAdapter(this)?.enableForegroundDispatch(
            this, pending, null, null
        )
    }

    override fun onPause() {
        super.onPause()
        NfcAdapter.getDefaultAdapter(this)?.disableForegroundDispatch(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // Handle FCM tap-through delivered while the activity is already running
        intent.getStringExtra("txnId")?.let { txnId ->
            val mpesaRef = intent.getStringExtra("mpesaRef") ?: ""
            showPaymentDialog(txnId, mpesaRef)
        }
        // NFC tag taps are forwarded directly to NfcTagPaymentActivity via foreground dispatch;
        // they never arrive here as onNewIntent.
    }

    private fun loadFragment(fragment: Fragment) {
        supportFragmentManager.beginTransaction()
            .replace(R.id.fragment_container, fragment)
            .commit()
    }

    private fun showPaymentEventDialog(event: ConsumerPaymentEvent) {
        val amountKsh = "%.2f".format(event.amountCents / 100.0)
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.payment_confirmed))
            .setMessage(
                "KSh $amountKsh paid to ${event.merchantName}" +
                (if (!event.mpesaRef.isNullOrBlank()) "\nM-Pesa ref: ${event.mpesaRef}" else "")
            )
            .setPositiveButton("OK") { d, _ -> d.dismiss() }
            .show()
    }

    private fun showPaymentDialog(txnId: String, mpesaRef: String) {
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.payment_confirmed))
            .setMessage(if (mpesaRef.isNotBlank()) "M-Pesa ref: $mpesaRef" else "Transaction: $txnId")
            .setPositiveButton("OK") { d, _ -> d.dismiss() }
            .show()
    }
}
