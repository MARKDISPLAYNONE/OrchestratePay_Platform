package com.orchestratepay.consumer.ui

import android.nfc.NfcAdapter
import android.os.Bundle
import android.os.CountDownTimer
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TabLayout
import android.widget.TextView
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.orchestratepay.consumer.R
import com.orchestratepay.consumer.payment.QrTokenManager
import kotlinx.coroutines.launch

/**
 * TapToPayFragment — dual-mode payment initiation screen.
 *
 * TAP tab (HCE):
 *   Shows NFC status. When NFC is on and ConsumerHceService is running, the
 *   consumer just holds their phone near any OrchestratePay terminal — no button tap.
 *   The OS routes the terminal's SELECT AID to ConsumerHceService automatically.
 *
 * QR tab:
 *   Displays the consumer's short-lived QR code (from QrTokenManager).
 *   The merchant's Sunmi terminal or SoftPOS scans it and initiates the transaction.
 *   A countdown timer shows time until the QR expires; it auto-refreshes.
 */
class TapToPayFragment : Fragment() {

    private val qrManager = QrTokenManager()
    private var countdownTimer: CountDownTimer? = null

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
                    1 -> { nfcSection.visibility = View.GONE;    qrSection.visibility = View.VISIBLE; loadQr(ivQrCode, tvCountdown) }
                }
            }
            override fun onTabUnselected(tab: TabLayout.Tab) {}
            override fun onTabReselected(tab: TabLayout.Tab) {}
        })

        // Start on NFC tab
        nfcSection.visibility = View.VISIBLE
        qrSection.visibility  = View.GONE
    }

    private fun loadQr(ivQrCode: ImageView, tvCountdown: TextView) {
        tvCountdown.text = getString(R.string.qr_refreshing)
        lifecycleScope.launch {
            runCatching { qrManager.getQrState() }
                .onSuccess { state ->
                    ivQrCode.setImageBitmap(state.bitmap)
                    startCountdown(state.expiresAt, tvCountdown)
                }
                .onFailure { tvCountdown.text = "Could not load QR — tap to retry" }
        }
    }

    private fun startCountdown(expiresAt: Long, tvCountdown: TextView) {
        countdownTimer?.cancel()
        val remaining = expiresAt - System.currentTimeMillis()
        countdownTimer = object : CountDownTimer(remaining, 1_000) {
            override fun onTick(millisUntilFinished: Long) {
                tvCountdown.text = getString(R.string.qr_expires_in, millisUntilFinished / 1000)
            }
            override fun onFinish() {
                tvCountdown.text = getString(R.string.qr_refreshing)
                // QrTokenManager auto-refreshes; just reload the view
                loadQr(tvCountdown.rootView.findViewById(R.id.iv_qr_code), tvCountdown)
            }
        }.start()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        countdownTimer?.cancel()
        qrManager.cancel()
    }
}
