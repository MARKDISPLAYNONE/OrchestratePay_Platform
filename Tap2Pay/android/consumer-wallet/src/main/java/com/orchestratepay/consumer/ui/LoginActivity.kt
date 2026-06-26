package com.orchestratepay.consumer.ui

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.orchestratepay.consumer.R
import com.orchestratepay.consumer.db.ConsumerSessionManager
import com.orchestratepay.consumer.ui.viewmodel.LoginState
import com.orchestratepay.consumer.ui.viewmodel.LoginViewModel
import kotlinx.coroutines.launch

class LoginActivity : AppCompatActivity() {

    private val viewModel: LoginViewModel by viewModels()

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
        val signInBtn     = findViewById<Button>(R.id.btn_login)
        val registerLink  = findViewById<TextView>(R.id.tv_register)
        val progressView  = findViewById<View>(R.id.progress_bar)

        signInBtn.setOnClickListener {
            val email    = emailField.text.toString().trim()
            val password = passwordField.text.toString()
            viewModel.login(email, password)
        }

        registerLink.setOnClickListener {
            startActivity(Intent(this, RegisterActivity::class.java))
        }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.state.collect { state ->
                    when (state) {
                        is LoginState.Idle -> {
                            progressView.visibility = View.GONE
                            signInBtn.isEnabled = true
                        }
                        is LoginState.Loading -> {
                            progressView.visibility = View.VISIBLE
                            signInBtn.isEnabled = false
                        }
                        is LoginState.Success -> {
                            startHome()
                        }
                        is LoginState.Error -> {
                            progressView.visibility = View.GONE
                            signInBtn.isEnabled = true
                            Toast.makeText(this@LoginActivity, state.message, Toast.LENGTH_LONG).show()
                        }
                    }
                }
            }
        }
    }

    private fun startHome() {
        startActivity(Intent(this, HomeActivity::class.java))
        finish()
    }
}
