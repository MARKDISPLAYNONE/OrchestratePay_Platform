package com.orchestratepay.nfccore

import android.net.Uri
import android.nfc.Tag
import android.nfc.tech.Ndef

/**
 * NdefTagParser — reads and parses OrchestratePay NDEF sticker tags.
 *
 * Expected URI format:
 *   orchestratepay://pay?mid=<merchantId>&tid=<tagId>&v=1&sign=<16hex>
 *
 * The signature is verified by the calling app using the merchant's HMAC key
 * (obtained from the /auth/login response). Verification is NOT done here
 * because the signing key is app-specific.
 */
object NdefTagParser {

    fun parse(tag: Tag): NfcReadResult {
        val ndef = Ndef.get(tag) ?: return NfcReadResult.Error(NfcReadError.UNRECOGNISED_TAG)

        return try {
            ndef.connect()
            val message = ndef.ndefMessage
                ?: ndef.cachedNdefMessage
                ?: return NfcReadResult.Error(NfcReadError.UNRECOGNISED_TAG)

            val record = message.records.firstOrNull()
                ?: return NfcReadResult.Error(NfcReadError.PARSE_ERROR)

            // The URI record payload starts with a 1-byte prefix code
            val payload = record.payload ?: return NfcReadResult.Error(NfcReadError.PARSE_ERROR)
            val uriStr  = buildUri(payload)
            val uri     = Uri.parse(uriStr)

            if (uri.scheme != "orchestratepay" || uri.host != "pay") {
                return NfcReadResult.Error(NfcReadError.UNRECOGNISED_TAG)
            }

            val merchantId = uri.getQueryParameter("mid")
            val tagId      = uri.getQueryParameter("tid")
            val signature  = uri.getQueryParameter("sign")

            if (merchantId.isNullOrBlank() || tagId.isNullOrBlank() || signature.isNullOrBlank()) {
                return NfcReadResult.Error(NfcReadError.PARSE_ERROR)
            }

            val rawUid = tag.id.joinToString("") { "%02x".format(it) }

            // Signature is validated by the calling app — return it raw
            NfcReadResult.TagRead(
                merchantId = merchantId,
                tagId      = tagId,
                rawUid     = rawUid,
                signature  = signature,
            )

        } catch (e: Exception) {
            NfcReadResult.Error(NfcReadError.READ_FAILED)
        } finally {
            try { ndef.close() } catch (_: Exception) {}
        }
    }

    /**
     * Reconstructs the full URI from an NDEF URI record payload.
     * The first byte is a well-known URI prefix code (0x01 = "http://www.", etc.).
     * 0x00 means no prefix — the rest of the payload is the full URI.
     */
    private fun buildUri(payload: ByteArray): String {
        if (payload.isEmpty()) return ""
        val prefixCode = payload[0].toInt() and 0xFF
        val prefixTable = arrayOf(
            "", "http://www.", "https://www.", "http://", "https://",
            "tel:", "mailto:", "ftp://anonymous:anonymous@", "ftp://ftp.",
            "ftps://", "sftp://", "smb://", "nfs://", "ftp://",
            "dav://", "news:", "telnet://", "imap:", "rtsp://",
            "urn:", "pop:", "sip:", "sips:", "tftp:",
            "btspp://", "btl2cap://", "btgoep://", "tcpobex://",
            "irdaobex://", "file://", "urn:epc:id:", "urn:epc:tag:",
            "urn:epc:pat:", "urn:epc:raw:", "urn:epc:", "urn:nfc:",
        )
        val prefix = if (prefixCode < prefixTable.size) prefixTable[prefixCode] else ""
        return prefix + String(payload, 1, payload.size - 1)
    }
}
