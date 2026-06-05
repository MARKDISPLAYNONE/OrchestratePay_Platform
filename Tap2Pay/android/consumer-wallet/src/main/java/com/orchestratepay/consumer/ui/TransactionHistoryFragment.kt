package com.orchestratepay.consumer.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.orchestratepay.consumer.R
import com.orchestratepay.consumer.api.ConsumerApiClient
import com.orchestratepay.consumer.api.Transaction
import kotlinx.coroutines.launch

class TransactionHistoryFragment : Fragment() {

    private var offset = 0
    private val limit  = 20

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View? =
        inflater.inflate(R.layout.fragment_transaction_history, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        val listContainer = view.findViewById<LinearLayout>(R.id.list_container)
        val tvEmpty       = view.findViewById<TextView>(R.id.tv_empty)
        val tvLoadMore    = view.findViewById<TextView>(R.id.tv_load_more)

        loadTransactions(listContainer, tvEmpty, tvLoadMore)

        tvLoadMore.setOnClickListener {
            offset += limit
            loadTransactions(listContainer, tvEmpty, tvLoadMore)
        }
    }

    private fun loadTransactions(container: LinearLayout, tvEmpty: TextView, tvLoadMore: TextView) {
        lifecycleScope.launch {
            runCatching { ConsumerApiClient.getTransactions(limit, offset) }
                .onSuccess { resp ->
                    if (resp.transactions.isEmpty() && offset == 0) {
                        tvEmpty.visibility = View.VISIBLE
                        tvLoadMore.visibility = View.GONE
                        return@onSuccess
                    }
                    tvEmpty.visibility = View.GONE
                    resp.transactions.forEach { txn ->
                        container.addView(buildTxnRow(txn))
                    }
                    tvLoadMore.visibility = if (resp.transactions.size < limit) View.GONE else View.VISIBLE
                }
                .onFailure { tvEmpty.text = "Could not load transactions" }
        }
    }

    private fun buildTxnRow(txn: Transaction): View {
        val tv = TextView(requireContext()).apply {
            val amountKsh = "%.2f".format(txn.amountCents / 100.0)
            val statusIcon = when (txn.status) {
                "CONFIRMED" -> "✓"
                "DECLINED"  -> "✗"
                "FAILED"    -> "!"
                else        -> "…"
            }
            text = "$statusIcon  KSh $amountKsh — ${txn.merchantName}\n" +
                   "    ${txn.source.lowercase().replace('_', ' ')} · ${txn.createdAt.take(10)}" +
                   (if (!txn.mpesaReceipt.isNullOrBlank()) "\n    Ref: ${txn.mpesaReceipt}" else "")
            setPadding(32, 24, 32, 24)
            textSize = 14f
        }
        return tv
    }
}
