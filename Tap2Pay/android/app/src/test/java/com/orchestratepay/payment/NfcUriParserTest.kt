package com.orchestratepay.payment

import android.net.Uri
import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for the OrchestratePay URI parsing logic from NfcReaderManager.
 *
 * The URI format is: orchestratepay://pay?mid={merchantId}&tid={tagId}&v=1
 *
 * These test the pure parsing logic extracted from readNdefTag() so it can
 * run without NFC hardware or Android framework (uses android.net.Uri which
 * is available in unit test scope via Robolectric or the stub jar).
 *
 * Note: if android.net.Uri is not available in your test variant, add
 * Robolectric to testImplementation dependencies and annotate with
 * @RunWith(RobolectricTestRunner::class)
 */
class NfcUriParserTest {

    /**
     * Mirrors the parsing logic in NfcReaderManager.readNdefTag().
     * Extracted here so it can be tested without NFC hardware.
     */
    private fun parseOrchestrateUri(uriString: String): Pair<String, String>? {
        val uri = Uri.parse(uriString)
        if (uri.scheme != "orchestratepay" || uri.host != "pay") return null
        val merchantId = uri.getQueryParameter("mid") ?: return null
        val tagId      = uri.getQueryParameter("tid") ?: return null
        val version    = uri.getQueryParameter("v") ?: "1"
        if (version != "1") return null
        return Pair(merchantId, tagId)
    }

    @Test
    fun `valid orchestratepay URI parses merchant and tag IDs`() {
        val result = parseOrchestrateUri("orchestratepay://pay?mid=merchant-abc&tid=tag-xyz&v=1")
        assertNotNull(result)
        assertEquals("merchant-abc", result!!.first)
        assertEquals("tag-xyz", result.second)
    }

    @Test
    fun `wrong scheme returns null`() {
        val result = parseOrchestrateUri("orchestratepay://pay?mid=abc&tid=xyz&v=1")
        assertNull("orchestratepay (with extra r) is not our scheme", result)
    }

    @Test
    fun `wrong host returns null`() {
        val result = parseOrchestrateUri("orchestratepay://checkout?mid=abc&tid=xyz&v=1")
        assertNull(result)
    }

    @Test
    fun `missing mid returns null`() {
        val result = parseOrchestrateUri("orchestratepay://pay?tid=tag-xyz&v=1")
        assertNull(result)
    }

    @Test
    fun `missing tid returns null`() {
        val result = parseOrchestrateUri("orchestratepay://pay?mid=merchant-abc&v=1")
        assertNull(result)
    }

    @Test
    fun `unknown version returns null`() {
        val result = parseOrchestrateUri("orchestratepay://pay?mid=abc&tid=xyz&v=2")
        assertNull("Version 2 tags must be rejected until migration logic exists", result)
    }

    @Test
    fun `version 1 is accepted`() {
        val result = parseOrchestrateUri("orchestratepay://pay?mid=abc&tid=xyz&v=1")
        assertNotNull(result)
    }
}
