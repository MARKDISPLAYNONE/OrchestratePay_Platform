package com.orchestratepay.softpos.ui

import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for TapGuideActivity.antennaPosition() and the antenna lookup table.
 *
 * antennaPosition() reads Build.MODEL at runtime — JVM tests cannot override that,
 * so we test the lookup logic directly by mirroring it here. Any change to the
 * lookup table in TapGuideActivity must be reflected in these tests.
 */
class TapGuideAntennaTest {

    // ── Mirror of the lookup table ──────────────────────────────────────────────
    private val ANTENNA_POSITION = mapOf(
        "pixel"   to TapGuideActivity.AntennaPosition.CENTER,
        "samsung" to TapGuideActivity.AntennaPosition.TOP,
        "xiaomi"  to TapGuideActivity.AntennaPosition.CENTER,
        "huawei"  to TapGuideActivity.AntennaPosition.CENTER,
        "oppo"    to TapGuideActivity.AntennaPosition.CENTER,
        "tecno"   to TapGuideActivity.AntennaPosition.CENTER,
        "infinix" to TapGuideActivity.AntennaPosition.CENTER,
    )

    private fun lookup(model: String): TapGuideActivity.AntennaPosition {
        val lower = model.lowercase()
        return ANTENNA_POSITION.entries
            .firstOrNull { (brand, _) -> lower.contains(brand) }
            ?.value ?: TapGuideActivity.AntennaPosition.CENTER
    }

    // ── Enum basics ──────────────────────────────────────────────────────────────

    @Test
    fun `AntennaPosition has exactly three values`() {
        assertEquals(3, TapGuideActivity.AntennaPosition.values().size)
    }

    @Test
    fun `AntennaPosition values are TOP CENTER BOTTOM`() {
        val names = TapGuideActivity.AntennaPosition.values().map { it.name }
        assertTrue(names.contains("TOP"))
        assertTrue(names.contains("CENTER"))
        assertTrue(names.contains("BOTTOM"))
    }

    // ── Known device families ─────────────────────────────────────────────────────

    @Test
    fun `Samsung devices map to TOP`() {
        assertEquals(TapGuideActivity.AntennaPosition.TOP, lookup("Samsung Galaxy S24"))
        assertEquals(TapGuideActivity.AntennaPosition.TOP, lookup("SAMSUNG SM-G991B"))
        assertEquals(TapGuideActivity.AntennaPosition.TOP, lookup("samsung galaxy a52"))
    }

    @Test
    fun `Pixel devices map to CENTER`() {
        assertEquals(TapGuideActivity.AntennaPosition.CENTER, lookup("Pixel 8 Pro"))
        assertEquals(TapGuideActivity.AntennaPosition.CENTER, lookup("Google Pixel 7"))
    }

    @Test
    fun `Xiaomi devices map to CENTER`() {
        assertEquals(TapGuideActivity.AntennaPosition.CENTER, lookup("Xiaomi 14"))
        assertEquals(TapGuideActivity.AntennaPosition.CENTER, lookup("xiaomi redmi note 12"))
    }

    @Test
    fun `Huawei devices map to CENTER`() {
        assertEquals(TapGuideActivity.AntennaPosition.CENTER, lookup("Huawei P60 Pro"))
    }

    @Test
    fun `OPPO devices map to CENTER`() {
        assertEquals(TapGuideActivity.AntennaPosition.CENTER, lookup("OPPO Find X7"))
        assertEquals(TapGuideActivity.AntennaPosition.CENTER, lookup("oppo a78"))
    }

    @Test
    fun `Tecno devices map to CENTER`() {
        assertEquals(TapGuideActivity.AntennaPosition.CENTER, lookup("TECNO Spark 20 Pro"))
    }

    @Test
    fun `Infinix devices map to CENTER`() {
        assertEquals(TapGuideActivity.AntennaPosition.CENTER, lookup("Infinix Hot 40i"))
    }

    // ── Unknown device fallback ───────────────────────────────────────────────────

    @Test
    fun `unknown device model falls back to CENTER`() {
        assertEquals(TapGuideActivity.AntennaPosition.CENTER, lookup(""))
        assertEquals(TapGuideActivity.AntennaPosition.CENTER, lookup("SomeUnknownDevice XYZ"))
        assertEquals(TapGuideActivity.AntennaPosition.CENTER, lookup("Itel P40"))
        assertEquals(TapGuideActivity.AntennaPosition.CENTER, lookup("Nokia 3310"))
    }

    // ── Case-insensitivity ────────────────────────────────────────────────────────

    @Test
    fun `lookup is case-insensitive`() {
        assertEquals(lookup("SAMSUNG A23"), lookup("samsung a23"))
        assertEquals(lookup("PIXEL 8"), lookup("Pixel 8"))
        assertEquals(lookup("XIAOMI 13T"), lookup("xiaomi 13t"))
    }

    // ── Exhaustiveness guard ─────────────────────────────────────────────────────

    @Test
    fun `when expression covers all AntennaPosition variants`() {
        var handled = 0
        TapGuideActivity.AntennaPosition.values().forEach { pos ->
            when (pos) {
                TapGuideActivity.AntennaPosition.TOP    -> handled++
                TapGuideActivity.AntennaPosition.CENTER -> handled++
                TapGuideActivity.AntennaPosition.BOTTOM -> handled++
            }
        }
        assertEquals(3, handled)
    }

    // ── EXTRA_AMOUNT_CENTS constant ───────────────────────────────────────────────

    @Test
    fun `EXTRA_AMOUNT_CENTS constant is defined`() {
        assertNotNull(TapGuideActivity.EXTRA_AMOUNT_CENTS)
        assertTrue(TapGuideActivity.EXTRA_AMOUNT_CENTS.isNotEmpty())
    }
}
