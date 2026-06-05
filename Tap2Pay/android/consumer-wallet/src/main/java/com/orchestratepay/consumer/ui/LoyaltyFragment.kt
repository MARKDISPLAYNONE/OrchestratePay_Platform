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
import com.orchestratepay.consumer.api.LoyaltyBalance
import kotlinx.coroutines.launch

class LoyaltyFragment : Fragment() {

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View? =
        inflater.inflate(R.layout.fragment_loyalty, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        val listContainer = view.findViewById<LinearLayout>(R.id.list_container)
        val tvEmpty       = view.findViewById<TextView>(R.id.tv_empty)

        lifecycleScope.launch {
            runCatching { ConsumerApiClient.getLoyalty() }
                .onSuccess { resp ->
                    if (resp.balances.isEmpty()) {
                        tvEmpty.visibility = View.VISIBLE
                        return@onSuccess
                    }
                    tvEmpty.visibility = View.GONE
                    resp.balances.forEach { bal ->
                        listContainer.addView(buildBalanceCard(bal))
                    }
                }
                .onFailure { tvEmpty.text = "Could not load loyalty balances" }
        }
    }

    private fun buildBalanceCard(bal: LoyaltyBalance): View {
        return TextView(requireContext()).apply {
            val rewardLine = when (bal.rewardType) {
                "POINTS" -> "${bal.pointsBalance} pts (${bal.lifetimePoints} lifetime)"
                "STAMPS" -> "${bal.stampsBalance} stamps"
                else     -> "${bal.pointsBalance} pts · ${bal.stampsBalance} stamps"
            }
            val thresholdLine = bal.redeemThreshold?.let {
                "\n    Redeem at $it ${if (bal.rewardType == "STAMPS") "stamps" else "pts"}"
            } ?: ""
            text = "🏪  ${bal.merchantName}\n    $rewardLine$thresholdLine"
            setPadding(32, 28, 32, 28)
            textSize = 14f
        }
    }
}
