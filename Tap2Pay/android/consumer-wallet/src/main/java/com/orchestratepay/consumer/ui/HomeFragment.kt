package com.orchestratepay.consumer.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.orchestratepay.consumer.R
import com.orchestratepay.consumer.api.Transaction
import com.orchestratepay.consumer.db.ConsumerSessionManager
import com.orchestratepay.consumer.ui.viewmodel.HomeViewModel
import kotlinx.coroutines.launch

class HomeFragment : Fragment() {

    private val viewModel: HomeViewModel by viewModels()

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View? =
        inflater.inflate(R.layout.fragment_home, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        val tvGreeting    = view.findViewById<TextView>(R.id.tv_greeting)
        val tvUserName    = view.findViewById<TextView>(R.id.tv_user_name)
        val tvPoints      = view.findViewById<TextView>(R.id.tv_loyalty_points)
        val tvRecentLabel = view.findViewById<TextView>(R.id.tv_recent_label)
        val tvTxn1        = view.findViewById<TextView>(R.id.tv_txn_1)
        val tvTxn2        = view.findViewById<TextView>(R.id.tv_txn_2)
        val tvTxn3        = view.findViewById<TextView>(R.id.tv_txn_3)

        val name = ConsumerSessionManager.getDisplayName() ?: "there"
        tvGreeting.text = "Welcome back,"
        tvUserName.text = name

        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.state.collect { state ->
                    tvPoints.text = "${state.totalPoints} pts"
                    
                    val txns = state.recentTransactions
                    listOf(tvTxn1, tvTxn2, tvTxn3).forEachIndexed { i, tv ->
                        if (i < txns.size) {
                            tv.text = formatTxn(txns[i])
                            tv.visibility = View.VISIBLE
                        } else {
                            tv.visibility = View.GONE
                        }
                    }
                    
                    if (txns.isEmpty() && !state.isLoadingTransactions) {
                        tvRecentLabel.text = "No recent transactions"
                    } else {
                        tvRecentLabel.text = "Recent Transactions"
                    }
                }
            }
        }

        viewModel.loadData()
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
