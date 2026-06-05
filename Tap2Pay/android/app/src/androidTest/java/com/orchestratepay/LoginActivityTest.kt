package com.orchestratepay

import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.*
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.*
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.orchestratepay.ui.LoginActivity
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumented UI tests for LoginActivity.
 * Requires a connected device or emulator: ./gradlew connectedAndroidTest
 */
@RunWith(AndroidJUnit4::class)
class LoginActivityTest {

    @get:Rule
    val activityRule = ActivityScenarioRule(LoginActivity::class.java)

    @Test
    fun loginScreenDisplaysEmailAndPasswordFields() {
        onView(withId(R.id.emailEditText)).check(matches(isDisplayed()))
        onView(withId(R.id.passwordEditText)).check(matches(isDisplayed()))
        onView(withId(R.id.loginButton)).check(matches(isDisplayed()))
    }

    @Test
    fun emptyEmailShowsValidationError() {
        onView(withId(R.id.loginButton)).perform(click())
        onView(withId(R.id.emailEditText)).check(matches(hasErrorText("Email is required")))
    }

    @Test
    fun invalidEmailShowsValidationError() {
        onView(withId(R.id.emailEditText)).perform(typeText("notanemail"), closeSoftKeyboard())
        onView(withId(R.id.loginButton)).perform(click())
        onView(withId(R.id.emailEditText)).check(matches(hasErrorText("Enter a valid email")))
    }
}
