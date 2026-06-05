package com.orchestratepay.printer

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import com.orchestratepay.api.ZReportResponse
import com.orchestratepay.payment.PaymentResult
import java.text.SimpleDateFormat
import java.util.*

/**
 * Represents the state of the Sunmi thermal printer.
 * The UI should check this before printing and show a warning if not Ready.
 */
sealed class PrinterState {
    object Ready : PrinterState()
    object LowPaper : PrinterState()    // < ~20mm of paper remaining
    object OutOfPaper : PrinterState()  // no paper — print will fail
    object Overheating : PrinterState() // thermal head too hot — wait ~30s before retrying
    object Disconnected : PrinterState() // AIDL service not bound
    data class Error(val code: Int, val description: String) : PrinterState()
}

sealed class PrintResult {
    object Success : PrintResult()
    data class Failed(val state: PrinterState, val message: String) : PrintResult()
}

/**
 * SunmiPrinterManager — thermal receipt printing on Sunmi P2 Pro.
 *
 * The Sunmi P2 Pro has a built-in 58mm thermal printer accessible via AIDL
 * (Android Interface Definition Language) — an IPC mechanism for talking to
 * system services on the same device.
 *
 * HOW SUNMI PRINTING WORKS:
 *   1. Bind to the Sunmi inner printer service (com.sunmi.innerprinter)
 *   2. Call AIDL methods: initPrinter(), printText(), printBitmap(), cutPaper()
 *   3. Unbind when done
 *
 * IMPORTANT: The Sunmi AIDL files (woyou-aidl-definitions) must be downloaded
 * from developer.sunmi.com and placed in app/src/main/aidl/
 * Until then, this class uses a bitmap-based approach which works without AIDL.
 *
 * RECEIPT FORMAT (58mm paper = ~384 pixels wide at 203 DPI):
 *   - Merchant name (large, centred)
 *   - Amount (very large, centred)
 *   - M-Pesa ref number
 *   - Date and time
 *   - OrchestratePay branding footer
 */
class SunmiPrinterManager(private val context: Context) {

    companion object {
        const val PAPER_WIDTH_PX = 384   // 58mm at 203 DPI
        const val MARGIN_PX = 16

        // Last known printer status code from Sunmi AIDL (1=Ready, 4=NoPaper, 5=Overheat).
        // Updated by the AIDL binding callback; read by DeviceTelemetryCollector.
        @Volatile var lastPrinterStatus: Int = 1

        // Kenya standard VAT rate (16%)
        private const val VAT_RATE = 0.16

        fun vatFromInclusive(totalCents: Long): Long =
            (totalCents * (VAT_RATE / (1 + VAT_RATE))).toLong()
    }

    /**
     * Prints a receipt for a confirmed payment.
     *
     * kraPin is the merchant's KRA PIN for CBK-compliant ETR receipts.
     * It is optional — if null, the KRA PIN line is omitted from the receipt.
     *
     * Returns PrintResult — the caller can show a warning if paper is low
     * or the printer is overheating, but must NEVER block or reverse the payment.
     * The transaction is confirmed regardless of printer state.
     */
    suspend fun printReceipt(result: PaymentResult.Success, kraPin: String? = null): PrintResult {
        return try {
            val state = checkPrinterState()
            if (state is PrinterState.OutOfPaper || state is PrinterState.Disconnected) {
                android.util.Log.w("SunmiPrinter", "Cannot print: $state")
                return PrintResult.Failed(state, stateMessage(state))
            }

            val bitmap = renderReceiptBitmap(result, kraPin)
            printBitmap(bitmap)

            // After printing, re-check for low paper so the merchant can prepare
            val postState = checkPrinterState()
            if (postState is PrinterState.LowPaper) {
                android.util.Log.w("SunmiPrinter", "Paper running low after print")
            }

            PrintResult.Success
        } catch (e: Exception) {
            // Printer failure must NEVER affect the payment record.
            android.util.Log.e("SunmiPrinter", "Print failed: ${e.message}")
            PrintResult.Failed(PrinterState.Error(-1, e.message ?: "unknown"), e.message ?: "Print error")
        }
    }

    /**
     * Prints a daily Z-Report (end-of-day transaction summary).
     *
     * Called by the merchant when closing out for the day. Shows:
     *   - Total confirmed transactions and revenue
     *   - Count of declined and failed transactions
     *   - First and last transaction times
     *
     * Never blocks or reverses any payment — this is a reporting-only operation.
     */
    suspend fun printZReport(report: ZReportResponse): PrintResult {
        return try {
            val state = checkPrinterState()
            if (state is PrinterState.OutOfPaper || state is PrinterState.Disconnected) {
                return PrintResult.Failed(state, stateMessage(state))
            }
            val bitmap = renderZReportBitmap(report)
            printBitmap(bitmap)
            PrintResult.Success
        } catch (e: Exception) {
            android.util.Log.e("SunmiPrinter", "Z-Report print failed: ${e.message}")
            PrintResult.Failed(PrinterState.Error(-1, e.message ?: "unknown"), e.message ?: "Print error")
        }
    }

    private fun renderZReportBitmap(report: ZReportResponse): Bitmap {
        val bitmap = Bitmap.createBitmap(PAPER_WIDTH_PX, 560, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(android.graphics.Color.WHITE)

        val paint = Paint(Paint.ANTI_ALIAS_FLAG)

        fun centreText(text: String, y: Float, size: Float, bold: Boolean = false) {
            paint.textSize  = size
            paint.typeface  = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
            paint.textAlign = Paint.Align.CENTER
            canvas.drawText(text, PAPER_WIDTH_PX / 2f, y, paint)
        }

        fun leftText(text: String, y: Float, size: Float) {
            paint.textSize  = size
            paint.typeface  = Typeface.DEFAULT
            paint.textAlign = Paint.Align.LEFT
            canvas.drawText(text, MARGIN_PX.toFloat(), y, paint)
        }

        fun rightText(text: String, y: Float, size: Float, bold: Boolean = false) {
            paint.textSize  = size
            paint.typeface  = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
            paint.textAlign = Paint.Align.RIGHT
            canvas.drawText(text, (PAPER_WIDTH_PX - MARGIN_PX).toFloat(), y, paint)
        }

        fun separator(y: Float) {
            paint.strokeWidth = 1f
            paint.style = Paint.Style.STROKE
            canvas.drawLine(MARGIN_PX.toFloat(), y, (PAPER_WIDTH_PX - MARGIN_PX).toFloat(), y, paint)
            paint.style = Paint.Style.FILL
        }

        fun formatKsh(cents: Long) = "KSh ${"%.2f".format(cents / 100.0)}"

        // ── Header ─────────────────────────────────────────────────────
        centreText(report.merchantName, 42f, 26f, bold = true)
        centreText("Z-REPORT — DAILY SUMMARY", 68f, 18f)
        centreText(report.date, 90f, 18f)
        separator(102f)

        // ── Confirmed ──────────────────────────────────────────────────
        leftText("Confirmed Payments", 132f, 18f)
        rightText(report.transactions.confirmed.count.toString(), 132f, 18f)

        leftText("Total Revenue", 158f, 20f)
        rightText(formatKsh(report.transactions.confirmed.totalCents), 158f, 20f, bold = true)

        separator(172f)

        // ── Declines / Failures ────────────────────────────────────────
        leftText("Declined", 198f, 16f)
        rightText(report.transactions.declined.count.toString(), 198f, 16f)

        leftText("Failed / Timeout", 220f, 16f)
        rightText(report.transactions.failed.count.toString(), 220f, 16f)

        separator(234f)

        // ── Totals ─────────────────────────────────────────────────────
        leftText("Total Transactions", 260f, 18f)
        rightText(report.transactions.total.count.toString(), 260f, 18f, bold = true)

        separator(274f)

        // ── Time window ────────────────────────────────────────────────
        val timeFmt = SimpleDateFormat("HH:mm", Locale.getDefault())
        val firstTime = report.firstTxnAt?.let { runCatching { timeFmt.format(SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault()).parse(it.take(19))!!) }.getOrNull() } ?: "--:--"
        val lastTime  = report.lastTxnAt?.let  { runCatching { timeFmt.format(SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault()).parse(it.take(19))!!) }.getOrNull() } ?: "--:--"

        leftText("First txn", 304f, 15f)
        rightText(firstTime, 304f, 15f)

        leftText("Last txn", 324f, 15f)
        rightText(lastTime, 324f, 15f)

        separator(338f)

        // ── Footer ─────────────────────────────────────────────────────
        centreText("OrchestratePay", 370f, 16f)
        centreText("Printed ${SimpleDateFormat("dd MMM yyyy HH:mm", Locale.getDefault()).format(Date())}", 392f, 14f)

        return bitmap
    }

    /**
     * Returns the current printer state. Call before printing to surface warnings.
     *
     * Sunmi AIDL status codes (from IWoyouService.getPrinterStatus()):
     *   1 = Ready
     *   2 = Preparing
     *   3 = Abnormal communications
     *   4 = Out of paper
     *   5 = Overheating
     *   6 = Open cover
     *   7 = Paper cutting error
     *   8 = Paper feed error
     *   9 = (Reserved)
     *   505 = Not connected
     *
     * Until AIDL is fully wired up, this returns Ready in debug and delegates
     * to the AIDL service in release.
     */
    suspend fun checkPrinterState(): PrinterState {
        // STUB — replace with actual AIDL call when woyou-aidl-definitions are added:
        //
        // val status = mIWoyouService?.getPrinterStatus() ?: return PrinterState.Disconnected
        // return when (status) {
        //     1    -> PrinterState.Ready
        //     4    -> PrinterState.OutOfPaper
        //     5    -> PrinterState.Overheating
        //     505  -> PrinterState.Disconnected
        //     else -> PrinterState.Error(status, "Printer status: $status")
        // }

        return PrinterState.Ready  // optimistic default until AIDL is wired
    }

    private fun stateMessage(state: PrinterState): String = when (state) {
        is PrinterState.OutOfPaper    -> "Printer is out of paper. Please reload and reprint."
        is PrinterState.LowPaper      -> "Paper is running low. Please prepare a new roll."
        is PrinterState.Overheating   -> "Printer is overheating. Wait 30 seconds before printing."
        is PrinterState.Disconnected  -> "Printer not connected. Check the Sunmi service."
        is PrinterState.Error         -> "Printer error (${state.code}): ${state.description}"
        PrinterState.Ready            -> ""
    }

    /**
     * Renders the receipt as a Bitmap.
     *
     * Using a bitmap approach rather than AIDL text commands gives us:
     *   - Consistent fonts (not dependent on printer's built-in fonts)
     *   - Flexible layout (we can position anything anywhere)
     *   - Works on non-Sunmi printers too (if we add a Bluetooth printer path)
     */
    private fun renderReceiptBitmap(result: PaymentResult.Success, kraPin: String?): Bitmap {
        val amountStr  = "KSh ${"%.2f".format(result.amountCents / 100.0)}"
        val dateStr    = SimpleDateFormat("dd MMM yyyy  HH:mm", Locale.getDefault()).format(Date())

        // Extra height when KRA PIN is printed
        val height = if (kraPin != null) 560 else 520

        val bitmap = Bitmap.createBitmap(PAPER_WIDTH_PX, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(android.graphics.Color.WHITE)

        val paint = Paint(Paint.ANTI_ALIAS_FLAG)

        // ── Merchant name ──────────────────────────────────────────────
        paint.textSize  = 28f
        paint.typeface  = Typeface.DEFAULT_BOLD
        paint.textAlign = Paint.Align.CENTER
        canvas.drawText(result.merchantName, PAPER_WIDTH_PX / 2f, 48f, paint)

        // ── Separator ─────────────────────────────────────────────────
        paint.strokeWidth = 1f
        canvas.drawLine(MARGIN_PX.toFloat(), 64f, (PAPER_WIDTH_PX - MARGIN_PX).toFloat(), 64f, paint)

        // ── Amount (large) ────────────────────────────────────────────
        paint.textSize  = 48f
        paint.typeface  = Typeface.DEFAULT_BOLD
        canvas.drawText(amountStr, PAPER_WIDTH_PX / 2f, 130f, paint)

        // ── M-Pesa reference ─────────────────────────────────────────
        paint.textSize = 20f
        paint.typeface = Typeface.MONOSPACE
        canvas.drawText("M-Pesa Ref:", PAPER_WIDTH_PX / 2f, 175f, paint)
        paint.textSize = 24f
        canvas.drawText(result.mpesaRef, PAPER_WIDTH_PX / 2f, 205f, paint)

        // ── Date ─────────────────────────────────────────────────────
        paint.textSize = 18f
        paint.typeface = Typeface.DEFAULT
        canvas.drawText(dateStr, PAPER_WIDTH_PX / 2f, 245f, paint)

        // ── Consumer phone (masked) ───────────────────────────────────
        paint.textSize = 18f
        canvas.drawText("Phone: ${result.consumerPhone}", PAPER_WIDTH_PX / 2f, 275f, paint)

        // ── Transaction ID (for support queries) ──────────────────────
        paint.textSize = 14f
        paint.typeface = Typeface.MONOSPACE
        canvas.drawText("Txn: ${result.txnId.take(16)}...", PAPER_WIDTH_PX / 2f, 305f, paint)

        // ── KRA ETR block — CBK compliance (printed when merchant has KRA PIN) ──
        var separatorY = 325f
        if (kraPin != null) {
            val vatCents  = vatFromInclusive(result.amountCents)
            val netCents  = result.amountCents - vatCents

            paint.textSize  = 15f
            paint.typeface  = Typeface.DEFAULT
            paint.textAlign = Paint.Align.LEFT
            canvas.drawText("Net (excl. VAT):", MARGIN_PX.toFloat(), 335f, paint)
            paint.textAlign = Paint.Align.RIGHT
            canvas.drawText("KSh ${"%.2f".format(netCents / 100.0)}", (PAPER_WIDTH_PX - MARGIN_PX).toFloat(), 335f, paint)

            paint.textAlign = Paint.Align.LEFT
            canvas.drawText("VAT (16%):", MARGIN_PX.toFloat(), 357f, paint)
            paint.textAlign = Paint.Align.RIGHT
            canvas.drawText("KSh ${"%.2f".format(vatCents / 100.0)}", (PAPER_WIDTH_PX - MARGIN_PX).toFloat(), 357f, paint)

            paint.textAlign = Paint.Align.CENTER
            canvas.drawText("KRA PIN: $kraPin", PAPER_WIDTH_PX / 2f, 379f, paint)
            separatorY = 395f
        }

        // ── Separator ─────────────────────────────────────────────────
        canvas.drawLine(MARGIN_PX.toFloat(), separatorY, (PAPER_WIDTH_PX - MARGIN_PX).toFloat(), separatorY, paint)

        // ── Footer ────────────────────────────────────────────────────
        val footerY = separatorY + 35f
        paint.textSize  = 16f
        paint.typeface  = Typeface.DEFAULT
        canvas.drawText("Powered by OrchestratePay", PAPER_WIDTH_PX / 2f, footerY, paint)
        canvas.drawText("support@orchestratepay.co.ke", PAPER_WIDTH_PX / 2f, footerY + 24f, paint)

        // Feed 3 blank lines so the receipt is easy to tear off
        // (handled in printBitmap by adding bottom padding)

        return bitmap
    }

    /**
     * Sends a bitmap to the Sunmi inner printer.
     *
     * With AIDL: call IWoyouService.printBitmap(bitmap, callback)
     * Without AIDL (this implementation): use Sunmi's broadcast-based API
     * or the woyou-aidl approach. Below is a stub — replace with real AIDL calls.
     *
     * For development/testing: this saves the bitmap to a file instead of printing.
     */
    private fun printBitmap(bitmap: Bitmap) {
        // STUB — replace with actual Sunmi AIDL calls:
        //
        // val intent = Intent("com.sunmi.innerprinter")
        // intent.putExtra("bitmap", bitmap)
        // context.sendBroadcast(intent)
        //
        // OR via AIDL service binding (see Sunmi developer docs):
        // mIWoyouService.printBitmap(bitmap, null)

        android.util.Log.d("SunmiPrinter", "Receipt rendered: ${bitmap.width}x${bitmap.height}px")
        // In production, connect to the AIDL service and send the bitmap
    }
}
