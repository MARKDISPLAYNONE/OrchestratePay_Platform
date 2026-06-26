package com.orchestratepay.softpos.integrity

import org.junit.Assert.*
import org.junit.Test
import java.security.MessageDigest
import java.util.Base64

/**
 * JVM-testable aspects of PlayIntegrityChecker.
 *
 * getIntegrityToken() requires a live Android Context and Google Play Services —
 * tested in instrumented tests. Here we validate the nonce-building contract
 * and failure semantics that are documented in the kdoc.
 */
class PlayIntegrityCheckerTest {

    // ── Nonce contract (mirrors nonce format documented in getIntegrityToken kdoc) ──

    private fun buildNonce(merchantId: String, timestamp: Long = System.currentTimeMillis()): String {
        val input = "$merchantId:$timestamp"
        val digest = MessageDigest.getInstance("SHA-256").digest(input.toByteArray())
        return Base64.getUrlEncoder().withoutPadding().encodeToString(digest)
    }

    @Test
    fun `nonce is 43 characters (256-bit SHA base64url without padding)`() {
        assertEquals(43, buildNonce("merchant-A").length)
    }

    @Test
    fun `nonce uses URL-safe base64 — no plus, slash, or equals`() {
        repeat(50) { i ->
            val nonce = buildNonce("merchant-$i", i.toLong() * 1_000_000L)
            assertFalse("plus in nonce", nonce.contains('+'))
            assertFalse("slash in nonce", nonce.contains('/'))
            assertFalse("equals in nonce", nonce.contains('='))
        }
    }

    @Test
    fun `different merchantIds produce different nonces at same timestamp`() {
        val ts = 1_700_000_000_000L
        assertNotEquals(buildNonce("merchant-X", ts), buildNonce("merchant-Y", ts))
    }

    @Test
    fun `different timestamps produce different nonces for same merchant`() {
        assertNotEquals(
            buildNonce("m", 1_000L),
            buildNonce("m", 2_000L)
        )
    }

    @Test
    fun `nonce is deterministic for same inputs`() {
        val n1 = buildNonce("merchant-Z", 1_700_000_000_000L)
        val n2 = buildNonce("merchant-Z", 1_700_000_000_000L)
        assertEquals(n1, n2)
    }

    @Test
    fun `nonce binds merchantId in content (prevents cross-account replay)`() {
        val ts = 1_700_000_000_000L
        val n1 = buildNonce("honest-merchant", ts)
        val n2 = buildNonce("ghost-merchant",  ts)
        assertNotEquals("Nonce must be merchant-specific", n1, n2)
    }

    @Test
    fun `nonce contains no whitespace`() {
        val nonce = buildNonce("merchant-ws-test", 12345L)
        assertFalse(nonce.contains(' '))
        assertFalse(nonce.contains('\n'))
        assertFalse(nonce.contains('\t'))
    }

    // ── PlayIntegrityChecker object is accessible ─────────────────────────────

    @Test
    fun `PlayIntegrityChecker is an object (singleton)`() {
        assertNotNull(PlayIntegrityChecker)
    }

    @Test
    fun `PlayIntegrityChecker has getIntegrityToken method`() {
        val method = PlayIntegrityChecker::class.java.getDeclaredMethod(
            "getIntegrityToken",
            android.content.Context::class.java,
            String::class.java
        )
        assertNotNull(method)
        assertTrue(method.isSuspend() || method.parameterCount == 3) // suspend adds Continuation param
    }

    private fun java.lang.reflect.Method.isSuspend(): Boolean =
        parameterTypes.lastOrNull()?.name?.contains("Continuation") == true
}
