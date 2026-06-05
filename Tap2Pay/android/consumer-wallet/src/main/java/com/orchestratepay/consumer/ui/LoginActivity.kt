package com.orchestratepay.consumer.ui

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.orchestratepay.consumer.R
import com.orchestratepay.consumer.api.ConsumerApiClient
import com.orchestratepay.consumer.api.ConsumerApiClient.login
import com.orchestratepay.consumer.db.ConsumerSessionManager
import com.orchestratepay.consumer.realtime.ConsumerWebSocketClient
import kotlinx.coroutines.launch

class LoginActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Already logged in — skip straight to home
        if (ConsumerSessionManager.isLoggedIn()) {
            startHome()
            return
        }

        setContentView(R.layout.activity_login)

        val emailField    = findViewById<EditText>(R.id.et_email)
        val passwordField = findViewById<EditText>(R.id.et_password)
        val signInBtn     = findViewById<Button>(R.id.btn_sign_in)
        val registerLink  = findViewById<TextView>(R.id.tv_register)
        val progressView  = findViewById<View>(R.id.progress)

        signInBtn.setOnClickListener {
            val email    = emailField.text.toString().trim()
            val password = passwordField.text.toString()

            if (email.isBlank() || password.isBlank()) {
                Toast.makeText(this, "Email and password are required", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            progressView.visibility = View.VISIBLE
            signInBtn.isEnabled     = false

            lifecycleScope.launch {
                runCatching { ConsumerApiClient.login(email, password) }
                    .onSuccess { auth ->
                        ConsumerSessionManager.saveSession(
                            token       = auth.token,
                            consumerId  = auth.consumerId,
                            phone       = auth.phone,
                            displayName = auth.displayName,
                            expiresAt   = auth.expiresAt
                        )
                        // Persist FCM token to backend now that we have a valid JWT
                        ConsumerSessionManager.getFcmToken()?.let { fcm ->
                            runCatching { ConsumerApiClient.updateFcmToken(fcm) }
                        }
                        ConsumerWebSocketClient.shared?.connect()
                        startHome()
                    }
                    .onFailure { err ->
                        progressView.visibility = View.GONE
                        signInBtn.isEnabled     = true
                        Toast.makeText(this@LoginActivity, err.message ?: "Login failed", Toast.LENGTH_LONG).show()
                    }
            }
        }

        registerLink.setOnClickListener {
            startActivity(Intent(this, RegisterActivity::class.java))
        }
    }

    private fun startHome() {
        startActivity(Intent(this, HomeActivity::class.java))
        finish()
    }
}
