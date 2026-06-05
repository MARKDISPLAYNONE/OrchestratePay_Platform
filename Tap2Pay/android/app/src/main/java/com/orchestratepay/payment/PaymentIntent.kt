package com.orchestratepay.payment

/**
 * PaymentIntent — the handoff object between the NFC layer and the financial orchestrator.
 *
 * This is the ONLY data that crosses the boundary between the two layers.
 * The NFC layer creates it; the orchestrator consumes it.
 *
 * Design principle: PaymentIntent contains IDENTITY information (who tapped, which
 * merchant) but NOT financial decisions (how much, which account to charge).
 * Those are the orchestrator's job.
 *
 * @param source        How the payment was initiated
 * @param merchantId    Resolved merchant identifier
 * @param tagId         OrchestratePay tag UUID (NFC_TAG / QR_CODE flows only)
 * @param rawUid        Raw NFC hardware UID (CBK audit log — not used for routing)
 * @param timestamp     When the tap occurred (millis) — used in idempotency key
 * @param consumerPhone Pre-resolved phone number from HCE APDU (HCE_PHONE flow only)
 * @param hceToken      HMAC session token from wallet app — backend verifies before trusting phone
 * @param hceExp        Token expiry epoch millis — backend rejects if past
 * @param consumerId    Consumer UUID from a consumer-written tag (CONSUMER_TAG flow only)
 */
data class PaymentIntent(
    val source: PaymentSource,
    val merchantId: String,
    val tagId: String? = null,
    val rawUid: String? = null,
    val timestamp: Long = System.currentTimeMillis(),
    // HCE_PHONE fields — only populated when source = HCE_PHONE
    val consumerPhone: String? = null,
    val hceToken: String? = null,
    val hceExp: Long? = null,
    // CONSUMER_TAG fields — only populated when source = CONSUMER_TAG
    val consumerId: String? = null
)

/** How the payment was initiated */
enum class PaymentSource {
    NFC_TAG,      // Merchant-programmed consumer identity sticker (orchestratepay:// URI)
    QR_CODE,      // QR code fallback — for phones without NFC
    ISO_CARD,     // Bank card via IsoDep — requires PCI MPoC cert before enabling
    HCE_PHONE,    // Customer phone acting as NFC card via Host Card Emulation
    CONSUMER_TAG  // Consumer-written identity sticker (https://orchestratepay.co.ke/c/{id})
}

/**
 * PaymentResult — sealed class representing every possible outcome of a payment attempt.
 *
 * Sealed classes are perfect here because:
 *   - The compiler forces the UI to handle every case (no forgotten error states)
 *   - Each variant carries only the data relevant to that outcome
 *   - No null checks needed — if it's Success, receipt is always non-null
 */
sealed class PaymentResult {

    /** Payment confirmed and settled — show success screen and print receipt */
    data class Success(
        val txnId: String,
        val mpesaRef: String,        // M-Pesa receipt number (e.g. "NLJ7RT61SV")
        val amountCents: Long,       // amount in KSh cents (e.g. 50000 = KSh 500.00)
        val merchantName: String,
        val consumerPhone: String,   // masked for display (e.g. "2547****5678")
        val confirmedAt: Long = System.currentTimeMillis()
    ) : PaymentResult()

    /** Consumer cancelled, insufficient funds, wrong PIN, etc. */
    data class Declined(
        val reason: String,          // user-friendly message (not raw M-Pesa code)
        val mpesaCode: Int? = null   // raw code for audit log
    ) : PaymentResult()

    /** Network error, server error, or timeout — merchant should retry */
    data class Failed(
        val reason: String,
        val retryable: Boolean = true
    ) : PaymentResult()

    /** STK Push sent — waiting for consumer to enter PIN */
    data class Pending(
        val txnId: String,
        val message: String = "Waiting for customer to approve..."
    ) : PaymentResult()
}
