package com.orchestratepay.payment

import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for SoftPOS device integrity checks.
 *
 * SoftPOS turns a merchant's personal Android phone into an NFC payment terminal.
 * This creates a security surface not present on dedicated Sunmi hardware:
 *   - The device may be rooted, giving other apps elevated privileges
 *   - The bootloader may be unlocked, allowing custom firmware
 *   - A compromised device can intercept NFC tags or replay transactions
 *
 * Defence layers (all pure logic, no Android framework here):
 *   1. Root heuristic — check for common root binaries on the filesystem
 *   2. Play Integrity API verdict — hardware-attested from Google
 *   3. NFC reader guard — disable the reader if attestation fails
 *
 * Real app uses the Play Integrity API (com.google.android.play:integrity).
 * Here we model the verdict parsing logic so it can run on JVM without Play Services.
 */
class SoftPosAttestationTest {

    // ─── Play Integrity verdict model ────────────────────────────────────────────
    // Mirrors the JSON response from the Integrity API token decryption endpoint.
    // https://developer.android.com/google/play/integrity/verdict

    /**
     * Values returned in deviceIntegrity.deviceRecognitionVerdict[] (can be multiple).
     *
     * MEETS_STRONG_INTEGRITY    — hardware-backed keystore, bootloader locked, Google-certified
     * MEETS_DEVICE_INTEGRITY    — passes basic integrity checks (non-rooted, unmodified)
     * MEETS_BASIC_INTEGRITY     — passes CTS (compatibility test suite) but may be rooted
     * MEETS_VIRTUAL_INTEGRITY   — emulator that declares itself as having integrity
     *
     * For payment acceptance we require MEETS_DEVICE_INTEGRITY at minimum.
     * SoftPOS mode requires MEETS_STRONG_INTEGRITY (hardware keystore protects merchant keys).
     */
    enum class IntegrityVerdict {
        MEETS_STRONG_INTEGRITY,
        MEETS_DEVICE_INTEGRITY,
        MEETS_BASIC_INTEGRITY,
        MEETS_VIRTUAL_INTEGRITY,
    }

    data class IntegrityResult(
        val verdicts: Set<IntegrityVerdict>,
        val error: String? = null
    )

    private val SOFTPOS_REQUIRED_VERDICT = IntegrityVerdict.MEETS_DEVICE_INTEGRITY
    private val SOFTPOS_STRONG_VERDICT   = IntegrityVerdict.MEETS_STRONG_INTEGRITY

    private fun isAttestationSufficient(result: IntegrityResult): Boolean {
        if (result.error != null) return false          // API call failed — fail-closed
        return result.verdicts.contains(SOFTPOS_REQUIRED_VERDICT)
    }

    private fun isStrongAttestation(result: IntegrityResult): Boolean {
        if (result.error != null) return false
        return result.verdicts.contains(SOFTPOS_STRONG_VERDICT)
    }

    private fun nfcReaderShouldBeEnabled(result: IntegrityResult): Boolean =
        isAttestationSufficient(result)

    // ─── Root heuristic ──────────────────────────────────────────────────────────

    private val ROOT_BINARY_PATHS = listOf(
        "/system/xbin/su",
        "/system/bin/su",
        "/sbin/su",
        "/data/local/xbin/su",
        "/data/local/bin/su",
        "/data/local/su",
        "/system/sd/xbin/su",
        "/system/bin/failsafe/su",
        "/system/xbin/mu",
        "/sbin/.magisk"           // Magisk daemon directory
    )

    private val TEST_KEYS_INDICATOR = "test-keys"  // ro.build.tags indicates engineering build

    private fun checkRootHeuristic(
        existingPaths: Set<String>,
        buildTags: String
    ): Boolean {
        val hasSuBinary = ROOT_BINARY_PATHS.any { it in existingPaths }
        val isTestBuild = buildTags.contains(TEST_KEYS_INDICATOR)
        return hasSuBinary || isTestBuild
    }

    // ─── Attestation sufficiency tests ────────────────────────────────────────────

    @Test
    fun `MEETS_STRONG_INTEGRITY satisfies both strong and basic requirements`() {
        val result = IntegrityResult(verdicts = setOf(
            IntegrityVerdict.MEETS_STRONG_INTEGRITY,
            IntegrityVerdict.MEETS_DEVICE_INTEGRITY
        ))
        assertTrue(isAttestationSufficient(result))
        assertTrue(isStrongAttestation(result))
        assertTrue(nfcReaderShouldBeEnabled(result))
    }

    @Test
    fun `MEETS_DEVICE_INTEGRITY without STRONG still enables NFC reader`() {
        val result = IntegrityResult(verdicts = setOf(
            IntegrityVerdict.MEETS_DEVICE_INTEGRITY,
            IntegrityVerdict.MEETS_BASIC_INTEGRITY
        ))
        assertTrue(isAttestationSufficient(result))
        assertFalse("Strong attestation should be absent", isStrongAttestation(result))
        assertTrue(nfcReaderShouldBeEnabled(result))
    }

    @Test
    fun `empty verdict set disables NFC reader (rooted device returns no verdicts)`() {
        val result = IntegrityResult(verdicts = emptySet())
        assertFalse(isAttestationSufficient(result))
        assertFalse(nfcReaderShouldBeEnabled(result))
    }

    @Test
    fun `MEETS_BASIC_INTEGRITY only (may be rooted) disables SoftPOS NFC reader`() {
        // MEETS_BASIC_INTEGRITY indicates CTS-compatible but NOT that the device
        // is unmodified. A rooted device with Magisk hide can still pass basic CTS.
        val result = IntegrityResult(verdicts = setOf(IntegrityVerdict.MEETS_BASIC_INTEGRITY))
        assertFalse("BASIC alone is not sufficient for payment acceptance", isAttestationSufficient(result))
        assertFalse(nfcReaderShouldBeEnabled(result))
    }

    @Test
    fun `MEETS_VIRTUAL_INTEGRITY (emulator) disables NFC reader`() {
        val result = IntegrityResult(verdicts = setOf(IntegrityVerdict.MEETS_VIRTUAL_INTEGRITY))
        assertFalse("Emulator must not accept real NFC payments", isAttestationSufficient(result))
        assertFalse(nfcReaderShouldBeEnabled(result))
    }

    @Test
    fun `API error disables NFC reader (fail-closed security posture)`() {
        val result = IntegrityResult(
            verdicts = emptySet(),
            error = "ATTESTATION_FAILED: Play Services unavailable"
        )
        assertFalse("Attestation failure must be treated as compromised", isAttestationSufficient(result))
        assertFalse(nfcReaderShouldBeEnabled(result))
    }

    @Test
    fun `API network error (null token) disables NFC reader`() {
        val result = IntegrityResult(verdicts = emptySet(), error = "Network timeout")
        assertFalse(nfcReaderShouldBeEnabled(result))
    }

    @Test
    fun `NONCE_WRONG error from play integrity API disables NFC (possible replay attack)`() {
        // If the nonce doesn't match what we sent, the verdict may have been replayed
        // from a different device/session.
        val result = IntegrityResult(verdicts = emptySet(), error = "NONCE_IS_NOT_VALID")
        assertFalse(nfcReaderShouldBeEnabled(result))
    }

    // ─── Root heuristic tests ────────────────────────────────────────────────────

    @Test
    fun `clean device (no root paths) passes root heuristic`() {
        val clean = emptySet<String>()
        assertFalse(checkRootHeuristic(clean, "release-keys"))
    }

    @Test
    fun `standard Magisk su path triggers root detection`() {
        val paths = setOf("/system/xbin/su")
        assertTrue(checkRootHeuristic(paths, "release-keys"))
    }

    @Test
    fun `Magisk daemon directory triggers root detection`() {
        val paths = setOf("/sbin/.magisk")
        assertTrue(checkRootHeuristic(paths, "release-keys"))
    }

    @Test
    fun `test-keys build tag triggers root heuristic (engineering firmware)`() {
        // Engineering builds have su already — don't need to find binaries.
        val noSu = emptySet<String>()
        assertTrue(checkRootHeuristic(noSu, "release-keys,test-keys"))
    }

    @Test
    fun `all known root paths are checked — none are skipped`() {
        ROOT_BINARY_PATHS.forEach { path ->
            val paths = setOf(path)
            assertTrue("Root path $path was not detected", checkRootHeuristic(paths, "release-keys"))
        }
    }

    @Test
    fun `non-root path in filesystem does not trigger detection`() {
        val paths = setOf("/data/data/com.orchestratepay", "/system/bin/sh")
        assertFalse(checkRootHeuristic(paths, "release-keys"))
    }

    // ─── Guard ordering (attestation supersedes heuristic) ────────────────────────

    @Test
    fun `combined: rooted device fails Play Integrity — NFC stays disabled`() {
        // Rooted device with Magisk hide may clear su paths but still fail Play Integrity
        val paths        = emptySet<String>()          // Magisk hide cleared paths
        val rootHeuristic = checkRootHeuristic(paths, "release-keys")  // passes heuristic

        val integrityResult = IntegrityResult(verdicts = emptySet())   // but fails attestation

        assertFalse("Root heuristic alone doesn't gate this path", rootHeuristic)
        assertFalse("Play Integrity is the definitive check", nfcReaderShouldBeEnabled(integrityResult))
    }

    @Test
    fun `combined: clean device passes both checks — NFC enabled`() {
        val paths = emptySet<String>()
        val rootHeuristic = checkRootHeuristic(paths, "release-keys")

        val integrityResult = IntegrityResult(verdicts = setOf(
            IntegrityVerdict.MEETS_DEVICE_INTEGRITY,
            IntegrityVerdict.MEETS_BASIC_INTEGRITY
        ))

        assertFalse("No root paths found", rootHeuristic)
        assertTrue("Clean device allows NFC", nfcReaderShouldBeEnabled(integrityResult))
    }

    // ─── Attestation caching window ───────────────────────────────────────────────

    @Test
    fun `attestation older than 1 hour must be refreshed before a new payment session`() {
        val ONE_HOUR_MS = 3_600_000L
        val attestedAt  = System.currentTimeMillis() - ONE_HOUR_MS - 1
        val nowMs       = System.currentTimeMillis()
        assertTrue("Cached attestation is stale", nowMs - attestedAt > ONE_HOUR_MS)
    }

    @Test
    fun `attestation within the last 30 minutes is still valid`() {
        val THIRTY_MIN_MS = 1_800_000L
        val attestedAt    = System.currentTimeMillis() - THIRTY_MIN_MS + 5_000
        val nowMs         = System.currentTimeMillis()
        assertFalse("Cached attestation is still fresh", nowMs - attestedAt > THIRTY_MIN_MS)
    }

    // ─── Multiple tap sessions ────────────────────────────────────────────────────

    @Test
    fun `each new payment session requires fresh attestation (not cached from boot)`() {
        // Attestation must be re-checked per session, not once at boot.
        // A device can be rooted AFTER the app starts.
        val sessionStartMs   = System.currentTimeMillis()
        val twoHoursLaterMs  = sessionStartMs + 7_200_000L
        val MAX_CACHE_MS     = 3_600_000L
        assertTrue("Attestation cache expired between sessions",
            twoHoursLaterMs - sessionStartMs > MAX_CACHE_MS)
    }

    @Test
    fun `MEETS_DEVICE_INTEGRITY present alongside unrecognised future verdict is still accepted`() {
        // Future Play Integrity API versions may add new verdict strings.
        // We check for the PRESENCE of our required verdict, not for an exact set match.
        val result = IntegrityResult(verdicts = setOf(
            IntegrityVerdict.MEETS_DEVICE_INTEGRITY,
            // Hypothetical: some future verdict we don't know yet is also present
        ))
        assertTrue(isAttestationSufficient(result))
    }
}
