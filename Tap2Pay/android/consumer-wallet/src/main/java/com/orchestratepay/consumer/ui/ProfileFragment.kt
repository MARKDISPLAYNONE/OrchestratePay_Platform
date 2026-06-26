package com.orchestratepay.consumer.ui

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.widget.SwitchCompat
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.orchestratepay.consumer.R
import com.orchestratepay.consumer.nfc.ConsumerTagWriterActivity
import com.orchestratepay.consumer.ui.viewmodel.ProfileViewModel
import kotlinx.coroutines.launch

class ProfileFragment : Fragment() {

    private val viewModel: ProfileViewModel by viewModels()

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View? =
        inflater.inflate(R.layout.fragment_profile, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        val tvPhone      = view.findViewById<TextView>(R.id.tv_phone)
        val etName       = view.findViewById<EditText>(R.id.et_display_name)
        val switchSms    = view.findViewById<SwitchCompat>(R.id.switch_sms_opt_in)
        val btnSave      = view.findViewById<Button>(R.id.btn_save)
        val btnProgramTag = view.findViewById<Button>(R.id.btn_program_tag)
        val btnLogout    = view.findViewById<Button>(R.id.btn_logout)

        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.state.collect { state ->
                    tvPhone.text = state.phone
                    if (!state.isSaving && !state.isLoading) {
                        if (etName.text.isEmpty()) etName.setText(state.displayName)
                        switchSms.isChecked = state.smsOptIn
                    }
                    
                    if (state.updateSuccess) {
                        Toast.makeText(requireContext(), "Profile updated", Toast.LENGTH_SHORT).show()
                    }
                    
                    if (state.loggedOut) {
                        startActivity(Intent(requireContext(), LoginActivity::class.java))
                        requireActivity().finishAffinity()
                    }
                    
                    state.error?.let {
                        Toast.makeText(requireContext(), it, Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }

        btnSave.setOnClickListener {
            val newName    = etName.text.toString().trim().takeIf { it.isNotBlank() }
            val newSmsOptIn = switchSms.isChecked
            viewModel.updateProfile(newName, newSmsOptIn)
        }

        btnProgramTag.setOnClickListener {
            startActivity(Intent(requireContext(), ConsumerTagWriterActivity::class.java))
        }

        btnLogout.setOnClickListener {
            viewModel.logout()
        }
        
        viewModel.loadProfile()
    }
}
