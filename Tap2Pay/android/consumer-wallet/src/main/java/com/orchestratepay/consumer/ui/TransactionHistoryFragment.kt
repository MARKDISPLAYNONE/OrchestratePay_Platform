package com.orchestratepay.consumer.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.google.android.material.button.MaterialButton
import com.orchestratepay.consumer.R
import com.orchestratepay.consumer.api.Transaction
import com.orchestratepay.consumer.ui.viewmodel.TransactionHistoryViewModel
import kotlinx.coroutines.launch

class TransactionHistoryFragment : Fragment() {

    private val viewModel: TransactionHistoryViewModel by viewModels()

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View? =
        inflater.inflate(R.layout.fragment_transaction_history, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        val listContainer = view.findViewById<LinearLayout>(R.id.list_container)
        val tvEmpty       = view.findViewById<TextView>(R.id.tv_empty)
        val tvLoadMore    = view.findViewById<TextView>(R.id.tv_load_more)

        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.state.collect { state ->
                    // Remove all except load more button
                    val loadMoreIndex = listContainer.indexOfChild(tvLoadMore)
                    for (i in loadMoreIndex - 1 downTo 0) {
                        listContainer.removeViewAt(i)
                    }
                    
                    if (state.transactions.isEmpty() && !state.isLoading) {
                        tvEmpty.visibility = View.VISIBLE
                        tvLoadMore.visibility = View.GONE
                    } else {
                        tvEmpty.visibility = View.GONE
                        state.transactions.forEach { txn ->
                            listContainer.addView(buildTxnRow(txn), listContainer.indexOfChild(tvLoadMore))
                        }
                        tvLoadMore.visibility = if (state.hasMore) View.VISIBLE else View.GONE
                    }
                    
                    state.disputeSuccess?.let {
                        Toast.makeText(context, it, Toast.LENGTH_SHORT).show()
                        viewModel.clearDisputeState()
                    }
                }
            }
        }

        tvLoadMore.setOnClickListener {
            viewModel.loadTransactions()
        }
        
        viewModel.loadTransactions(refresh = true)
    }

    private fun buildTxnRow(txn: Transaction): View {
        val root = LinearLayout(requireContext()).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 24, 32, 24)
        }
        
        val tvInfo = TextView(requireContext()).apply {
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
            textSize = 14f
        }
        root.addView(tvInfo)
        
        if (txn.status == "CONFIRMED") {
            val btnDispute = MaterialButton(requireContext(), null, com.google.android.material.R.attr.materialButtonStyle).apply {
                text = "Report Issue"
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { topMargin = 8 }
                setOnClickListener {
                    viewModel.fileDispute(txn.id, "User reported issue via app")
                }
            }
            root.addView(btnDispute)
        }
        
        return root
    }
}
