# OrchestratePay Android Printer

Authoritative reference for the Sunmi P2 Pro thermal printer integration. Covers printer states, bitmap receipt rendering, VAT line item formatting, Z-Report printing, AIDL vs bitmap approach, initialisation, and error recovery.

Key file: `Tap2Pay/android/app/src/main/java/com/orchestratepay/printer/SunmiPrinterManager.kt`

## Hardware Context

The Sunmi P2 Pro is a handheld Android POS device with a **built-in 58mm thermal printer**. It is used by `app/` (the merchant terminal app). The SoftPOS module (`softpos/`) does not have a printer — receipts on SoftPOS must be delivered via SMS or push notification.

58mm thermal paper at 203 DPI = **384 pixels wide**. All receipt bitmaps are rendered at exactly 384px width. Font sizes and layout coordinates are tuned for this width — do not change `PAPER_WIDTH_PX` without re-tuning all `canvas.drawText()` y-coordinates.

## Printer States

Defined as a Kotlin sealed class:

```kotlin
sealed class PrinterState {
    object Ready        : PrinterState()
    object LowPaper     : PrinterState()    // < ~20mm of paper remaining
    object OutOfPaper   : PrinterState()    // no paper — print will fail
    object Overheating  : PrinterState()    // thermal head too hot — wait ~30s
    object Disconnected : PrinterState()    // AIDL service not bound
    data class Error(val code: Int, val description: String) : PrinterState()
}
```

Sunmi AIDL status codes (from `IWoyouService.getPrinterStatus()`):

| Code | State | Meaning |
|---|---|---|
| `1` | `Ready` | Normal operation |
| `2` | — | Preparing (transient; retry after 500ms) |
| `3` | `Error` | Abnormal communications |
| `4` | `OutOfPaper` | No paper — print will fail |
| `5` | `Overheating` | Thermal head overheated — wait ~30 seconds |
| `6` | `Error` | Open cover |
| `7` | `Error` | Paper cutting error |
| `8` | `Error` | Paper feed error |
| `9` | — | Reserved |
| `505` | `Disconnected` | AIDL service not bound |

`lastPrinterStatus` is a `@Volatile Int` companion field updated by the AIDL binding callback. `DeviceTelemetryCollector` reads it for fleet telemetry reporting (`POST /api/v1/devices/telemetry`).

## PrintResult

```kotlin
sealed class PrintResult {
    object Success                                             : PrintResult()
    data class Failed(val state: PrinterState, val message: String) : PrintResult()
}
```

**Critical invariant**: printer failure must **never** block, reverse, or delay a confirmed payment. `printReceipt()` returns a `PrintResult` — the caller shows a UI warning for `Failed` but the payment is already confirmed in the backend. Never gate payment completion on `PrintResult.Success`.

## Initialisation (AIDL Binding)

The Sunmi inner printer is accessed via AIDL (Android Interface Definition Language), an IPC mechanism for system service communication on the same device.

```kotlin
// Intended binding (not yet fully wired — see Known Gaps below)
val intent = Intent()
intent.setPackage("com.sunmi.innerprinter")
intent.action = "com.sunmi.aidl.PrinterService"
context.bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE)

// serviceConnection.onServiceConnected:
mIWoyouService = IWoyouService.Stub.asInterface(service)
mIWoyouService?.initPrinter()  // resets printer state before use
```

The AIDL interface definition files (`IWoyouService.aidl`, `ICallback.aidl`) must be downloaded from `developer.sunmi.com` and placed in `app/src/main/aidl/`. Until they are added, `SunmiPrinterManager` uses a **bitmap broadcast approach** (see below).

`checkPrinterState()` is a `suspend fun` to allow it to be called from a coroutine context without blocking the main thread. The current implementation is a stub returning `PrinterState.Ready` — the real AIDL call will be asynchronous.

## Bitmap vs. AIDL Text Commands

There are two ways to print on Sunmi devices:

### Option 1: AIDL Text Commands (not yet implemented)
Call `IWoyouService` methods directly:
```kotlin
mIWoyouService?.printText("Hello World\n")
mIWoyouService?.setAlignCenter()
mIWoyouService?.printBitmap(bitmap, null)
mIWoyouService?.cutPaper()
```
Pros: simplest API, native font rendering. Cons: depends on woyou-aidl-definitions being present.

### Option 2: Bitmap Rendering (current implementation)
Render the entire receipt as a `Bitmap` using the Android `Canvas` API, then send the bitmap to the printer.

```kotlin
val bitmap = Bitmap.createBitmap(PAPER_WIDTH_PX, height, Bitmap.Config.ARGB_8888)
val canvas = Canvas(bitmap)
canvas.drawColor(android.graphics.Color.WHITE)
// ... draw text, lines, etc.
printBitmap(bitmap)
```

Pros: full layout control, consistent fonts regardless of printer firmware, works on any printer that accepts a bitmap (including future Bluetooth printers). Cons: larger data transfer than text commands.

The current `printBitmap()` implementation is a **stub** that logs the bitmap dimensions:
```kotlin
android.util.Log.d("SunmiPrinter", "Receipt rendered: ${bitmap.width}x${bitmap.height}px")
```
Replace with the real broadcast or AIDL call before production.

## Receipt Layout (`printReceipt`)

Entry point:
```kotlin
suspend fun printReceipt(result: PaymentResult.Success, kraPin: String? = null): PrintResult
```

The `kraPin` parameter is the merchant's Kenya Revenue Authority PIN for CBK-compliant Electronic Tax Register (ETR) receipts. When `null`, the KRA block is omitted and the receipt height is 520px. When provided, VAT is broken out and height is 560px.

### Layout (bitmap coordinates, y-axis top-to-bottom)

```
y=48    Merchant name          — 28sp bold, centred
y=64    Separator line
y=130   Amount (KSh X.XX)      — 48sp bold, centred
y=175   "M-Pesa Ref:" label    — 20sp monospace, centred
y=205   <mpesaRef>             — 24sp monospace, centred
y=245   Date/time              — 18sp regular, centred
y=275   "Phone: 254***3456"    — 18sp regular, centred (masked)
y=305   "Txn: <first16>..."    — 14sp monospace, centred (truncated)

--- KRA ETR block (when kraPin != null) ---
y=335   "Net (excl. VAT):"     left    "KSh X.XX"  right
y=357   "VAT (16%):"           left    "KSh X.XX"  right
y=379   "KRA PIN: <kraPin>"    centred
y=395   Separator line

--- Footer ---
y=footerY     "Powered by OrchestratePay"
y=footerY+24  "support@orchestratepay.co.ke"
```

### VAT Calculation

Kenya standard VAT rate is 16%. The total is VAT-inclusive (consumer pays KSh X which includes VAT):

```kotlin
companion object {
    private const val VAT_RATE = 0.16

    fun vatFromInclusive(totalCents: Long): Long =
        (totalCents * (VAT_RATE / (1 + VAT_RATE))).toLong()
}
```

Formula: `VAT = total × (0.16 / 1.16)`. Net = `total − VAT`.

Example for KSh 1,000 (100,000 cents):
- VAT = 100000 × (0.16/1.16) = 13,793 cents = KSh 137.93
- Net = 100000 − 13793 = 86,207 cents = KSh 862.07

The formula uses integer truncation (`toLong()`), which rounds VAT down. The receipt may show VAT + Net ≠ Total by 1 cent due to rounding — this is acceptable per KRA guidelines.

### Text rendering helpers (private to `renderReceiptBitmap`)

```kotlin
fun centreText(text: String, y: Float, size: Float, bold: Boolean = false)
fun leftText(text: String, y: Float, size: Float)
fun rightText(text: String, y: Float, size: Float, bold: Boolean = false)
fun separator(y: Float)    // horizontal line at y, MARGIN_PX inset from each side
```

`MARGIN_PX = 16`. All coordinates use the paint's text baseline (not the top of the text box).

## Z-Report Layout (`printZReport`)

Entry point:
```kotlin
suspend fun printZReport(report: ZReportResponse): PrintResult
```

The Z-Report is a daily closing summary printed when the merchant ends their shift. Height: 560px.

```
y=42    Merchant name         — 26sp bold, centred
y=68    "Z-REPORT — DAILY SUMMARY"   18sp, centred
y=90    Report date           — 18sp, centred
y=102   Separator

y=132   "Confirmed Payments"  left    count  right
y=158   "Total Revenue"       left    "KSh X.XX" right (bold)
y=172   Separator

y=198   "Declined"            left    count  right   16sp
y=220   "Failed / Timeout"    left    count  right   16sp
y=234   Separator

y=260   "Total Transactions"  left    total  right   (bold)
y=274   Separator

y=304   "First txn"           left    "HH:mm"  right
y=324   "Last txn"            left    "HH:mm"  right
y=338   Separator

y=370   "OrchestratePay"
y=392   "Printed DD MMM YYYY HH:mm"
```

First/last transaction times are parsed from ISO timestamps (`yyyy-MM-dd'T'HH:mm:ss`) and formatted as `HH:mm`. If `firstTxnAt` or `lastTxnAt` is null, `"--:--"` is displayed.

`report.transactions.confirmed.totalCents` is formatted as `KSh %.2f`:
```kotlin
fun formatKsh(cents: Long) = "KSh ${"%.2f".format(cents / 100.0)}"
```

## Pre-Print State Check

Both `printReceipt()` and `printZReport()` call `checkPrinterState()` before rendering or sending. The logic:

| State | Action |
|---|---|
| `OutOfPaper` | Return `PrintResult.Failed` immediately — do not render |
| `Disconnected` | Return `PrintResult.Failed` immediately — do not render |
| `LowPaper` | Proceed with print; log a warning after |
| `Overheating` | Proceed (Sunmi AIDL will queue and retry) — log warning before |
| `Ready` | Proceed normally |
| `Error(code, desc)` | Proceed (let AIDL surface the error) |

After printing, `printReceipt()` re-checks state for `LowPaper` and logs a warning so the merchant can be prompted to replace paper before the next customer.

## Error Recovery

### "Printer is out of paper"

State: `PrinterState.OutOfPaper`. The merchant must physically reload the paper roll. After reloading, the AIDL service automatically resets the status to `Ready` (Sunmi resets on cover close). No app restart required.

The payment is already confirmed — offer the merchant a "Reprint" button that calls `printReceipt()` again with the same `PaymentResult.Success`. There is no limit on reprints.

### "Printer is overheating"

State: `PrinterState.Overheating`. Wait 30 seconds before retrying. The thermal print head overheats after rapid consecutive prints (e.g., Z-Report immediately after high-volume trading). The UI should show a 30-second countdown and automatically retry.

### AIDL service not bound (`Disconnected`)

The Sunmi inner printer service (`com.sunmi.innerprinter`) may not be running if:
- The device was just started and the service hasn't initialised yet (wait 5–10 seconds)
- The Sunmi system app was force-stopped (restart device)
- The AIDL intent action or package name is wrong (check `developer.sunmi.com` docs for the current firmware's service name)

### Print appears garbled or cut off

The bitmap is too tall for the paper roll remaining. The Sunmi cuts the paper at the end of the print job regardless of bitmap height. Ensure the bitmap height matches the layout constants (520px normal, 560px with KRA block). Do not dynamically expand the height without adjusting all y-coordinates.

### Receipt cuts mid-line

The bitmap does not have enough bottom padding. The `printBitmap()` stub comment notes "Feed 3 blank lines so the receipt is easy to tear off." In the real AIDL implementation, call `lineWrap(3)` after `printBitmap()` to add paper feed before the cut.

## Known Gaps Before Production

| Gap | Impact | Fix |
|---|---|---|
| `printBitmap()` is a stub (logs, does not print) | No physical receipts | Implement via Sunmi AIDL binding or broadcast intent |
| `checkPrinterState()` always returns `Ready` | No paper/overheat warnings shown to merchant | Implement real AIDL `getPrinterStatus()` call |
| AIDL definition files not present | Cannot use `IWoyouService` API at all | Download `woyou-aidl-definitions` from developer.sunmi.com, place in `app/src/main/aidl/` |
| `lastPrinterStatus` not updated | Telemetry always reports status=1 (Ready) | Wire AIDL status callback to update `lastPrinterStatus` |
| No reprint UI | Merchant cannot reprint a receipt after paper out | Add "Reprint Last Receipt" button in terminal UI, storing last `PaymentResult.Success` in memory |

## Integration with Device Telemetry

`DeviceTelemetryCollector` (in `app/`) reads `SunmiPrinterManager.lastPrinterStatus` when sending telemetry to `POST /api/v1/devices/telemetry`. The backend stores this in `devices.last_telemetry` JSONB so the fleet admin can see which terminals are low on paper before a field visit.

Once `checkPrinterState()` is implemented with real AIDL calls, update the companion field:
```kotlin
// In AIDL service binding callback:
override fun onPrinterStatusChanged(status: Int) {
    SunmiPrinterManager.lastPrinterStatus = status
}
```
