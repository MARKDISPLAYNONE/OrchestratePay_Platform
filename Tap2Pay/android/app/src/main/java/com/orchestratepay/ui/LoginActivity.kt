package com.orchestratepay.ui

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.orchestratepay.api.ApiResponse
import com.orchestratepay.api.OrchestrateApiClient
import com.orchestratepay.databinding.ActivityLoginBinding
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
 */
class LoginActivity : AppCompatActivity() {

    private lateinit var binding: ActivityLoginBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(binding.root)

        SessionManager.init(this)

        if (SessionManager.isLoggedIn()) {
            navigateToDashboard()
            return
        }

        binding.btnSignIn.setOnClickListener { attemptLogin() }
    }

    private fun attemptLogin() {
        val email    = binding.etEmail.text.toString().trim()
        val password = binding.etPassword.text.toString()

        if (email.isBlank() || password.isBlank()) {
            showError(getString(com.orchestratepay.R.string.error_fields_required))
            return
        }

        // ANDROID_ID: unique per app+device combination; saved so telemetry can read it
        val deviceId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
        SessionManager.saveDeviceId(deviceId)

        setLoading(true)

        lifecycleScope.launch {
            when (withContext(Dispatchers.IO) {
                OrchestrateApiClient.current.login(email, password, deviceId)
            }) {
                is ApiResponse.Success  -> navigateToDashboard()
                is ApiResponse.Declined -> {
                    setLoading(false)
                    showError(getString(com.orchestratepay.R.string.error_login_failed))
                }
                is ApiResponse.NetworkError -> {
                    setLoading(false)
                    showError(getString(com.orchestratepay.R.string.error_no_network))
                }
                else -> {
                    setLoading(false)
                    showError(getString(com.orchestratepay.R.string.error_login_failed))
                }
            }
        }
    }

    private fun setLoading(loading: Boolean) {
        binding.btnSignIn.isEnabled = !loading
        binding.btnSignIn.text = if (loading)
            getString(com.orchestratepay.R.string.signing_in)
        else
            getString(com.orchestratepay.R.string.btn_sign_in)
        binding.progressBar.visibility = if (loading) View.VISIBLE else View.GONE
    }

    private fun showError(message: String) {
        binding.tvError.text    = message
        binding.tvError.visibility = View.VISIBLE
    }

    private fun navigateToDashboard() {
        startActivity(Intent(this, MerchantDashboardActivity::class.java))
        finish()
    }
}
