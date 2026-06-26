package com.orchestratepay.consumer.ui

import android.nfc.NfcAdapter
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.google.android.material.tabs.TabLayout
import com.orchestratepay.consumer.R
import com.orchestratepay.consumer.ui.viewmodel.TapToPayViewModel
import kotlinx.coroutines.launch

class TapToPayFragment : Fragment() {

    private val viewModel: TapToPayViewModel by viewModels()

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View? =
        inflater.inflate(R.layout.fragment_tap_to_pay, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        val tabLayout   = view.findViewById<TabLayout>(R.id.tab_layout)
        val nfcSection  = view.findViewById<View>(R.id.section_nfc)
        val qrSection   = view.findViewById<View>(R.id.section_qr)
        val tvNfcStatus = view.findViewById<TextView>(R.id.tv_nfc_status)
        val ivQrCode    = view.findViewById<ImageView>(R.id.iv_qr_code)
        val tvCountdown = view.findViewById<TextView>(R.id.tv_countdown)

        // NFC status
        val nfcEnabled = NfcAdapter.getDefaultAdapter(requireContext())?.isEnabled == true
        tvNfcStatus.text = if (nfcEnabled)
            getString(R.string.nfc_ready)
        else
            getString(R.string.nfc_disabled)

        // Tab switching
        tabLayout.addOnTabSelectedListener(object : TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: TabLayout.Tab) {
                when (tab.position) {
                    0 -> { nfcSection.visibility = View.VISIBLE; qrSection.visibility = View.GONE }
                    1 -> {
                        nfcSection.visibility = View.GONE
                        qrSection.visibility = View.VISIBLE
                        viewModel.loadQr()
                    }
                }
            }
            override fun onTabUnselected(tab: TabLayout.Tab) {}
            override fun onTabReselected(tab: TabLayout.Tab) {}
        })

        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.state.collect { state ->
                    if (state.qrBitmap != null) {
                        ivQrCode.setImageBitmap(state.qrBitmap)
                    }
                    
                    if (state.isLoadingQr) {
                        tvCountdown.text = getString(R.string.qr_refreshing)
                    } else if (state.qrError != null) {
                        tvCountdown.text = state.qrError
                    } else {
                        tvCountdown.text = getString(R.string.qr_expires_in, state.secondsRemaining)
                    }
                }
            }
        }
    }
}
