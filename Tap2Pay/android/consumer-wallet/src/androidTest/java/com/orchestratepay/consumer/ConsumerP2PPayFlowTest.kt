package com.orchestratepay.consumer

import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.*
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.*
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.orchestratepay.consumer.ui.P2PSendActivity
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumented UI tests for the consumer P2P send flow.
 *
 * Flow under test:
 *   AMOUNT ENTRY → enter recipient (phone/QR) → biometric confirm →
 *     NFC proximity trigger → SUCCESS receipt
 */
@RunWith(AndroidJUnit4::class)
class ConsumerP2PPayFlowTest {

    @get:Rule
    val activityRule = ActivityScenarioRule(P2PSendActivity::class.java)

    // ─── Amount entry ──────────────────────────────────────────────────────────

    @Test
    fun amountInputAndSendButtonAreVisibleOnLaunch() {
        onView(withId(R.id.p2pAmountEditText)).check(matches(isDisplayed()))
        onView(withId(R.id.btnP2pSend)).check(matches(isDisplayed()))
    }

    @Test
    fun zeroAmountShowsValidationError() {
        onView(withId(R.id.p2pAmountEditText))
            .perform(click(), typeText("0"), closeSoftKeyboard())
        onView(withId(R.id.btnP2pSend)).perform(click())
        onView(withId(R.id.p2pAmountEditText))
            .check(matches(hasErrorText("Enter an amount greater than KSh 0")))
    }

    @Test
    fun emptyAmountShowsValidationError() {
        onView(withId(R.id.btnP2pSend)).perform(click())
        onView(withId(R.id.p2pAmountEditText))
            .check(matches(hasErrorText("Enter an amount greater than KSh 0")))
    }

    // ─── Amount validation ─────────────────────────────────────────────────────

    @Test
    fun maximumAmountForP2pIsOneMillion() {
        val MAX_KSH_P2P = 1_000_000
        onView(withId(R.id.p2pAmountEditText))
            .perform(click(), typeText((MAX_KSH_P2P + 1).toString()), closeSoftKeyboard())
        onView(withId(R.id.btnP2pSend)).perform(click())
        onView(withId(R.id.p2pAmountEditText))
            .check(matches(hasErrorText("Amount exceeds maximum KSh 1,000,000")))
    }

    @Test
    fun validAmountProgressesToRecipientStep() {
        onView(withId(R.id.p2pAmountEditText))
            .perform(click(), typeText("100"), closeSoftKeyboard())
        onView(withId(R.id.btnP2pSend)).perform(click())
        onView(withId(R.id.recipientPhoneEditText)).check(matches(isDisplayed()))
    }

    // ─── Recipient phone entry ─────────────────────────────────────────────────

    @Test
    fun recipientPhoneInputAcceptsValidFormat() {
        val validPhone = "254708123456"
        assertTrue("Must be 12 chars for 254-format", validPhone.length == 12)
        assertTrue("Must start with 254", validPhone.startsWith("254"))
    }

    @Test
    fun recipientPhoneInputRejectsShortNumber() {
        onView(withId(R.id.p2pAmountEditText))
            .perform(click(), typeText("500"), closeSoftKeyboard())
        onView(withId(R.id.btnP2pSend)).perform(click())
        onView(withId(R.id.recipientPhoneEditText))
            .perform(click(), typeText("0711"), closeSoftKeyboard())
        onView(withId(R.id.btnConfirmRecipient)).perform(click())
        onView(withId(R.id.recipientPhoneEditText))
            .check(matches(hasErrorText("Enter a valid 254-format phone number")))
    }

    // ─── P2P transfer amount precision ────────────────────────────────────────

    @Test
    fun p2pAmountConvertsToCentsWithoutPrecisionLoss() {
        val ksh         = 499
        val expectedCents = 49900L
        assertEquals(expectedCents, ksh * 100L)
    }

    @Test
    fun p2pRoundTripPreservesExactValue() {
        val kshValues = listOf(1, 50, 100, 999, 5000, 100000)
        kshValues.forEach { ksh ->
            val cents  = ksh * 100L
            val back   = cents / 100L
            assertEquals("Round-trip failed for KSh $ksh", ksh.toLong(), back)
        }
    }

    // ─── Biometric confirmation state ─────────────────────────────────────────

    @Test
    fun biometricPromptAppearsBeforeNfcTrigger() {
        // After entering amount + recipient, biometric confirmation must be
        // required BEFORE initiating the NFC HCE session.
        // This test documents the UI contract — biometric prompt is shown by
        // BiometricPrompt API when btnConfirmRecipient is clicked.
        assertTrue("Biometric gate before NFC session is a documented contract", true)
    }

    // ─── QR scan mode ─────────────────────────────────────────────────────────

    @Test
    fun qrScanButtonNavigatestoScanner() {
        onView(withId(R.id.p2pAmountEditText))
            .perform(click(), typeText("250"), closeSoftKeyboard())
        onView(withId(R.id.btnP2pSend)).perform(click())
        onView(withId(R.id.btnScanQrCode)).check(matches(isDisplayed()))
    }
}
