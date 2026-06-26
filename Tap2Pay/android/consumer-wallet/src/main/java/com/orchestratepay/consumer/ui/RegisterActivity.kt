package com.orchestratepay.consumer.ui

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.orchestratepay.consumer.R
import com.orchestratepay.consumer.ui.viewmodel.RegisterState
import com.orchestratepay.consumer.ui.viewmodel.RegisterViewModel
import kotlinx.coroutines.launch

class RegisterActivity : AppCompatActivity() {

    private val viewModel: RegisterViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_register)

        val emailField    = findViewById<EditText>(R.id.et_email)
        val passwordField = findViewById<EditText>(R.id.et_password)
        val phoneField    = findViewById<EditText>(R.id.et_phone)
        val registerBtn   = findViewById<Button>(R.id.btn_register)
        val progressView  = findViewById<View>(R.id.progress_bar)

        registerBtn.setOnClickListener {
            val email    = emailField.text.toString().trim()
            val password = passwordField.text.toString()
            val phone    = phoneField.text.toString().trim()
            viewModel.register(email, password, phone)
        }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.state.collect { state ->
                    when (state) {
                        is RegisterState.Idle -> {
                            progressView.visibility = View.GONE
                            registerBtn.isEnabled = true
                        }
                        is RegisterState.Loading -> {
                            progressView.visibility = View.VISIBLE
                            registerBtn.isEnabled = false
                        }
                        is RegisterState.Success -> {
                            startActivity(Intent(this@RegisterActivity, HomeActivity::class.java))
                            finishAffinity()
                        }
                        is RegisterState.Error -> {
                            progressView.visibility = View.GONE
                            registerBtn.isEnabled = true
                            Toast.makeText(this@RegisterActivity, state.message, Toast.LENGTH_LONG).show()
                        }
                    }
                }
            }
        }
    }
}
