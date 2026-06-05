---
name: orchestratepay-sms-ussd-fallback
description: >
  Implement and debug the Africa's Talking SMS fallback for OrchestratePay — payment
  confirmation SMS to consumers, device alert notifications to merchants, digital receipts,
  environment configuration, sandbox vs production, and the rate-limiting deduplication
  strategy. Use this skill when SMS is not arriving, when adding a new SMS template, when
  switching from sandbox to production AT credentials, when the SMS_ENABLED flag is needed,
  or when debugging the device alert deduplication logic.
---

# OrchestratePay — SMS / USSD Fallback (`integrations/africas-talking.ts`)

## Purpose
Africa's Talking (AT) provides SMS delivery for:
1. **Payment confirmation** — consumer receives "KSh X received at Y. Ref: Z" after confirmed payment
2. **Device alerts** — merchant receives hardware alert (low paper, low battery, etc.)
3. **Digital receipts** — itemised receipt via SMS for SoftPOS transactions (Phase 4)

SMS is always **best-effort** — a send failure must never block or roll back a payment.

## `sendSms()` contract
- **Always resolves** — never throws
- Returns `{ success: boolean, messageId?: string, error?: string }`
- Callers treat it as fire-and-forget

## Message templates (`SmsTemplate`)
```typescript
SmsTemplate.paymentConfirmed(amountKsh, merchantName, mpesaRef)
// → "OrchestratePay: KSh 500.00 received at Wanjiku Shop. Ref: ODE3K5Z8. Thank you!"

SmsTemplate.paymentDeclined(amountKsh, reason)
// → "OrchestratePay: Your payment of KSh 200.00 was not completed. PIN cancelled."

SmsTemplate.deviceAlert(message)
// → "OrchestratePay Alert: Printer paper low. Log in to your dashboard for details."

SmsTemplate.digitalReceipt(amountKsh, merchantName, mpesaRef, date)
// → multiline receipt string
```

## Sandbox vs production
| Mode | `AT_USERNAME` value | Behaviour |
|---|---|---|
| Sandbox | `'sandbox'` | Messages logged, not sent; any phone number accepted |
| Production | Your AT registered username | Real SMS sent to the phone number |

AT sandbox URL: `https://api.sandbox.africastalking.com/version1/messaging`
AT production URL: `https://api.africastalking.com/version1/messaging`

The integration selects the URL automatically based on `AT_USERNAME`.

## Environment variables
| Variable | Required | Purpose |
|---|---|---|
| `AT_API_KEY` | Yes | Africa's Talking API key |
| `AT_USERNAME` | Yes | `'sandbox'` or your registered AT username |
| `AT_SENDER_ID` | Optional | Sender name on consumer's phone (max 11 chars, default `'OrchstPay'`) |
| `SMS_ENABLED` | Optional | Set `'false'` to disable all SMS without redeploying |

## Rate limiting / deduplication
Device alerts are deduplicated at the DB level:
```sql
UNIQUE(device_id, message, date_trunc('hour', created_at))
```
The same alert (e.g. "low paper") cannot fire more than once per hour per device — no
additional logic needed in `sendSms()`.

## Disabling SMS
Set `SMS_ENABLED=false` to stop all SMS globally without a redeploy.
`sendSms()` returns `{ success: true, messageId: 'sms-disabled' }` in this case —
calling code does not need to check the flag.

## `AT_SENDER_ID` constraints
- Max 11 characters
- Alphanumeric only (no spaces on some networks)
- Must be registered with AT for production use (approval takes 1–3 business days)
- Default `'OrchstPay'` is pre-approved

## Common failures
| Symptom | Cause | Fix |
|---|---|---|
| SMS not sending, no error | `SMS_ENABLED=false` | Remove or set `SMS_ENABLED=true` |
| SMS not sending, credentials warning | `AT_API_KEY` or `AT_USERNAME` not set | Set both env vars |
| `"status": "UserInBlacklist"` | Consumer's number is on AT blacklist | Consumer must opt back in via AT portal |
| SMS arrives with wrong sender name | `AT_SENDER_ID` not matching AT registration | Update env var to match registered sender ID |
| Sandbox SMS not visible anywhere | AT sandbox just logs internally — normal | Use AT sandbox dashboard to see sent messages |
