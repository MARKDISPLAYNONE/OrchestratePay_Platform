package com.orchestratepay.nfccore

import org.junit.Assert.*
import org.junit.Test
import java.lang.reflect.Method

/**
 * Tests for ApduProtocol.
 *
 * The public method readHceTag() requires an Android Tag object — tested via
 * instrumented tests. The private isSuccess() helper is security-critical and
 * tested here via reflection.
 */
class ApduProtocolTest {

    private val isSuccess: Method = ApduProtocol::class.java
        .getDeclaredMethod("isSuccess", ByteArray::class.java)
        .also { it.isAccessible = true }

    private fun isSuccess(bytes: ByteArray): Boolean =
        isSuccess.invoke(ApduProtocol, bytes) as Boolean

    // ── isSuccess — happy path ────────────────────────────────────────────────

    @Test
    fun `SW 9000 is success`() {
        assertTrue(isSuccess(byteArrayOf(0x90.toByte(), 0x00)))
    }

    @Test
    fun `SW 9000 with leading data is success`() {
        // Typical GET DATA response: <json bytes> + 0x90 0x00
        val payload = byteArrayOf(0x7B, 0x22, 0x70, 0x68, 0x90.toByte(), 0x00)
        assertTrue(isSuccess(payload))
    }

    @Test
    fun `single byte 9000 with data prefix`() {
        assertTrue(isSuccess(byteArrayOf(0x01, 0x02, 0x03, 0x90.toByte(), 0x00)))
    }

    // ── isSuccess — failure paths ─────────────────────────────────────────────

    @Test
    fun `SW 6A82 not found is not success`() {
        assertFalse(isSuccess(byteArrayOf(0x6A.toByte(), 0x82.toByte())))
    }

    @Test
    fun `SW 6F00 unknown is not success`() {
        assertFalse(isSuccess(byteArrayOf(0x6F, 0x00)))
    }

    @Test
    fun `empty response is not success`() {
        assertFalse(isSuccess(byteArrayOf()))
    }

    @Test
    fun `single byte response is not success`() {
        assertFalse(isSuccess(byteArrayOf(0x90.toByte())))
    }

    @Test
    fun `wrong order 0x00 0x90 is not success`() {
        assertFalse(isSuccess(byteArrayOf(0x00, 0x90.toByte())))
    }

    @Test
    fun `SW 9001 is not success`() {
        assertFalse(isSuccess(byteArrayOf(0x90.toByte(), 0x01)))
    }

    // ── AID constant ─────────────────────────────────────────────────────────

    @Test
    fun `AID is 9 bytes (F04F52434845535441)`() {
        val aidField = ApduProtocol::class.java.getDeclaredField("AID")
        aidField.isAccessible = true
        val aid = aidField.get(ApduProtocol) as ByteArray
        assertEquals(9, aid.size)
        assertEquals(0xF0.toByte(), aid[0])
        assertEquals(0x4F.toByte(), aid[1])
    }

    @Test
    fun `SELECT APDU starts with 00 A4 04 00`() {
        val field = ApduProtocol::class.java.getDeclaredField("SELECT_APDU")
        field.isAccessible = true
        val apdu = field.get(ApduProtocol) as ByteArray
        assertEquals(0x00.toByte(), apdu[0])
        assertEquals(0xA4.toByte(), apdu[1])
        assertEquals(0x04.toByte(), apdu[2])
        assertEquals(0x00.toByte(), apdu[3])
    }

    @Test
    fun `GET_DATA APDU starts with 80 80`() {
        val field = ApduProtocol::class.java.getDeclaredField("GET_DATA_APDU")
        field.isAccessible = true
        val apdu = field.get(ApduProtocol) as ByteArray
        assertEquals(0x80.toByte(), apdu[0])
        assertEquals(0x80.toByte(), apdu[1])
    }

    @Test
    fun `CONFIRM APDU starts with 80 81`() {
        val field = ApduProtocol::class.java.getDeclaredField("CONFIRM_APDU")
        field.isAccessible = true
        val apdu = field.get(ApduProtocol) as ByteArray
        assertEquals(0x80.toByte(), apdu[0])
        assertEquals(0x81.toByte(), apdu[1])
    }
}
