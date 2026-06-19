# OrchestratePay Android — Setup & Testing Guide

Two separate apps live in this directory:

| Module | Package | Purpose |
|--------|---------|---------|
| `app/` | `com.orchestratepay` | Sunmi P2 Pro terminal app (NFC POS) |
| `softpos/` | `com.orchestratepay.softpos` | Merchant phone as SoftPOS |
| `consumer-wallet/` | `com.orchestratepay.consumer` | Consumer payment wallet |

---

## 1. Prerequisites

Before opening the project, make sure you have:

- **Android Studio Hedgehog (2023.1.1)** or newer — [download](https://developer.android.com/studio)
- **JDK 17** — Android Studio ships with one; no separate install needed
- **Android SDK 34+** — installed through Android Studio's SDK Manager

---

## 2. Open the Project

1. Launch **Android Studio**
2. Click **File → Open**
3. Navigate to `Tap2Pay/android/` and click **OK**
4. Wait for Gradle sync to finish (bottom status bar shows progress)

If Gradle sync fails with a "SDK location not found" error:

1. Go to **File → Project Structure → SDK Location**
2. Set the **Android SDK location** to your local SDK path (usually `~/Android/Sdk` on Linux/macOS or `C:\Users\<you>\AppData\Local\Android\Sdk` on Windows)
3. Click **Apply** and re-sync

---

## 3. Generate the Gradle Wrapper (first time only)

The `gradlew` script is not checked in. You need to generate it once:

1. In Android Studio, open the **Terminal** tab (bottom toolbar, or **View → Tool Windows → Terminal**)
2. Run:
   ```bash
   gradle wrapper --gradle-version 8.4
   ```
   If `gradle` is not in your PATH, install it:
   - **Ubuntu/Debian:** `sudo apt install gradle`
   - **macOS:** `brew install gradle`
   - **Windows:** Download from [gradle.org](https://gradle.org/install/)
3. After this, `gradlew` and `gradlew.bat` appear in `Tap2Pay/android/`. All subsequent commands use `./gradlew`.

---

## 4. Run Unit Tests

Unit tests are pure JVM tests — **no emulator or device needed**.

### From Android Studio (recommended)

**Run all tests in a module:**

1. Open the **Project** panel (left sidebar)
2. Right-click the module's `src/test/` folder, e.g.:
   - `app/src/test/` for the terminal app
   - `softpos/src/test/` for the SoftPOS app
3. Click **Run 'Tests in …'**

**Run a single test file:**

1. Open any `*Test.kt` file (e.g. `PaymentOrchestratorTest.kt`)
2. Click the green ▶ icon in the gutter next to the class name
3. Or right-click the class name → **Run '…'**

**Run a single test:**

1. Click the green ▶ icon next to any individual `@Test` function

Results appear in the **Run** panel at the bottom with a pass/fail tree.

---

### From the Terminal

```bash
# From inside Tap2Pay/android/

# Run all JVM unit tests for the terminal app
./gradlew :app:test

# Run all JVM unit tests for the SoftPOS app
./gradlew :softpos:test

# Run tests for both at once
./gradlew test

# Run with coverage report (HTML report in app/build/reports/coverage/)
./gradlew :app:testDebugUnitTestCoverage

# Run a specific test class
./gradlew :app:test --tests "com.orchestratepay.payment.PaymentOrchestratorTest"

# Run a specific test method
./gradlew :app:test --tests "com.orchestratepay.payment.PaymentOrchestratorTest.valid amount passes validation"
```

Test results are written to:
```
app/build/reports/tests/testDebugUnitTest/index.html
softpos/build/reports/tests/testDebugUnitTest/index.html
```
Open these HTML files in a browser to see a full report.

---

## 5. Test Coverage Report

```bash
# Generate HTML coverage report for app module
./gradlew :app:testDebugUnitTestCoverage

# Open the report
xdg-open app/build/reports/coverage/test/debug/index.html   # Linux
open app/build/reports/coverage/test/debug/index.html        # macOS
```

> **Target:** ≥80% line coverage on business logic classes.
> UI activities and Android services are excluded (they require instrumented tests).

---

## 6. Run Instrumented Tests (requires device or emulator)

Instrumented tests test Room DAOs, Activities, and HCE services against a real Android runtime.

**Setup an emulator:**

1. In Android Studio: **Tools → Device Manager → Create Device**
2. Choose **Pixel 6** → **API 34** → Finish
3. Start the emulator (▶ button next to the device name)

**Run instrumented tests:**

```bash
# Must have an emulator running or a device connected via USB
./gradlew :app:connectedAndroidTest
```

Or in Android Studio:
1. Right-click `app/src/androidTest/`
2. Click **Run 'Tests in …'**

---

## 7. What Tests Exist

### Terminal App (`app/`)

| Test file | What it covers |
|-----------|----------------|
| `PaymentOrchestratorCoroutineTest` | Amount validation, retry idempotency key, audit log ordering, WS result variants, poll timeout boundary |
| `PaymentOrchestratorTest` | Amount validation, double-tap prevention, retry logic |
| `ConsumerQrFlowTest` | CONSUMER_QR payment source end-to-end |
| `SoftPosResultTest` | SoftPosResult sealed class variants |
| `SoftPosAttestationTest` | Play Integrity nonce format |
| `PaymentResultTest` | PaymentResult sealed class |
| `IdempotencyKeyGenTest` | SHA-256 idempotency key generation |
| `NfcUriParserTest` | NFC URI parsing |
| `ApiResponseMappingTest` | API data class field contracts |
| `WsPaymentResultTest` | WebSocket result sealed class + JSON parsing |
| `SunmiPrinterStateMachineTest` | Printer state machine, AIDL status codes, receipt content, VAT block, bitmap height |
| `SunmiPrinterManagerTest` | VAT calculation, printer state sealed class |
| `MerchantHceSessionTest` | HCE session activate/get/expire/clear |
| `ApduHandshakeTest` | APDU byte protocol logic |
| `NfcSignatureVerifierDerivationTest` | Per-merchant key isolation, cross-merchant cloning attack, NDEF URI parsing |
| `NfcSignatureVerifierTest` | HMAC signature verification |
| `NfcReaderManagerTest` | NFC reader state machine |
| `OfflineQueueRoomTest` | Room DB contract, `OnConflictStrategy.IGNORE` dedup, `QueueSyncService.flushQueue` sync logic |
| `OfflineQueueTest` | Offline queue enqueue/drain logic |
| `QueuedIntentTest` | QueuedIntent fields, pruning, retry rules |
| `ConnectivityMonitorTest` | Network state observation |
| `HardwareStateTest` | Hardware state sealed class |
| `SessionManagerTest` | JWT storage/retrieval contracts |
| `AuditLoggerTest` | AuditEvent enum completeness, AuditEntry fields |
| `ReceiptRecordTest` | ReceiptRecord fields, privacy invariant |
| `TelemetryWorkerTest` | Telemetry worker logic |
| `DeviceTelemetryTest` | DeviceTelemetry data class + battery health mapping |
| `ConsumerQrScannerTest` | QR scanner activity logic |

### Consumer Wallet (`consumer-wallet/`)

| Test file | What it covers |
|-----------|----------------|
| `ConsumerHceTokenHandlerTest` | SELECT AID, GET DATA payload, CONFIRM single-use, P2P session priority, TOKEN_TTL_MS |

### SoftPOS App (`softpos/`)

| Test file | What it covers |
|-----------|----------------|
| `SoftPosOrchestratorTest` | SoftPosResult variants, nonce generation, idempotency key format |

---

## 8. Build and Install on Device

```bash
# Debug build
./gradlew :app:assembleDebug

# Install directly on connected device/emulator
./gradlew :app:installDebug

# Release build (requires signing config)
./gradlew :app:assembleRelease
```

The debug APK is at:
```
app/build/outputs/apk/debug/app-debug.apk
```

---

## 9. Known Gaps (require future work)

- **Instrumented tests** for Room DAOs (`AuditDatabase`, `ReceiptDatabase`, `OfflineQueueDatabase`) — these need a real SQLite engine
- **Instrumented tests** for `LoginActivity`, `MerchantDashboardActivity`, `ReceiptActivity` — UI interaction tests via Espresso
- **SoftPOS login screen** — `SoftPosOrchestrator` currently receives `merchantToken` from outside; no login UI exists yet
- **PlayIntegrityChecker** cannot be unit-tested (requires Google Play Services on a real device)
