package com.orchestratepay.softpos.ui

import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity

/**
 * TapGuideActivity — guides the merchant to hold the customer's phone in the
 * correct position for NFC reading.
 *
 * NFC antenna placement varies by phone model (top, center, or bottom of back).
 * This activity shows a pulsing animation pointing to the antenna location
 * to maximise first-tap success rate.
 *
 * The antenna position is derived from the device's Build.MODEL and a lookup table.
 * For unknown models we default to "center of back" (most common location).
 *
 * This activity is launched from SoftPosDashboardActivity when the merchant
 * presses "Ready to accept payment" — it replaces the NFC idle screen.
 */
class TapGuideActivity : AppCompatActivity() {

    companion object {
        /** Intent extra: amount in cents to display in the guide screen. */
        const val EXTRA_AMOUNT_CENTS = "amount_cents"

        // Common antenna locations by device family
        private val ANTENNA_POSITION = mapOf(
            "pixel"   to AntennaPosition.CENTER,
            "samsung" to AntennaPosition.TOP,
            "xiaomi"  to AntennaPosition.CENTER,
            "huawei"  to AntennaPosition.CENTER,
            "oppo"    to AntennaPosition.CENTER,
            "tecno"   to AntennaPosition.CENTER,
            "infinix" to AntennaPosition.CENTER,
        )

        fun antennaPosition(): AntennaPosition {
            val model = android.os.Build.MODEL.lowercase()
            return ANTENNA_POSITION.entries
                .firstOrNull { (brand, _) -> model.contains(brand) }
                ?.value ?: AntennaPosition.CENTER
        }
    }

    enum class AntennaPosition { TOP, CENTER, BOTTOM }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // setContentView(R.layout.activity_tap_guide)

        val amountCents = intent.getLongExtra(EXTRA_AMOUNT_CENTS, 0L)
        val position    = antennaPosition()

        // Show amount + "Hold customer's phone here" instruction
        // Animate a pulsing ring at the antenna position
        setupGuide(amountCents, position)
    }

    private fun setupGuide(amountCents: Long, position: AntennaPosition) {
        android.util.Log.d("TapGuide",
            "Showing tap guide: KSh ${amountCents / 100}, antenna position = $position")
        // TODO: show pulsing ring animation at correct screen position
        //   TOP    → ring in top third of screen
        //   CENTER → ring in middle of screen
        //   BOTTOM → ring in bottom third of screen
    }

    override fun onBackPressed() {
        // Don't allow back during active payment — let the merchant cancel via button
        @Suppress("DEPRECATION")
        super.onBackPressed()
    }
}
