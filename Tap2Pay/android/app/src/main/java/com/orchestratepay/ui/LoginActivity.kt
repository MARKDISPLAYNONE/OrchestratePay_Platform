package com.orchestratepay.ui

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.orchestratepay.api.ApiResponse
import com.orchestratepay.api.OrchestrateApiClient
import com.orchestratepay.db.SessionManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * LoginActivity — authenticates the merchant and stores the JWT token.
 *
 * This is the first screen launched (see AndroidManifest.xml).
 * If SessionManager.isLoggedIn() is true, we skip directly to the dashboard.
 *
 * DEVICE ID: We send the Android Device ID (ANDROID_ID) as a machine identifier.
 * The backend uses this to enforce single-device sessions — if a merchant's
 * credentials are used on a different device, the backend invalidates the previous
 * session. This is important for MDM (Mobile Device Management) compliance.
 *
 * PRODUCTION NOTE: In production, replace ANDROID_ID with an MDM-provided
 * device certificate for stronger device attestation.
 */
class LoginActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // setContentView(R.layout.activity_login)

        SessionManager.init(this)

        // Skip login screen if already authenticated
        if (SessionManager.isLoggedIn()) {
            navigateToDashboard()
            return
        }

        // binding.loginButton.setOnClickListener { attemptLogin() }
    }

    private fun attemptLogin() {
        // val email = binding.emailInput.text.toString().trim()
        // val password = binding.passwordInput.text.toString()
        val email = ""      // replace with binding values
        val password = ""   // replace with binding values

        if (email.isBlank() || password.isBlank()) {
            // showError("Email and password are required")
            return
        }

        // ANDROID_ID: unique per app+device combination.
        // Changes on factory reset, which is fine — merchant re-logs in.
        val deviceId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)

        // setLoading(true)

        lifecycleScope.launch {
            // setLoading(true)
            when (withContext(Dispatchers.IO) {
                OrchestrateApiClient.current.login(email, password, deviceId)
                // login() now saves the session internally — no need to call
                // SessionManager.saveSession() here
            }) {
                is ApiResponse.Success -> navigateToDashboard()
                is ApiResponse.Declined -> {
                    // setLoading(false)
                    // showError("Invalid credentials")
                }
                is ApiResponse.NetworkError -> {
                    // setLoading(false)
                    // showError("No network — check your connection")
                }
                else -> {
                    // setLoading(false)
                    // showError("Login failed — please try again")
                }
            }
        }
    }

    private fun navigateToDashboard() {
        startActivity(Intent(this, MerchantDashboardActivity::class.java))
        finish()  // removes LoginActivity from back stack — back button won't go back here
    }
}
