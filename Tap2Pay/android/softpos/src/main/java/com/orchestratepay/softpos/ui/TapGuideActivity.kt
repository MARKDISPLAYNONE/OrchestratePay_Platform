package com.orchestratepay.softpos.ui

import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.os.Bundle
import android.view.animation.AccelerateDecelerateInterpolator
import androidx.appcompat.app.AppCompatActivity
import com.orchestratepay.softpos.databinding.ActivityTapGuideBinding

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
 */
class TapGuideActivity : AppCompatActivity() {

    private lateinit var binding: ActivityTapGuideBinding

    companion object {
        const val EXTRA_AMOUNT_CENTS = "amount_cents"

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
        binding = ActivityTapGuideBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val amountCents = intent.getLongExtra(EXTRA_AMOUNT_CENTS, 0L)
        val position    = antennaPosition()

        setupGuide(amountCents, position)

        binding.btnCancel.setOnClickListener { finish() }
    }

    private fun setupGuide(amountCents: Long, position: AntennaPosition) {
        binding.tvAmount.text = "KSh ${"%.2f".format(amountCents / 100.0)}"

        // Translate the ring container to the correct third of the screen.
        // ConstraintLayout centers it by default (CENTER = no offset).
        val screenHeight = resources.displayMetrics.heightPixels.toFloat()
        binding.ringContainer.translationY = when (position) {
            AntennaPosition.TOP    -> -screenHeight * 0.25f
            AntennaPosition.CENTER -> 0f
            AntennaPosition.BOTTOM ->  screenHeight * 0.25f
        }

        startPulseAnimation()

        android.util.Log.d("TapGuide",
            "Tap guide: KSh ${amountCents / 100}, antenna=$position")
    }

    private fun startPulseAnimation() {
        val outerSet = AnimatorSet().apply {
            playTogether(
                ObjectAnimator.ofFloat(binding.ringOuter, "scaleX", 1f, 1.4f).apply {
                    repeatCount = ObjectAnimator.INFINITE
                },
                ObjectAnimator.ofFloat(binding.ringOuter, "scaleY", 1f, 1.4f).apply {
                    repeatCount = ObjectAnimator.INFINITE
                },
                ObjectAnimator.ofFloat(binding.ringOuter, "alpha", 0.5f, 0f).apply {
                    repeatCount = ObjectAnimator.INFINITE
                },
            )
            duration = 1200
            interpolator = AccelerateDecelerateInterpolator()
        }

        val innerSet = AnimatorSet().apply {
            playTogether(
                ObjectAnimator.ofFloat(binding.ringInner, "scaleX", 1f, 1.2f, 1f).apply {
                    repeatCount = ObjectAnimator.INFINITE
                },
                ObjectAnimator.ofFloat(binding.ringInner, "scaleY", 1f, 1.2f, 1f).apply {
                    repeatCount = ObjectAnimator.INFINITE
                },
                ObjectAnimator.ofFloat(binding.ringInner, "alpha", 0.7f, 0.3f, 0.7f).apply {
                    repeatCount = ObjectAnimator.INFINITE
                },
            )
            duration = 1200
            startDelay = 300
            interpolator = AccelerateDecelerateInterpolator()
        }

        AnimatorSet().apply {
            playTogether(outerSet, innerSet)
            start()
        }
    }

    override fun onBackPressed() {
        @Suppress("DEPRECATION")
        super.onBackPressed()
    }
}
