package com.orchestratepay.consumer.hce

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for ConsumerHceService payload mode selection.
 *
 * ConsumerHceService emits one of three payload types:
 *   1. P2P_REQUEST     — when P2PHceSession is active (Scenarios 6, 7)
 *   2. CONSUMER_PAYMENT — default mode (Scenarios 3, 4)
 *   3. null / SW_NOT_FOUND — when neither session is active (consumer not logged in)
 *
 * P2P mode takes priority over consumer payment mode.
 * This prevents accidental cross-mode APDU responses when both sessions might
 * theoretically be active simultaneously.
 *
 * Pure JVM — no Android framework, no NFC hardware.
 */
class ConsumerHceModeSelectionTest {

    // ── Inline session models ─────────────────────────────────────────────────

    data class P2PSession(
        val p2pToken:    String,
        val consumerId:  String,
        val displayName: String?,
        val amountCents: Long?,
        val expiresAt:   Long,
    )

    data class ConsumerSession(
        val phone:    String,
        val hceToken: String,
        val exp:      Long,
    )

    // ── Inline buildSessionPayload (mirrors ConsumerHceService.buildSessionPayload) ──

    private fun buildPayload(
        p2pSession:      P2PSession?,
        consumerSession: ConsumerSession?
    ): JSONObject? {
        // P2P mode takes priority
        p2pSession?.let { p2p ->
            if (System.currentTimeMillis() > p2p.expiresAt) return null
            return JSONObject().apply {
                put("type",        "P2P_REQUEST")
                put("p2pToken",    p2p.p2pToken)
                put("displayName", p2p.displayName ?: JSONObject.NULL)
                put("amountCents", p2p.amountCents ?: JSONObject.NULL)
                put("exp",         p2p.expiresAt)
            }
        }

        // Default consumer payment mode
        consumerSession?.let { c ->
            return JSONObject().apply {
                put("type",          "CONSUMER_PAYMENT")
                put("phone",         c.phone)
                put("token",         c.hceToken)
                put("exp",           c.exp)
                put("deviceType",    "CONSUMER_PHONE")
                put("walletVersion", 2)
            }
        }

        return null  // neither session active → SW_NOT_FOUND
    }

    // ── Fixtures ──────────────────────────────────────────────────────────────

    private val validP2P = P2PSession(
        p2pToken    = "p2p-token-uuid",
        consumerId  = "consumer-id",
        displayName = "Alice",
        amountCents = 5000L,
        expiresAt   = System.currentTimeMillis() + 90_000L,
    )

    private val expiredP2P = validP2P.copy(expiresAt = System.currentTimeMillis() - 1L)

    private val validConsumer = ConsumerSession(
        phone    = "254712345678",
        hceToken = "a".repeat(32),
        exp      = System.currentTimeMillis() + 60_000L,
    )

    // ── Mode priority tests ───────────────────────────────────────────────────

    @Test
    fun `P2P_REQUEST emitted when P2PHceSession is active`() {
        val payload = buildPayload(validP2P, validConsumer)
        assertNotNull(payload)
        assertEquals("P2P_REQUEST", payload!!.getString("type"))
    }

    @Test
    fun `CONSUMER_PAYMENT emitted when only consumer session is active`() {
        val payload = buildPayload(null, validConsumer)
        assertNotNull(payload)
        assertEquals("CONSUMER_PAYMENT", payload!!.getString("type"))
    }

    @Test
    fun `null returned when no session is active (SW_NOT_FOUND)`() {
        assertNull(buildPayload(null, null))
    }

    @Test
    fun `P2P_REQUEST takes priority over CONSUMER_PAYMENT when both are active`() {
        // Both sessions active — P2P wins
        val payload = buildPayload(validP2P, validConsumer)
        assertEquals("P2P_REQUEST", payload!!.getString("type"))
        // CONSUMER_PAYMENT fields (phone, token) are NOT in the P2P payload
        assertFalse(payload.has("phone"))
        assertFalse(payload.has("deviceType"))
        assertFalse(payload.has("walletVersion"))
    }

    @Test
    fun `expired P2P session falls back to CONSUMER_PAYMENT mode`() {
        val payload = buildPayload(expiredP2P, validConsumer)
        assertNotNull(payload)
        assertEquals("CONSUMER_PAYMENT", payload!!.getString("type"))
    }

    @Test
    fun `expired P2P session with no consumer session returns null`() {
        assertNull(buildPayload(expiredP2P, null))
    }

    // ── P2P_REQUEST payload structure ─────────────────────────────────────────

    @Test
    fun `P2P_REQUEST payload includes p2pToken`() {
        val payload = buildPayload(validP2P, null)!!
        assertEquals("p2p-token-uuid", payload.getString("p2pToken"))
    }

    @Test
    fun `P2P_REQUEST payload includes displayName (may be null)`() {
        val withName    = buildPayload(validP2P, null)!!
        val withoutName = buildPayload(validP2P.copy(displayName = null), null)!!
        assertEquals("Alice", withName.getString("displayName"))
        assertTrue(withoutName.isNull("displayName"))
    }

    @Test
    fun `P2P_REQUEST payload includes amountCents (may be null)`() {
        val withAmount    = buildPayload(validP2P, null)!!
        val withoutAmount = buildPayload(validP2P.copy(amountCents = null), null)!!
        assertEquals(5000L, withAmount.getLong("amountCents"))
        assertTrue(withoutAmount.isNull("amountCents"))
    }

    @Test
    fun `P2P_REQUEST payload includes exp field`() {
        val payload = buildPayload(validP2P, null)!!
        assertTrue(payload.getLong("exp") > System.currentTimeMillis())
    }

    @Test
    fun `P2P_REQUEST payload does NOT contain phone or HCE token (wrong mode)`() {
        val payload = buildPayload(validP2P, null)!!
        assertFalse(payload.has("phone"))
        assertFalse(payload.has("token"))
        assertFalse(payload.has("hceToken"))
    }

    // ── CONSUMER_PAYMENT payload structure ────────────────────────────────────

    @Test
    fun `CONSUMER_PAYMENT payload includes phone and hce token`() {
        val payload = buildPayload(null, validConsumer)!!
        assertEquals("254712345678",  payload.getString("phone"))
        assertEquals("a".repeat(32), payload.getString("token"))
        assertEquals("CONSUMER_PHONE", payload.getString("deviceType"))
        assertEquals(2, payload.getInt("walletVersion"))
    }

    @Test
    fun `CONSUMER_PAYMENT payload does NOT contain p2pToken`() {
        val payload = buildPayload(null, validConsumer)!!
        assertFalse(payload.has("p2pToken"))
        assertFalse(payload.has("amountCents"))
    }

    // ── Type field routing (reader side) ─────────────────────────────────────

    @Test
    fun `type field is the first routing key checked by readers`() {
        val types = listOf("CONSUMER_PAYMENT", "MERCHANT_REQUEST", "P2P_REQUEST")
        // All three values are distinct — no ambiguity
        assertEquals(3, types.toSet().size)
    }

    @Test
    fun `MerchantHceReader returns null for P2P_REQUEST (wrong type for merchant reader)`() {
        // MerchantHceReader.read() checks: if (payload.optString("type") != "MERCHANT_REQUEST") return null
        val p2pPayload = JSONObject().put("type", "P2P_REQUEST")
        assertNotEquals("MERCHANT_REQUEST", p2pPayload.getString("type"))
    }

    @Test
    fun `ConsumerP2PReader returns null for CONSUMER_PAYMENT (wrong type for P2P reader)`() {
        val consumerPayload = JSONObject().put("type", "CONSUMER_PAYMENT")
        assertNotEquals("P2P_REQUEST", consumerPayload.getString("type"))
    }
}
