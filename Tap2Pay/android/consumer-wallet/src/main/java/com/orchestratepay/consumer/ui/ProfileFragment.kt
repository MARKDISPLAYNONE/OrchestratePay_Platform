package com.orchestratepay.consumer.ui

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.orchestratepay.consumer.R
import com.orchestratepay.consumer.api.ConsumerApiClient
import com.orchestratepay.consumer.db.ConsumerSessionManager
import com.orchestratepay.consumer.nfc.ConsumerTagWriterActivity
import com.orchestratepay.consumer.realtime.ConsumerWebSocketClient
import kotlinx.coroutines.launch

class ProfileFragment : Fragment() {

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View? =
        inflater.inflate(R.layout.fragment_profile, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        val tvPhone      = view.findViewById<TextView>(R.id.tv_phone)
        val etName       = view.findViewById<EditText>(R.id.et_display_name)
        val switchSms    = view.findViewById<Switch>(R.id.switch_sms_opt_in)
        val btnSave      = view.findViewById<Button>(R.id.btn_save)
        val btnProgramTag = view.findViewById<Button>(R.id.btn_program_tag)
        val btnLogout    = view.findViewById<Button>(R.id.btn_logout)

        // Pre-populate from local session
        tvPhone.text = ConsumerSessionManager.getPhone() ?: ""
        etName.setText(ConsumerSessionManager.getDisplayName() ?: "")

        // Load full profile from server for sms_opt_in
        lifecycleScope.launch {
            runCatching { ConsumerApiClient.getProfile() }
                .onSuccess { profile ->
                    etName.setText(profile.displayName ?: "")
                    switchSms.isChecked = profile.smsOptIn
                }
        }

        btnSave.setOnClickListener {
            val newName    = etName.text.toString().trim().takeIf { it.isNotBlank() }
            val newSmsOptIn = switchSms.isChecked
            lifecycleScope.launch {
                runCatching { ConsumerApiClient.updateProfile(newName, newSmsOptIn) }
                    .onSuccess { Toast.makeText(requireContext(), "Profile updated", Toast.LENGTH_SHORT).show() }
                    .onFailure { Toast.makeText(requireContext(), "Could not save — try again", Toast.LENGTH_SHORT).show() }
            }
        }

        btnProgramTag.setOnClickListener {
            startActivity(Intent(requireContext(), ConsumerTagWriterActivity::class.java))
        }

        btnLogout.setOnClickListener {
            ConsumerWebSocketClient.shared?.disconnect()
            ConsumerSessionManager.clearSession()
            startActivity(Intent(requireContext(), LoginActivity::class.java))
            requireActivity().finishAffinity()
        }
    }
}
