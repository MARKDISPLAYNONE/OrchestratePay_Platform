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
import com.orchestratepay.consumer.api.LoyaltyBalance
import com.orchestratepay.consumer.ui.viewmodel.LoyaltyViewModel
import kotlinx.coroutines.launch

class LoyaltyFragment : Fragment() {

    private val viewModel: LoyaltyViewModel by viewModels()

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View? =
        inflater.inflate(R.layout.fragment_loyalty, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        val listContainer = view.findViewById<LinearLayout>(R.id.list_container)
        val tvEmpty       = view.findViewById<TextView>(R.id.tv_empty)

        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.state.collect { state ->
                    listContainer.removeAllViews()
                    if (state.balances.isEmpty() && !state.isLoading) {
                        tvEmpty.visibility = View.VISIBLE
                        tvEmpty.text = state.error ?: "No loyalty programs joined yet"
                    } else {
                        tvEmpty.visibility = View.GONE
                        state.balances.forEach { bal ->
                            listContainer.addView(buildBalanceCard(bal))
                        }
                    }
                    
                    state.redemptionSuccess?.let {
                        Toast.makeText(context, it, Toast.LENGTH_SHORT).show()
                        viewModel.clearRedemptionState()
                    }
                }
            }
        }
        
        viewModel.loadLoyalty()
    }

    private fun buildBalanceCard(bal: LoyaltyBalance): View {
        val root = LinearLayout(requireContext()).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 28, 32, 28)
        }
        
        val tvInfo = TextView(requireContext()).apply {
            val rewardLine = when (bal.rewardType) {
                "POINTS" -> "${bal.pointsBalance} pts (${bal.lifetimePoints} lifetime)"
                "STAMPS" -> "${bal.stampsBalance} stamps"
                else     -> "${bal.pointsBalance} pts · ${bal.stampsBalance} stamps"
            }
            val thresholdLine = bal.redeemThreshold?.let {
                "\n    Redeem at $it ${if (bal.rewardType == "STAMPS") "stamps" else "pts"}"
            } ?: ""
            text = "🏪  ${bal.merchantName}\n    $rewardLine$thresholdLine"
            textSize = 14f
        }
        root.addView(tvInfo)
        
        val canRedeem = bal.redeemThreshold != null && 
                        (bal.pointsBalance >= bal.redeemThreshold || bal.stampsBalance >= bal.redeemThreshold)
        
        if (canRedeem) {
            val btnRedeem = MaterialButton(requireContext(), null, com.google.android.material.R.attr.materialButtonStyle).apply {
                text = "Redeem Reward"
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { topMargin = 16 }
                setOnClickListener {
                    viewModel.redeem(bal.merchantId, "auto_reward")
                }
            }
            root.addView(btnRedeem)
        }
        
        return root
    }
}
