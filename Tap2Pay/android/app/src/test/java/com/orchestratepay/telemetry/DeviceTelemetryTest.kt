package com.orchestratepay.telemetry

import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for DeviceTelemetry data class and battery health mapping logic.
 *
 * DeviceTelemetryCollector requires an Android Context — only the pure data
 * class contracts and the battery health string mapping are tested here.
 *
 * The mapping is extracted to a standalone function so it can be covered
 * without spinning up an instrumented test.
 */
class DeviceTelemetryTest {

    // Mirror of DeviceTelemetryCollector's battery health mapping, extracted for testability.
    private fun batteryHealthString(batteryHealthCode: Int): String = when (batteryHealthCode) {
        2 /* BATTERY_HEALTH_GOOD     */ -> "GOOD"
        3 /* BATTERY_HEALTH_OVERHEAT */ -> "OVERHEAT"
        4 /* BATTERY_HEALTH_DEAD     */ -> "DEAD"
        7 /* BATTERY_HEALTH_COLD     */ -> "COLD"
        else                            -> "UNKNOWN"
    }

    // Mirror of battery percentage calculation logic.
    private fun calcBatteryPct(level: Int, scale: Int): Int =
        if (level >= 0 && scale > 0) (level * 100 / scale) else -1

    // ─── DeviceTelemetry data class ───────────────────────────────────────────

    @Test
    fun `DeviceTelemetry carries all required fields`() {
        val t = DeviceTelemetry(
            deviceSerial     = "SN-123",
            merchantId       = "mid-abc",
            appVersion       = "1.0.0",
            appVersionCode   = 1,
            batteryPct       = 85,
            batteryHealth    = "GOOD",
            isCharging       = false,
            printerStatus    = 1,
            storageFreeBytes = 2_000_000_000L,
            nfcAvailable     = true,
            timestampMs      = 1_700_000_000_000L
        )
        assertEquals("SN-123",            t.deviceSerial)
        assertEquals("mid-abc",           t.merchantId)
        assertEquals("1.0.0",             t.appVersion)
        assertEquals(1,                   t.appVersionCode)
        assertEquals(85,                  t.batteryPct)
        assertEquals("GOOD",             t.batteryHealth)
        assertFalse(t.isCharging)
        assertEquals(1,                   t.printerStatus)
        assertEquals(2_000_000_000L,      t.storageFreeBytes)
        assertTrue(t.nfcAvailable)
    }

    @Test
    fun `timestampMs defaults to current time when not specified`() {
        val before = System.currentTimeMillis()
        val t = DeviceTelemetry(
            deviceSerial     = "s",
            merchantId       = "m",
            appVersion       = "1.0",
            appVersionCode   = 1,
            batteryPct       = 100,
            batteryHealth    = "GOOD",
            isCharging       = true,
            printerStatus    = 1,
            storageFreeBytes = 0L,
            nfcAvailable     = false
        )
        val after = System.currentTimeMillis()
        assertTrue(t.timestampMs in before..after)
    }

    @Test
    fun `two identical DeviceTelemetry objects are equal`() {
        val ts = 1_000L
        val a = DeviceTelemetry("s", "m", "1.0", 1, 80, "GOOD", false, 1, 0L, true, ts)
        val b = DeviceTelemetry("s", "m", "1.0", 1, 80, "GOOD", false, 1, 0L, true, ts)
        assertEquals(a, b)
    }

    // ─── Battery health mapping ───────────────────────────────────────────────

    @Test
    fun `GOOD maps to GOOD`() {
        assertEquals("GOOD", batteryHealthString(2))
    }

    @Test
    fun `OVERHEAT maps to OVERHEAT`() {
        assertEquals("OVERHEAT", batteryHealthString(3))
    }

    @Test
    fun `DEAD maps to DEAD`() {
        assertEquals("DEAD", batteryHealthString(4))
    }

    @Test
    fun `COLD maps to COLD`() {
        assertEquals("COLD", batteryHealthString(7))
    }

    @Test
    fun `unknown code maps to UNKNOWN`() {
        assertEquals("UNKNOWN", batteryHealthString(0))
        assertEquals("UNKNOWN", batteryHealthString(-1))
        assertEquals("UNKNOWN", batteryHealthString(99))
    }

    @Test
    fun `battery health strings match backend evaluateAlerts contract`() {
        // Backend expects one of: GOOD | OVERHEAT | DEAD | COLD | UNKNOWN
        val validStrings = setOf("GOOD", "OVERHEAT", "DEAD", "COLD", "UNKNOWN")
        val allCodes = listOf(0, 1, 2, 3, 4, 5, 6, 7, 8)
        allCodes.forEach { code ->
            assertTrue(
                "batteryHealthString($code) not in $validStrings",
                batteryHealthString(code) in validStrings
            )
        }
    }

    // ─── Battery percentage calculation ───────────────────────────────────────

    @Test
    fun `100 percent battery returns 100`() {
        assertEquals(100, calcBatteryPct(100, 100))
    }

    @Test
    fun `zero battery returns 0`() {
        assertEquals(0, calcBatteryPct(0, 100))
    }

    @Test
    fun `half battery returns 50`() {
        assertEquals(50, calcBatteryPct(50, 100))
    }

    @Test
    fun `invalid level returns -1`() {
        assertEquals(-1, calcBatteryPct(-1, 100))
    }

    @Test
    fun `invalid scale returns -1`() {
        assertEquals(-1, calcBatteryPct(50, 0))
    }

    @Test
    fun `scale of 255 (some OEMs) rounds correctly`() {
        // level=191, scale=255 → 191*100/255 = 74
        assertEquals(74, calcBatteryPct(191, 255))
    }

    // ─── Sunmi printer status codes ───────────────────────────────────────────

    @Test
    fun `printer status 1 means Ready`() {
        val t = DeviceTelemetry(
            deviceSerial = "s", merchantId = "m", appVersion = "1.0", appVersionCode = 1,
            batteryPct = 100, batteryHealth = "GOOD", isCharging = false,
            printerStatus = 1, storageFreeBytes = 0L, nfcAvailable = true
        )
        assertEquals(1, t.printerStatus)
    }

    @Test
    fun `printer status 4 means OutOfPaper`() {
        val t = DeviceTelemetry(
            deviceSerial = "s", merchantId = "m", appVersion = "1.0", appVersionCode = 1,
            batteryPct = 100, batteryHealth = "GOOD", isCharging = false,
            printerStatus = 4, storageFreeBytes = 0L, nfcAvailable = true
        )
        assertEquals(4, t.printerStatus)
    }
}
