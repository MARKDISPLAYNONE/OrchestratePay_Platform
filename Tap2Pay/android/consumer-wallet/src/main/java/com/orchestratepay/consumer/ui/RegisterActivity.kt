package com.orchestratepay.consumer.ui

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.orchestratepay.consumer.R
import com.orchestratepay.consumer.api.ConsumerApiClient
import com.orchestratepay.consumer.db.ConsumerSessionManager
import com.orchestratepay.consumer.realtime.ConsumerWebSocketClient
import kotlinx.coroutines.launch

class RegisterActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_register)

        val emailField    = findViewById<EditText>(R.id.et_email)
        val passwordField = findViewById<EditText>(R.id.et_password)
        val phoneField    = findViewById<EditText>(R.id.et_phone)
        val registerBtn   = findViewById<Button>(R.id.btn_register)
        val progressView  = findViewById<View>(R.id.progress)

        registerBtn.setOnClickListener {
            val email    = emailField.text.toString().trim()
            val password = passwordField.text.toString()
            val phone    = phoneField.text.toString().trim()

            if (email.isBlank() || password.length < 8 || phone.isBlank()) {
                Toast.makeText(this, "All fields required. Password must be at least 8 characters.", Toast.LENGTH_LONG).show()
                return@setOnClickListener
            }
            if (!phone.matches(Regex("^254[0-9]{9}$"))) {
                Toast.makeText(this, "Phone must be in format 254XXXXXXXXX", Toast.LENGTH_LONG).show()
                return@setOnClickListener
            }

            progressView.visibility = View.VISIBLE
            registerBtn.isEnabled   = false

            lifecycleScope.launch {
                runCatching { ConsumerApiClient.register(email, password, phone) }
                    .onSuccess { auth ->
                        ConsumerSessionManager.saveSession(
                            token       = auth.token,
                            consumerId  = auth.consumerId,
                            phone       = auth.phone,
                            displayName = auth.displayName,
                            expiresAt   = auth.expiresAt
                        )
                        ConsumerSessionManager.getFcmToken()?.let { fcm ->
                            runCatching { ConsumerApiClient.updateFcmToken(fcm) }
                        }
                        ConsumerWebSocketClient.shared?.connect()
                        startActivity(Intent(this@RegisterActivity, HomeActivity::class.java))
                        finishAffinity()
                    }
                    .onFailure { err ->
                        progressView.visibility = View.GONE
                        registerBtn.isEnabled   = true
                        Toast.makeText(this@RegisterActivity, err.message ?: "Registration failed", Toast.LENGTH_LONG).show()
                    }
            }
        }
    }
}
