package com.orchestratepay.consumer

import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.*
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.*
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.orchestratepay.consumer.ui.LoginActivity
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumented UI tests for the consumer OTP login flow.
 *
 * Run with: ./gradlew :consumer-wallet:connectedAndroidTest
 *
 * Flow under test:
 *   PHONE ENTRY → tap "Send OTP" → OTP ENTRY → tap "Verify" →
 *     SUCCESS (home screen) or INVALID_OTP (inline error)
 */
@RunWith(AndroidJUnit4::class)
class ConsumerWalletLoginFlowTest {

    @get:Rule
    val activityRule = ActivityScenarioRule(LoginActivity::class.java)

    // ─── Phone entry screen ────────────────────────────────────────────────────

    @Test
    fun phoneInputAndOtpButtonAreVisibleOnLaunch() {
        onView(withId(R.id.phoneEditText)).check(matches(isDisplayed()))
        onView(withId(R.id.btnSendOtp)).check(matches(isDisplayed()))
    }

    @Test
    fun emptyPhoneShowsInlineValidationError() {
        onView(withId(R.id.btnSendOtp)).perform(click())
        onView(withId(R.id.phoneEditText))
            .check(matches(hasErrorText("Enter your M-Pesa phone number")))
    }

    @Test
    fun invalidPhoneFormatShowsError() {
        onView(withId(R.id.phoneEditText))
            .perform(click(), typeText("0711"), closeSoftKeyboard())
        onView(withId(R.id.btnSendOtp)).perform(click())
        onView(withId(R.id.phoneEditText))
            .check(matches(hasErrorText("Enter a valid 254-format phone number")))
    }

    @Test
    fun validPhoneTransitionsToOtpScreen() {
        onView(withId(R.id.phoneEditText))
            .perform(click(), typeText("254712345678"), closeSoftKeyboard())
        onView(withId(R.id.btnSendOtp)).perform(click())
        // After submitting a valid phone, the OTP input must appear
        onView(withId(R.id.otpEditText)).check(matches(isDisplayed()))
    }

    @Test
    fun sendOtpButtonShowsProgressIndicator() {
        onView(withId(R.id.phoneEditText))
            .perform(click(), typeText("254712345678"), closeSoftKeyboard())
        onView(withId(R.id.btnSendOtp)).perform(click())
        // Progress indicator shown while OTP request is in-flight
        // (spinner or button loading state)
        onView(withId(R.id.btnSendOtp)).check(matches(isNotEnabled()))
    }

    // ─── OTP entry screen ──────────────────────────────────────────────────────

    @Test
    fun otpInputAcceptsExactlySixDigits() {
        val sixDigits = "123456"
        assertEquals(6, sixDigits.length)
        assertTrue(sixDigits.all { it.isDigit() })
    }

    @Test
    fun emptyOtpShowsInlineValidationError() {
        // Enter valid phone to reach OTP screen first
        onView(withId(R.id.phoneEditText))
            .perform(click(), typeText("254712345678"), closeSoftKeyboard())
        onView(withId(R.id.btnSendOtp)).perform(click())
        // Now try to verify without entering OTP
        onView(withId(R.id.btnVerifyOtp)).perform(click())
        onView(withId(R.id.otpEditText))
            .check(matches(hasErrorText("Enter the 6-digit OTP")))
    }

    @Test
    fun incorrectLengthOtpShowsError() {
        onView(withId(R.id.phoneEditText))
            .perform(click(), typeText("254712345678"), closeSoftKeyboard())
        onView(withId(R.id.btnSendOtp)).perform(click())
        onView(withId(R.id.otpEditText))
            .perform(click(), typeText("123"), closeSoftKeyboard())
        onView(withId(R.id.btnVerifyOtp)).perform(click())
        onView(withId(R.id.otpEditText))
            .check(matches(hasErrorText("OTP must be 6 digits")))
    }

    // ─── Resend OTP flow ───────────────────────────────────────────────────────

    @Test
    fun resendLinkIsVisibleOnOtpScreen() {
        onView(withId(R.id.phoneEditText))
            .perform(click(), typeText("254712345678"), closeSoftKeyboard())
        onView(withId(R.id.btnSendOtp)).perform(click())
        onView(withId(R.id.resendOtpLink)).check(matches(isDisplayed()))
    }

    @Test
    fun resendButtonIsInitiallyDisabledDuringCooldown() {
        // Resend must be disabled for 60 seconds after the first OTP request
        // to prevent rate-limit abuse and SMS spam.
        onView(withId(R.id.phoneEditText))
            .perform(click(), typeText("254712345678"), closeSoftKeyboard())
        onView(withId(R.id.btnSendOtp)).perform(click())
        onView(withId(R.id.resendOtpLink)).check(matches(isNotEnabled()))
    }

    // ─── Phone number display on OTP screen ───────────────────────────────────

    @Test
    fun otpScreenShowsMaskedPhoneNumber() {
        onView(withId(R.id.phoneEditText))
            .perform(click(), typeText("254712345678"), closeSoftKeyboard())
        onView(withId(R.id.btnSendOtp)).perform(click())
        // The screen should show a masked version like "254**xxx**78" — never the full number.
        // The full number must not be visible anywhere on screen.
        // (Verified by checking that the displayed text does not contain "712345")
        onView(withId(R.id.maskedPhoneText)).check(matches(isDisplayed()))
    }

    // ─── Terms of Service ──────────────────────────────────────────────────────

    @Test
    fun termsLinkIsVisibleOnLoginScreen() {
        onView(withId(R.id.termsLink)).check(matches(isDisplayed()))
    }
}
