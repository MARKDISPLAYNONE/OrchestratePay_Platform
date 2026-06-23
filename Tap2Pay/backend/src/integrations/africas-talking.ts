/**
 * africas-talking.ts — Africa's Talking SMS client.
 *
 * Used for:
 *   1. Device alert notifications to merchants (low paper, low battery, etc.)
 *   2. Payment confirmation SMS to consumers (opt-in only)
 *   3. Digital receipts for SoftPOS transactions (Phase 4)
 *
 * Environment variables:
 *   AT_API_KEY    — Africa's Talking API key
 *   AT_USERNAME   — 'sandbox' or your registered AT username
 *   AT_SENDER_ID  — Short sender ID (max 11 chars, e.g. "OrchstPay")
 *   SMS_ENABLED   — Feature flag; set to 'false' to disable without redeploy
 *
 * The AT sandbox accepts any phone number and logs delivery without sending real SMS.
 * Flip AT_USERNAME to your registered username for production.
 *
 * Rate limiting: relies on the device_alerts DB deduplication
 * (UNIQUE on device_id + message + date_trunc('hour', created_at)) so the same
 * alert never fires more than once per hour per device without extra logic here.
 */
import { logger } from '../util/logger'

interface SmsResult {
    success:  boolean
    messageId?: string
    error?:   string
}

/**
 * sendSms — fire-and-forget SMS wrapper.
 *
 * Always resolves (never throws). Callers must treat SMS as best-effort —
 * a delivery failure must never block a payment confirmation or alert write.
 */
export async function sendSms(to: string, message: string): Promise<SmsResult> {
    if (process.env.SMS_ENABLED === 'false') {
        logger.debug('SMS disabled via SMS_ENABLED flag', { to: maskPhone(to) })
        return { success: true, messageId: 'sms-disabled' }
    }

    const apiKey   = process.env.AT_API_KEY
    const username = process.env.AT_USERNAME
    const senderId = process.env.AT_SENDER_ID ?? 'OrchstPay'

    if (!apiKey || !username) {
        logger.warn('AT_API_KEY or AT_USERNAME not set — SMS skipped', { to: maskPhone(to) })
        return { success: false, error: 'AT credentials not configured' }
    }

    try {
        const body = new URLSearchParams({
            username,
            to,
            message,
            from: senderId,
        })

        const baseUrl = username === 'sandbox'
            ? 'https://api.sandbox.africastalking.com/version1/messaging'
            : 'https://api.africastalking.com/version1/messaging'

        const response = await fetch(baseUrl, {
            method:  'POST',
            headers: {
                'apiKey':       apiKey,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept':       'application/json',
            },
            body: body.toString(),
            signal: AbortSignal.timeout(8_000),
        })

        const json = await response.json().catch(() => ({})) as Record<string, unknown>
        const smsData = (json?.SMSMessageData as { Recipients?: Array<{ status?: string; messageId?: string }> } | undefined)
        const entry = smsData?.Recipients?.[0]

        if (response.ok && entry?.status === 'Success') {
            logger.info('SMS sent', { to: maskPhone(to), messageId: entry.messageId })
            return { success: true, messageId: entry.messageId }
        }

        const error = entry?.status ?? `HTTP ${response.status}`
        logger.warn('SMS delivery failed', { to: maskPhone(to), error })
        return { success: false, error }

    } catch (err: unknown) {
        logger.error('SMS send threw', { to: maskPhone(to), error: (err as Error).message })
        return { success: false, error: (err as Error).message }
    }
}

/**
 * Templates — keeps message copy in one place.
 */
export const SmsTemplate = {
    paymentConfirmed: (amountKsh: number, merchantName: string, mpesaRef: string) =>
        `OrchestratePay: KSh ${amountKsh.toFixed(2)} received at ${merchantName}. Ref: ${mpesaRef}. Thank you!`,

    paymentDeclined: (amountKsh: number, reason: string) =>
        `OrchestratePay: Your payment of KSh ${amountKsh.toFixed(2)} was not completed. ${reason}`,

    deviceAlert: (message: string) =>
        `OrchestratePay Alert: ${message}. Log in to your dashboard for details.`,

    digitalReceipt: (amountKsh: number, merchantName: string, mpesaRef: string, date: string) =>
        `OrchestratePay Receipt\nMerchant: ${merchantName}\nAmount: KSh ${amountKsh.toFixed(2)}\nRef: ${mpesaRef}\nDate: ${date}\nPowered by OrchestratePay`,

    kycApproved: (merchantName: string) =>
        `OrchestratePay: Great news! Your merchant account "${merchantName}" has been approved. Login to start accepting NFC payments: https://pay.orchestratepay.co.ke`,

    kycRejected: (merchantName: string, reason: string) =>
        `OrchestratePay: KYC verification for "${merchantName}" was unsuccessful. Reason: ${reason}. Please login to resubmit documents or contact support@orchestratepay.co.ke`,

    kycUnderReview: (merchantName: string) =>
        `OrchestratePay: We've received your KYC documents for "${merchantName}" and they are under review. Expect a response within 1-2 business days.`,

    kycDocsReceived: (merchantName: string, missingCount: number) =>
        missingCount > 0
            ? `OrchestratePay: Document received for "${merchantName}". You still have ${missingCount} required document(s) to submit. Login to complete KYC.`
            : `OrchestratePay: All required KYC documents received for "${merchantName}"! Our team will review shortly.`,
}

function maskPhone(phone: string): string {
    return phone.length >= 7
        ? phone.slice(0, 5) + '****' + phone.slice(-2)
        : '****'
}
