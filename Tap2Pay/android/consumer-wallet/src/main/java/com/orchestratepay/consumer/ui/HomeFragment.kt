package com.orchestratepay.consumer.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.orchestratepay.consumer.R
import com.orchestratepay.consumer.api.ConsumerApiClient
import com.orchestratepay.consumer.api.Transaction
import com.orchestratepay.consumer.db.ConsumerSessionManager
import kotlinx.coroutines.launch

/**
 * HomeFragment — summary dashboard.
 *
 * Shows:
 *   - Greeting with display name (or masked phone)
 *   - Total loyalty points across all merchants
 *   - Last 3 transactions
 */
class HomeFragment : Fragment() {

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View? =
        inflater.inflate(R.layout.fragment_home, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        val tvGreeting    = view.findViewById<TextView>(R.id.tv_greeting)
        val tvPoints      = view.findViewById<TextView>(R.id.tv_total_points)
        val tvRecentLabel = view.findViewById<TextView>(R.id.tv_recent_label)
        val tvTxn1        = view.findViewById<TextView>(R.id.tv_txn_1)
        val tvTxn2        = view.findViewById<TextView>(R.id.tv_txn_2)
        val tvTxn3        = view.findViewById<TextView>(R.id.tv_txn_3)

        val name = ConsumerSessionManager.getDisplayName()
            ?: ConsumerSessionManager.getPhone()?.let { "${it.take(6)}****" }
            ?: "there"
        tvGreeting.text = "Hi, $name"

        lifecycleScope.launch {
            // Load recent transactions
            runCatching { ConsumerApiClient.getTransactions(limit = 3) }
                .onSuccess { resp ->
                    val txns = resp.transactions
                    listOf(tvTxn1, tvTxn2, tvTxn3).forEachIndexed { i, tv ->
                        if (i < txns.size) {
                            tv.text = formatTxn(txns[i])
                            tv.visibility = View.VISIBLE
                        } else {
                            tv.visibility = View.GONE
                        }
                    }
                    if (txns.isEmpty()) tvRecentLabel.text = "No transactions yet"
                }
                .onFailure { tvRecentLabel.text = "Could not load transactions" }

            // Load total loyalty points
            runCatching { ConsumerApiClient.getLoyalty() }
                .onSuccess { resp ->
                    val total = resp.balances.sumOf { it.pointsBalance }
                    tvPoints.text = "$total loyalty points"
                }
        }
    }

    private fun formatTxn(txn: Transaction): String {
        val amountKsh = "%.2f".format(txn.amountCents / 100.0)
        val status = when (txn.status) {
            "CONFIRMED" -> "✓"
            "DECLINED"  -> "✗"
            else        -> "…"
        }
        return "$status  KSh $amountKsh — ${txn.merchantName}"
    }
}
