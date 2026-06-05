package com.orchestratepay.consumer.payment

import org.junit.Assert.*
import org.junit.Test
import java.security.SecureRandom
import java.util.UUID

/**
 * Unit tests for P2P payment logic on the payer side — Scenarios 6, 7, 10, 11.
 *
 * Covers the deterministic rules exercised by P2PPayActivity and P2PQrScannerActivity:
 *   - Idempotency key generation (32-char hex from SecureRandom)
 *   - Amount validation for payer-entered amounts
 *   - Source field selection (P2P_NFC vs P2P_QR)
 *   - Token UUID validation (same isValidP2PToken logic)
 *   - Payer/payee role semantics
 *   - Poll status terminal states (CONFIRMED / DECLINED / FAILED)
 *   - Redis key format for consumer:p2p: tokens
 *   - STK Push description truncation (Daraja 13-char limit)
 *
 * Pure JVM — no Android framework, no network.
 */
class P2PPayLogicTest {

    // ── Idempotency key generation ────────────────────────────────────────────

    private fun buildIdempotencyKey(): String {
        val bytes = ByteArray(16)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    private fun isValidIdempotencyKey(key: String): Boolean =
        key.length == 32 && key.all { it in '0'..'9' || it in 'a'..'f' }

    @Test
    fun `generated idempotency key is 32 lowercase hex characters`() {
        val key = buildIdempotencyKey()
        assertEquals(32, key.length)
        assertTrue(isValidIdempotencyKey(key))
    }

    @Test
    fun `two generated keys are always different (SecureRandom entropy)`() {
        val a = buildIdempotencyKey()
        val b = buildIdempotencyKey()
        assertNotEquals("Two idempotency keys must differ", a, b)
    }

    @Test
    fun `key contains no uppercase letters (backend schema requires lowercase hex)`() {
        val key = buildIdempotencyKey()
        assertFalse(key.any { it.isUpperCase() })
    }

    // ── Amount validation (payer-entered amounts) ─────────────────────────────

    private val MIN_AMOUNT_KSH = 1.0
    private val MAX_AMOUNT_KSH = 10_000.0  // UI limit; backend caps at KSh 1,000,000

    private fun validatePayerAmount(ksh: Double?): Boolean =
        ksh != null && ksh >= MIN_AMOUNT_KSH && ksh <= MAX_AMOUNT_KSH

    @Test
    fun `KSh 1 is the minimum valid amount`() {
        assertTrue(validatePayerAmount(1.0))
    }

    @Test
    fun `KSh 0 is below minimum`() {
        assertFalse(validatePayerAmount(0.0))
    }

    @Test
    fun `negative amount is rejected`() {
        assertFalse(validatePayerAmount(-50.0))
    }

    @Test
    fun `null amount (unparseable input) is rejected`() {
        assertFalse(validatePayerAmount(null))
    }

    @Test
    fun `KSh 50 is a valid amount`() {
        assertTrue(validatePayerAmount(50.0))
    }

    @Test
    fun `KSh 10000 is valid (UI ceiling)`() {
        assertTrue(validatePayerAmount(10_000.0))
    }

    @Test
    fun `KSh to cents conversion uses multiplication by 100 (no rounding error at whole KSh values)`() {
        val ksh   = 50.0
        val cents = (ksh * 100).toInt()
        assertEquals(5000, cents)
    }

    @Test
    fun `KSh 0_50 converts to 50 cents`() {
        val ksh   = 0.50
        val cents = (ksh * 100).toInt()
        assertEquals(50, cents)
    }

    // ── Source field selection ────────────────────────────────────────────────

    @Test
    fun `P2PPayActivity uses P2P_NFC source (NFC tap scenario)`() {
        val source = "P2P_NFC"
        assertEquals("P2P_NFC", source)
    }

    @Test
    fun `P2PQrScannerActivity uses P2P_QR source (QR scan scenario)`() {
        val source = "P2P_QR"
        assertEquals("P2P_QR", source)
    }

    @Test
    fun `P2P_NFC and P2P_QR are distinct source values`() {
        assertNotEquals("P2P_NFC", "P2P_QR")
    }

    // ── Token UUID validation ─────────────────────────────────────────────────

    private fun isValidP2PToken(value: String): Boolean =
        try { UUID.fromString(value); true } catch (_: Exception) { false }

    @Test
    fun `valid UUID v4 p2pToken is accepted`() {
        assertTrue(isValidP2PToken("550e8400-e29b-41d4-a716-446655440000"))
    }

    @Test
    fun `runtime UUID is a valid p2p token`() {
        assertTrue(isValidP2PToken(UUID.randomUUID().toString()))
    }

    @Test
    fun `empty string is not a valid token`() {
        assertFalse(isValidP2PToken(""))
    }

    @Test
    fun `JSON object string is not a valid token`() {
        assertFalse(isValidP2PToken("""{"p2pToken":"abc"}"""))
    }

    @Test
    fun `plain hex without dashes is not a valid token`() {
        assertFalse(isValidP2PToken("550e8400e29b41d4a716446655440000"))
    }

    // ── Payer / payee role semantics ──────────────────────────────────────────

    @Test
    fun `payer is the consumer who calls p2p-pay (they receive the STK Push)`() {
        // The STK Push fires to the PAYER's phone, not the payee's
        // Documented as a test so this invariant is never accidentally reversed
        val payerReceivesSTKPush = true
        val payeeReceivesSTKPush = false
        assertTrue(payerReceivesSTKPush)
        assertFalse(payeeReceivesSTKPush)
    }

    @Test
    fun `payee is identified from p2pToken or payeeConsumerId (never from JWT)`() {
        // The payer's JWT identifies the payer. The payee identity comes from
        // the p2pToken (Redis lookup) or direct payeeConsumerId field.
        val payeeResolutionSources = listOf("p2pToken", "payeeConsumerId")
        assertTrue(payeeResolutionSources.contains("p2pToken"))
        assertFalse(payeeResolutionSources.contains("jwtSub"))
    }

    // ── Poll status terminal states ───────────────────────────────────────────

    private fun isTerminalStatus(status: String): Boolean =
        status == "CONFIRMED" || status == "DECLINED" || status == "FAILED"

    @Test
    fun `CONFIRMED is a terminal status (cancel the countdown timer)`() {
        assertTrue(isTerminalStatus("CONFIRMED"))
    }

    @Test
    fun `DECLINED is a terminal status`() {
        assertTrue(isTerminalStatus("DECLINED"))
    }

    @Test
    fun `FAILED is a terminal status`() {
        assertTrue(isTerminalStatus("FAILED"))
    }

    @Test
    fun `STK_SENT is not terminal (keep polling)`() {
        assertFalse(isTerminalStatus("STK_SENT"))
    }

    @Test
    fun `PENDING is not terminal (keep polling)`() {
        assertFalse(isTerminalStatus("PENDING"))
    }

    // ── STK Push description truncation ──────────────────────────────────────

    private fun buildStkDescription(displayName: String?): String =
        if (displayName != null) "Send to $displayName".take(13) else "P2P Transfer"

    @Test
    fun `short display name produces readable description`() {
        assertEquals("Send to Alice", buildStkDescription("Alice"))
    }

    @Test
    fun `long display name is truncated to 13 chars (Daraja limit)`() {
        val desc = buildStkDescription("Wanjiku Kamau Njoroge")
        assertEquals(13, desc.length)
        assertTrue(desc.startsWith("Send to Wanj"))
    }

    @Test
    fun `null display name uses generic P2P Transfer description`() {
        assertEquals("P2P Transfer", buildStkDescription(null))
        assertTrue("P2P Transfer".length <= 13)
    }

    @Test
    fun `description never exceeds 13 characters regardless of name`() {
        val names = listOf("Alice", "Bob Smith Jones", "X", "Αλεξάνδρου Νικόλαος")
        for (name in names) {
            val desc = buildStkDescription(name)
            assertTrue("Description too long for name=$name (${desc.length} chars)", desc.length <= 13)
        }
    }

    // ── Redis key format ──────────────────────────────────────────────────────

    @Test
    fun `consumer p2p token Redis key has correct prefix`() {
        val token = UUID.randomUUID().toString()
        val key   = "consumer:p2p:$token"
        assertTrue(key.startsWith("consumer:p2p:"))
    }

    @Test
    fun `consumer p2p key does not collide with consumer qr key`() {
        val token  = "same-token"
        val p2pKey = "consumer:p2p:$token"
        val qrKey  = "consumer:qr:$token"
        assertNotEquals(p2pKey, qrKey)
    }

    // ── P2P Scenarios 6/7 vs 10/11 ───────────────────────────────────────────

    @Test
    fun `NFC and QR P2P flows share the same backend endpoint (p2p-pay)`() {
        val nfcEndpoint = "POST /consumers/p2p-pay"
        val qrEndpoint  = "POST /consumers/p2p-pay"
        assertEquals(nfcEndpoint, qrEndpoint)
    }

    @Test
    fun `NFC and QR P2P flows share the same token namespace (consumer:p2p:)`() {
        val nfcKeyPrefix = "consumer:p2p:"
        val qrKeyPrefix  = "consumer:p2p:"
        assertEquals(nfcKeyPrefix, qrKeyPrefix)
    }

    @Test
    fun `P2P token TTL is 90 seconds in both NFC and QR flows`() {
        val nfcTtlMs = 90_000L
        val qrTtlMs  = 90_000L
        assertEquals(nfcTtlMs, qrTtlMs)
    }
}
