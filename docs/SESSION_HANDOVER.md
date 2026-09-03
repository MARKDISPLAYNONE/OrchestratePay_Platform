# SESSION_HANDOVER.md

**Last Updated:** 4 September 2026, 01:00 — end of Session 8
**Project:** OrchestratePay Platform
**Prepared by:** Lead Dev, Session 8
**Recipient:** Any developer or AI session touching this repository

**This is the only document in the repository that carries project STATUS.** READMEs describe design and operation. This file describes what is proven, what is broken, what is unknown, and what to do next — with the command output that backs each claim.

**One-paragraph status:** Backend, web, consumer wallet, and merchant terminal all run against one live local backend and are login-verified on emulator-5554. Session 8 closed three bugs with pasted evidence: #24 (a manifest corruption that was silently failing every Android build), #16 (P2P buttons — first Android commit in this repo with an unbroken edit→build→install→runtime→commit chain, `e34b116`), and #11 (merchant terminal launches and logs in; open since 2 Sep). The merchant terminal screen is an amount keypad with Scan QR and Present NFC; Scan QR opens the camera; Present NFC fails (#28: backend 400 from the request validator, app displays 401). The API smoke script passes 24/25; the one failure (#23) is now mapped to a single unanswered question — whether `POST /transactions` ever resolves a consumer QR token. The wallet was confirmed against the backend log: login, WebSocket connect/disconnect, transactions, loyalty, and P2P token mint all 200. A Play-Store gate was discovered (#26, 16 KB page-size alignment). NFC and HCE — the product thesis — have never run on two physical phones. Nothing is deployed.

---

## 0. ONBOARDING — mandatory path, in this order

Five previous handovers, commit messages, or advisors were wrong about repository or device state because the writer trusted a document, a chat message, or their own intent instead of running a command. Budget ~90 minutes. Paste every command's output into your session log.

**Step 1 — Read this document, top to bottom.** ~25 min. Do not skip §3, §7, §9. Done when you can name the open Blocker/High bugs (#17, #28), say why Session 7's "#16 verified" was false (F-12), and say why "use `com.orchestratepay.consumer` instead of `com.orchestratepay`" was wrong advice (F-15).

**Step 2 — Confirm the repository matches §1.** `git log --oneline -5`, `git status --short`, `git remote -v`. HEAD at or after `e34b116`; tree clean; `fork` → MARKDISPLAYNONE, `origin` → gabrielngige. Anything else: stop, reconcile, record.

**Step 3 — Read the history with §9.** `git log --oneline --reverse`. Done when you can point at the three commits whose messages describe content they lack (#25) and know to read `git show --stat` before believing any message.

**Step 4 — Regenerate the tree and compare to §8.** `git ls-files | awk -F/ 'NF>2{print $1"/"$2"/"$3}NF<=2{print $0}' | sort -u`.

**Step 5 — Read the other documents per §10.** Not `Tap2Pay/README.md` first.

**Step 6 — Bring the environment up per §7.** Every "Android bug" reported July–August was an environment problem first; every failed automation attempt in Session 8 was an emulator-state problem first (§7 "Scripted UI").

**Step 7 — Pick the top unchecked item in §11.** Work it, paste the evidence, update §2/§12/§14, commit, `git show --stat HEAD`, push to `fork`.

**Standing rules — each exists because it was violated and something broke (incident in §12):**

- No status claim without pasted command output. Not in chat, not in docs, not in commit messages.
- "Committed", "applied", and "verified" are three different states. §2 tracks all three.
- `git status --short` before every commit. `git show --stat HEAD` after. The file list is the truth; the message is a claim.
- Push to `fork`, never `origin`.
- One command per paste, and keep commands short. A 600-character one-liner collided with a second paste in Session 8 and hung the shell.
- XML / generics-heavy Kotlin through `sed 's/</[/g; s/>/]/g' FILE` before pasting into chat. (If you received this with empty quotes, the rule is demonstrating itself — F-13.)
- Never pipe a Gradle build to `tail -3`. Use `2>&1 | grep -E "^e: |error:|FAILED|BUILD" | head -30`.
- Build → install is one `&&` chain; check the APK mtime against your last edit before installing.
- Activity-state proof is `dumpsys activity activities | grep topResumedActivity`, plus `logcat -b crash -d`. The main logcat buffer is unusable on this emulator (§7).
- A diagnosed corruption is reverted before the next command.
- Advice from any source — human, AI, previous handover — is checked against output already on screen before it changes a command (F-15).
- Backend readiness is the literal log line `OrchestratePay backend running on port 3000`.
- READMEs never carry status words. Status lives here.

---

## 1. GROUND TRUTH — verified by pasted output, 3–4 September 2026

| Item | State | Evidence |
|---|---|---|
| Machine clock | 4 Sep 2026 ~01:00 | commit `e34b116` `Fri Sep 4 00:35:02 2026 +0300`; backend log timestamps 00:49–00:53 |
| HEAD | `e34b116` on `main` | `git show --stat HEAD` |
| `fork/main` | `3f761d4` — one commit behind HEAD; push pending (§11 Phase 0) | `git log` decoration |
| Ahead of `origin/main` | 48 | `git status` |
| Working tree | One file: ` M docs/SESSION_HANDOVER.md` (this rewrite; committed at session close) | `git status` |
| Installed packages on emulator-5554 | `com.orchestratepay` (merchant terminal) and `com.orchestratepay.consumer` (wallet) — two apps, two IDs | `pm list packages \| grep orchestratepay` |
| Backend | Up; 7 cron jobs polling cleanly on empty queues every 60 s | backend log 00:50–00:53 |
| Bug #24 | Closed | `git checkout --` of nfc-core manifest; build went `FAILED in 4s` → `SUCCESSFUL in 20s` with no other change |
| Bug #16 | Committed `e34b116` (1 file, +17/−9), applied (APK mtime `22:58:33`, installed `Success`), verified (below) | `git show --stat HEAD`; `ls --time-style=full-iso`; layout `fragment_home.xml` L88 `btn_scan_qr` / L101 `btn_p2p`; manifest L39 `P2PSendActivity` / L42 `P2PQrScannerActivity`; runtime: camera bound, `POST /consumers/p2p-token 200` (relayed by second dev — see §13 caveat) |
| Bug #11 | Verified | `topResumedActivity=…com.orchestratepay/.ui.LoginActivity`; `logcat -b crash -d` empty; `POST /api/v1/auth/login 200 660 ms` at 00:49:08; top activity moved off LoginActivity after login |
| Merchant terminal screen after login | Header "OrchestratePay", amount keypad, **Scan QR**, **Present NFC**. Nothing else | human description, 4 Sep |
| Merchant Scan QR | Opens camera after 16 KB dialog + camera permission | human description |
| Merchant Present NFC | Fails. Backend `POST /api/v1/transactions/merchant-hce-token 400 6 ms - 68 bytes` at 00:51:43; app displays "HTTP 401" | backend log + human description → **#28** |
| Wallet after login | `WS: consumer wallet connected` (consumerId `a09df433…`); `GET /consumers/me/transactions 200 1415 B`; `GET /consumers/me/loyalty 200 15 B`; `GET /consumers/me 200 211 B`; clean `WS … disconnected` on close | backend log 00:52–00:53 (transactions/loyalty/me pasted; WS lines relayed) |
| Wallet QR tokens | Two endpoints: `POST /consumers/qr-token` (pay-a-merchant; Redis `consumer:qr:{uuid}` → consumerId, 90 s, returns `{token, expiresAt}`) and `POST /consumers/p2p-token` (receive-from-peer; single-use Redis; Joi-validated) | `consumers.ts` L98–113, L366–405 |
| Merchant QR scanner | `ConsumerQrScannerActivity`: accepts any UUID-shaped QR, returns intent extra `consumerQrToken` | `ConsumerQrScannerActivity.kt` L110–175 |
| `POST /transactions` identity paths (as read so far) | `tagId` → `nfc_tags`; `consumerPhone+hceToken+hceExp` (HCE_PHONE); else 400. Whether L47+ also destructures a QR field, and whether `consumer:qr:*` is ever read, is **unread** | `transactions.ts` L45–46, L157–164, L250–265 (grep only) |
| `merchant-hce-token` | Joi-validated (`merchantHceTokenSchema`, unread); handler destructures `amountCents, consumerId`; 403 if merchant unapproved; mints `merchant:hce:{uuid}` 60 s; design: merchant phone emits via HCE, consumer wallet reads and posts `source=MERCHANT_HCE` | `transactions.ts` L520–553 |
| Smoke | `PASS=24 FAIL=1` (only `POST /transactions (merchant, QR_CODE)` 400) | run output, Session 7 |
| Bug #17 consumer client | HEAD `176101f`, read and approved | F-3 |
| Android SDK | compile 35 / min 26 / target 35 | `app/build.gradle` |
| `:app` debug API | `http://localhost:3000/api/v1/` + `adb reverse tcp:3000 tcp:3000` (`host-16 tcp:3000 tcp:3000` confirmed) | `adb reverse --list` |
| `:app` release API | `https://api.orchestratepay.co.ke/api/v1/` — undeployed | `app/build.gradle` |
| `:app` defaultConfig | `…/v1/` lacks `/api`; dead today | `app/build.gradle` |

**Inherited (verified in Sessions 4–7, not re-verified):** Redis 5.0.14.1 manual start; PostgreSQL native `:5432`; migrations 001–004; web `:3001` both portals log in; wallet on real device `RF8R42CY49R` (16 Aug); backend tests 93 suites / 1959 tests / 108 failing (backend README says 85/1836 — drift, Phase 4).

**Test accounts:** `consumer2@test.com` / `TestPass123` (ID `a09df433-…`, phone 254700000002). `merchant@test.com` / `TestPass123` / device `emu-01` (ID `6fce73f3-…`, APPROVED; `nfcSigningKey` null — `NFC_SIGNING_SECRET` unset). Never use `consumer@example.com` for parity.

---

## 2. OPEN BUGS — three-state status

| # | Bug | Severity | Committed | Applied | Verified | Blocks |
|---|---|---|---|---|---|---|
| 28 | **NEW.** Merchant "Present NFC" → `POST /transactions/merchant-hce-token` **400** from the Joi validator (handler never reached). Handler wants `consumerId`, but at Present-NFC time no consumer exists — if the schema requires it, the button can never work. **28b:** app shows "HTTP 401" for a 400 response (error-mapping) | 🔴 High | — | — | — | M4b; the entire merchant-presents-HCE flow; Phase 6 |
| 17 | Token expiry / refresh handling on device | 🔴 High | `176101f` | source yes; APKs rebuilt this session include it | **No** — never fired a real refresh | Sessions > 8 h / 24 h |
| 23 | Smoke `POST /transactions (merchant, QR_CODE)` 400. Now mapped: wallet mints `consumer:qr:{uuid}`; merchant scanner returns `consumerQrToken`; `PaymentIntent` says QR_CODE carries `tagId`. **One question left:** does `transactions.ts` read `consumer:qr:*` anywhere? Yes → smoke sends wrong shape (fix script). No → flow is broken end to end (backend fix) | 🟡 Contract — 🔴 if unresolved server-side | — | — | — | Smoke 25/25; iOS QR fallback |
| 26 | **NEW.** 16 KB page-size: `lib/x86_64/libbarhopper_v3.so` (ML Kit barcode) and `libimage_processing_util_jni.so` (CameraX) not 16 KB-aligned. Android 16 shows a compat dialog on every launch of both apps; Play requires alignment for new submissions targeting 15+ since Nov 2025 | 🟡 Medium — deployment gate | — | — | — | Phase H / Play upload; also swallows taps in scripted UI (§7) |
| 25 | Commit messages describing content they lack: `52197d6`, `3e618c7`, `2368fec` | 🟡 Corrosive | rule in §0 | — | — | trust in `git log` |
| 17b | Force-logout signal unwired in both Application classes | 🟢 Low | — | — | — | when refresh fails |
| 17c | Merchant device-binding key may not re-arm on refresh | 🟡 Hypothesis | — | — | — | sessions > 9 h |
| 17d | WS after refresh unknown (connect/disconnect on old JWT clean, per log) | 🟡 Hypothesis | — | — | — | `PAYMENT_CONFIRMED` after hour 8 |
| 17f | Merchant refresh response fields | 🟡 Unknown | — | — | — | #17 merchant side |
| 20 | APDU INS bytes three-way check — **now applies to two HCE directions** (merchant reads consumer via `NfcReaderManager`; consumer reads merchant via `MerchantHcePayActivity`) | 🟡 Medium | — | — | — | Phase 6 |
| 15 | 108 backend test failures / 7 suites; CI on fork unknown | 🟡 Medium | — | — | — | deployment |
| 19 | Doc drift (§10) | 🟡 Corrosive | partial | — | — | onboarding |
| — | NFC/HCE never run on two physical phones | 🔴 Product thesis | — | — | — | everything |

**Closed this session:** #24, #16, #11 (see §5). **Closed earlier:** #1–#10, #12–#14, #17e, #18, #21, #22.

---

## 3. FINDINGS — Sessions 6–8

**F-1 – F-8** (Session 6): #11 applied on disk; angle-bracket stripping is chat-side; stale-working-copy incident; #21 hypothesis; repo contents no doc mentioned; gradle.properties newline; release build has no backend; physical-device networking needs prep (`adb reverse` is USB-only).

**F-9 — #21 closed.** `3f761d4`; smoke `PASS=24`. `2368fec`'s message claimed it; its content did not (#25).

**F-10 — Smoke's one FAIL is #23.** `transactions.ts` accepts `tagId` or the HCE trio; the QR case sends neither.

**F-11 — nfc-core manifest corruption (#24).** One line: a path string prepended before `<?xml`. Paste accident, not Android Studio. Diagnosed in Session 7, left in place, built on.

**F-12 — A failed build was followed by installing a stale APK.** `tail -3` printed `BUILD FAILED`; `adb install` succeeded on the old artifact; a logcat grep matched Monkey noise; "verified" was nearly declared. Caught at start of Session 8.

**F-13 — The sed paste command in circulation is itself bracket-stripped.** Working form: `sed 's/</[/g; s/>/]/g' FILE`.

**F-14 — Session 7's end-state summary was wrong on three counts** — all from reading the last line of a pipeline instead of the error line.

**F-15 — "Wrong package name" was a wrong diagnosis.** A second developer's write-up in Session 8 stated the "core mistake" was targeting `com.orchestratepay` instead of `com.orchestratepay.consumer`. `pm list packages` shows both are installed; `dumpsys` had already shown `com.orchestratepay/.ui.LoginActivity` resumed; and the "corrected" command failed with the identical error (`null root node returned by UiTestAutomationBridge`). Real cause: `uiautomator dump` raced the 16 KB dialog animation after a cold start. Same class as `4d77878` and F-14 — a confident narrative not checked against output already on screen. Rule added to §0.

**F-16 — The merchant terminal screen is a terminal, not a dashboard.** Header, amount keypad, Scan QR, Present NFC. That is correct scope; the dashboard is the web merchant portal. §14 M3 was mis-specified and is rewritten.

**F-17 — Present NFC fails before the handler runs (#28).** The 400 (68 B body) is from `validate(merchantHceTokenSchema)`; the handler only contains a 403. The handler destructures `consumerId`; the design comment says the merchant phone emits the token for an as-yet-unknown consumer. If the schema requires `consumerId`, the endpoint is unreachable from the UI as built. The app rendered the 400 as "401" (28b).

**F-18 — QR plumbing mapped end to end except one hop.** Wallet → `POST /consumers/qr-token` → Redis `consumer:qr:{uuid}` = consumerId (90 s) → QR on screen → merchant `ConsumerQrScannerActivity` validates UUID shape → intent extra `consumerQrToken` → `PaymentIntent(source=QR_CODE, tagId=?)` → `POST /transactions` → **[unknown: does the route resolve `consumer:qr:*`?]** → 400 in smoke. The wallet's Send Money uses the *other* mint (`p2p-token`). Which wallet UI element triggers `qr-token` (seen at 00:52:47) is not yet mapped.

**F-19 — Scripted UI on this emulator has four traps, now runbook (§7):** `adb input text` appends to existing field text (a stale `c` produced `cconsumer2@test.com`); the 16 KB compat dialog sits above the activity, swallows every tap, and does not change `topResumedActivity`; the main logcat buffer rolls in under a minute (`SatelliteController` spam), so `START u0` lines are gone before they can be grepped; Git Bash rewrites any argument starting with `/` into a Windows path unless `MSYS_NO_PATHCONV=1`.

**F-20 — A 600-character one-liner collided with a second paste and hung the shell.** The rule says one command per paste; it should also say short commands. Lead's own violation.

---

## 4. BUG #17 — exact state

Unchanged from Session 6 except: backend consumer refresh proven (#21 closed); both APKs rebuilt this session contain `176101f`; WS connect/disconnect on the initial JWT is clean (partial #17d). Still needed: items 2–7 of the Session 6 list (merchant refresh fields; read `git show 176101f -- Tap2Pay/android/app`; forced-expiry runtime proof; concurrency → one refresh; #17c/#17d from source; wire #17b).

---

## 5. CLOSED BUGS — one line each

| # | What | Commit / evidence |
|---|---|---|
| — | Reader APDU INS bytes; HCE thread-safety; TTL 90 s; targetSdk 35; Google Services off; wallet compile + wrapper | `16e333c`, `8ef53d8`, `1e3c431`, `186521c`, `1d332fb`, `fd21ba5` |
| 1–7 | Icons, colors, kapt→KSP, compile clusters, nfc-core proguard, softpos | `e9866d0`, `6e33592`, `35ec698` |
| 2 | "HCE service not in manifest" false positive | retracted `4d77878` |
| 8 | `10.0.2.2` → `localhost` + `adb reverse` | `73b066c` |
| 9 | No test accounts | manual DB |
| 10 | Consumer auth NPE | `154b0a9` |
| 12 | Linux-only `fuser` in web dev script | `1df609c` |
| 13 | Orphaned ts-node-dev runbook | §7 |
| 14 | `/me/loyalty` SQL drift killed process | `b6f4f07`, `27bf4af`, `52197d6`, `23ef6f6` |
| 17e | Consumer refresh returns `expiresAt` | Session 6 |
| 18 | Stale working copy | Session 6 |
| 21 | Consumer refresh 500 / 24 h lockout | `3f761d4`; smoke |
| 22 | Tracked build artifacts | `d2659d0` |
| 24 | nfc-core manifest corruption | `git checkout --`; build FAILED→SUCCESSFUL, 3 Sep |
| 16 | Dead P2P buttons | `e34b116`; layout/manifest IDs confirmed; camera bound; `p2p-token 200` |
| 11 | Merchant Sentry crash | `94afe82`; login screen resumed, crash buffer empty, `auth/login 200`, 4 Sep |

---

## 6. OBSERVATIONS — not bugs

1. Parity comparisons only on the same account.
2. Visual parity / `ui-core` (#43) starts after §14 is filled — not before.
3. `nfcSigningKey` null until `NFC_SIGNING_SECRET` set.
4. Seven cron jobs; all seen completing on empty queues within 1–76 ms.
5. `Tap2Pay/dashboard/` — ruling pending.
6. `androidTest` sources stale; one compile command decides (Phase 3).
7. `npm` blocks install scripts; bcrypt works.
8. Emulators have no NFC radio.
9. Merchant single-device login by design.
10. `IdempotencyKeyGen` fine.
11. `POST /transactions` returns `201 STK_SENT` or `502 FAILED`, never `PENDING`.
12. P2P in code and tests, zero product docs.
13. `softpos/` no login screen; descoped.
14. Fresh env needs a registered + approved merchant.
15. Daraja placeholders → STK 502.
16. `skills/` = design intent.
17. `HomeFragment` uses `findViewById`; both P2P activities in `com.orchestratepay.consumer.ui`.
18. Stack: Express + TS + `pg` + Joi / Vite 6 + React 19 / Kotlin, Gradle 9.4.1, Java 21. No Prisma/Zod/Next.js.
19. **Two HCE directions exist.** (a) Consumer presents, merchant reads: `NfcReaderManager` → `hceToken` → `POST /transactions source=HCE_PHONE`. (b) Merchant presents, consumer reads: `merchant-hce-token` → `MerchantHcePayActivity` → `source=MERCHANT_HCE`. Both need #20's APDU check and a Phase 6 tap.
20. Wallet declares `P2PPayActivity` (scan a peer's p2p QR and pay) and `MerchantHcePayActivity` — §14 W8/W11 targets.
21. Merchant Scan QR camera and wallet QR scanner both trigger the 16 KB dialog then a camera-permission prompt on first use; both then bind the camera.

---

## 7. ENVIRONMENT — Windows / Git Bash (MINGW64)

**Every new terminal:** `pwd`, `which adb`, `java -version`. Repo-root-relative paths assume you are at the root — Session 7 ended in `Tap2Pay/android` and the first command of Session 8 failed for it.

**Redis:** `/c/Users/admin/redis/redis-server.exe --port 6379`; `redis-cli ping` → PONG.
**PostgreSQL:** native `:5432`. **Docker:** not installed. **netstat:** `/c/Windows/System32/netstat.exe -ano`.

**Backend:** `cd Tap2Pay/backend && npm run dev`; wait for `OrchestratePay backend running on port 3000`. `EADDRINUSE` → orphan → `taskkill //F //PID <pid>`. A curl during ts-node-dev reload returns `000`; rerun.

**Smoke:** `bash scripts/e2e-smoke.sh 2>&1 | grep -E "FAIL|PASS="` from root. Expect `PASS=24 FAIL=1` until #23.

**Web:** `cd Tap2Pay/web && npm run dev` → `:3001`.

**Android build/install:**
cd Tap2Pay/android
./gradlew :consumer-wallet:assembleDebug 2>&1 | grep -E "^e: |error:|FAILED|BUILD" | head -30
ls -la --time-style=full-iso consumer-wallet/build/outputs/apk/debug/consumer-wallet-debug.apk
adb -s emulator-5554 install -r consumer-wallet/build/outputs/apk/debug/consumer-wallet-debug.apk && adb reverse tcp:3000 tcp:3000
adb reverse --list # expect: host-16 tcp:3000 tcp:3000

text

Same with `:app:assembleDebug` / `app/build/outputs/apk/debug/app-debug.apk`.

**Packages / launchers:** merchant `com.orchestratepay/.ui.LoginActivity`; wallet `com.orchestratepay.consumer/.ui.LoginActivity` (`cmd package resolve-activity --brief <pkg>`).

**Scripted UI on emulator-5554 (all four traps are F-19):**
- `MSYS_NO_PATHCONV=1` on any adb command whose argument starts with `/` (e.g. `/sdcard/ui.xml`).
- Before a scripted run: `adb shell am force-stop <pkg>` then `am start -n <pkg>/.ui.LoginActivity`, then **wait ≥ 6 s**.
- The Android 16 "App Compatibility" 16 KB dialog appears on cold start of both apps until "Don't Show Again" is tapped (`button2`). It swallows every tap and is invisible to `topResumedActivity`. Dump the UI and look for `alertTitle` before typing anything.
- `adb shell input text` **appends**. Clear the field first: tap it, `input keycombination 113 29` (Ctrl+A), `input keyevent 67` (DEL).
- Close the IME (`input keyevent 4`) before tapping a button below the fields.
- `uiautomator dump` returns `null root node` during window transitions — retry with 2 s sleeps, and `rm -f /sdcard/ui.xml` first so a failed dump can't show a stale screen.
- Layout dump: `MSYS_NO_PATHCONV=1 adb -s emulator-5554 shell "uiautomator dump /sdcard/ui.xml >/dev/null && cat /sdcard/ui.xml" | tr '>' '\n' | grep -E 'resource-id="[^"]+"' | sed -E 's/.*resource-id="([^"]*)".*text="([^"]*)".*bounds="([^"]*)".*/\1 | \2 | \3/'`
- Wallet login coordinates (1080×2400): email 540,724 · password 540,927 · login 540,1158. Merchant login used the same coordinates successfully.

**Evidence commands (the only ones that work here):**
- Foreground: `adb -s emulator-5554 shell dumpsys activity activities | grep topResumedActivity | head -1`
- Crash: `adb -s emulator-5554 logcat -b crash -d | tail -20`
- Main logcat buffer: **do not use** for activity starts; it rolls in < 60 s.
- Backend side: the `npm run dev` window — every app action shows up as an `http:` line with status and byte count.

**Pasting:** one command per paste; keep them short. XML/Kotlin through sed. Edit in VS Code. Never paste a shell path into an open editor tab (#24).

**Git:** `git status --short` before, `git show --stat HEAD` after. `git push fork main`.

---

## 8. REPOSITORY STRUCTURE — from `git ls-files`, 3 Sep 2026

Unchanged from Session 6 apart from: `scripts/e2e-smoke.sh` present; `web/.next/`, `tsconfig.tsbuildinfo` untracked (`d2659d0`); nfc-core manifest clean.
OrchestratePay_Platform/
├── README.md · CLAUDE.md · LICENSE · .gitignore
├── .github/workflows/ci.yml fork status unknown (#15)
├── .agents/skills/ · skills/ (42) design intent only
├── scripts/extract-tls-pin.sh · scripts/e2e-smoke.sh
├── docker-compose.yml · docker-compose.ha.yml unusable here
├── docs/ SESSION_HANDOVER.md (this) · PRODUCTION_READINESS_CHECKLIST.md · ANDROID_NFC_TESTING_PROTOCOL.md · IOS_LIMITATIONS_AND_FALLBACK.md
├── infra/k8s/ · infra/nginx/ never applied
└── Tap2Pay/
├── README.md (low trust) · package.json · docker-compose.yml
├── backend/ Express+TS; routes(21) middleware integrations jobs(7) realtime util db/migrations(001–004) tests(93) docs/ load-test.js
├── web/ Vite 6 + React 19
├── dashboard/ React 18 + Vite 5; undocumented
└── android/ app (merchant, com.orchestratepay) · consumer-wallet (com.orchestratepay.consumer) · nfc-core · softpos; gradlew checked in

text


---

## 9. ANNOTATED GIT HISTORY

Eras 1–7 unchanged (see Session 6/7 text: upstream "production ready" = compiles; retractions `4d77878`, `b3c2cc9`; `b3c2cc9` institutes no-status-without-output; `176101f` refresh handling; Session 6 re-baseline; `3e618c7`/`a413471` message mismatch).

**Era 8 — Session 7 (3 Sep, `2368fec` → `3f761d4`).** Smoke script; #21 fixed on second attempt; #23 found; #24 introduced by paste accident; #16 patched on disk then falsely reported built/installed/verified.

**Era 9 — Session 8 (3–4 Sep, `e34b116` →).** Post-mortem of Session 7 (F-12/F-14); #24 reverted; #16 built, installed, exercised, committed with `git show --stat`; #11 verified; merchant terminal screen described; #28, #26 opened; #23 mapped to one question; scripted-UI runbook; wrong external diagnosis rejected on evidence (F-15).

**Pattern:** five retractions/corrections (`4d77878`, `b3c2cc9`, F-1, F-14, F-15) and three misdescribing commits (`52197d6`, `3e618c7`, `2368fec`). All from writing status before reading output.

---

## 10. DOCUMENTATION MAP

| Document | Trust | Action |
|---|---|---|
| `docs/SESSION_HANDOVER.md` | High | Only status doc. |
| `README.md` | High | Keep. |
| `CLAUDE.md` | High | Add Session 8 rules (build grep, `&&` chain, dumpsys/crash, advice-vs-evidence, short commands). |
| `Tap2Pay/backend/README.md` | High | Fix test count (85/1836 vs 93/1959); document smoke script; document the two HCE directions and two QR mints. |
| `Tap2Pay/web/README.md` | High | Keep. |
| `Tap2Pay/android/README.md` | Medium | Phase 4: prerequisites, Sentry overlay, FCM off, sed rule, scripted-UI runbook, 16 KB gate. |
| `docs/ANDROID_NFC_TESTING_PROTOCOL.md` | Medium | Phase 4: pre-flight → this file; F-8; #20 as Test 0 **for both HCE directions**. |
| `docs/PRODUCTION_READINESS_CHECKLIST.md` | Low–Medium | Keep for CBK/KRA/DPA lead-time items; add #26 to Phase H. |
| `docs/IOS_LIMITATIONS_AND_FALLBACK.md` | Medium | Re-read once #23 resolved. |
| `Tap2Pay/README.md` | Low | Phase 4 slim. |
| `skills/` | Design intent | Never for status. |
| `Tap2Pay/backend/docs/` | Unknown | Inventory Phase 4. |

---

## 11. PLAN

**Phase 0 — close Session 8 (now)**
- [ ] Commit this file; `git show --stat HEAD` → 1 file; `git push fork main` → `3f761d4..<new>`.

**Phase 2.1 — #23 and #28 from source (no hardware, ~20 min)**
- [ ] `grep -n "consumer:qr\|consumerQrToken\|qrToken" Tap2Pay/backend/src/routes/transactions.ts` and `sed -n '44,50p'` of the same file. **Decides #23 (a) vs (c).**
- [ ] `grep -n -A8 "merchantHceTokenSchema" Tap2Pay/backend/src/middleware/*.ts Tap2Pay/backend/src/routes/transactions.ts` — is `consumerId` required? **Decides #28 root cause.**
- [ ] `grep -n "consumerQrToken" -r Tap2Pay/android/app/src/main/java` — what the merchant app does with the scanned token (tagId? own field?).
- [ ] `grep -n "401" -r Tap2Pay/android/app/src/main/java --include=*.kt | head` — where a 400 becomes "401" (#28b).
- [ ] Fix whichever side is wrong; smoke → `PASS=25 FAIL=0`; commit; `git show --stat HEAD`.

**Phase 2.2 — finish §14 (emulator, ~30 min)**
- [ ] Wallet W5–W11 by hand, one line each with the backend `http:` line as evidence.
- [ ] Map which wallet element calls `qr-token` vs `p2p-token`.
- [ ] Merchant: after #28 fix, Present NFC reaches "waiting for tap" (no NFC on emulator — stop there).

**Phase 2.5 — contract audit table (§15)**, **Phase 3 — #17 runtime + androidTest compile**, **Phase 4 — docs**, **Phase 5 — #15/CI**, **Phase 6 prerequisites** (F-8 networking; `NFC_SIGNING_SECRET`; Daraja sandbox keys; merchant on `RF8R42CY49R`; **#26 alignment fix**), **Phase 6 — two phones, both HCE directions, one STK Push end to end** — unchanged.

**Deployment path** — S / H (add #26 16 KB alignment: bump ML Kit barcode + CameraX) / P — unchanged.

**Product-owner rulings outstanding:** `dashboard/` · #43 design language · SoftPOS scope · Daraja credential owner · `docker-compose.ha.yml` · **which HCE direction is the primary product flow (merchant-reads-consumer vs consumer-reads-merchant)?**

---

## 12. DECISION LOG

| Date | Decision | Incident |
|---|---|---|
| 2026-08-16 | No status without pasted output | false clean tree / second phone |
| 2026-09-02 | `git status --short` before every commit | `52197d6` |
| 2026-09-02 | One command per paste; wait for "running on port" | scrambled heredocs |
| 2026-09-02 | Emulator as standing test surface | found #11 |
| 2026-09-03 | Three-state bug status | #11 committed, reported unapplied |
| 2026-09-03 | sed before pasting XML/Kotlin | F-2 |
| 2026-09-03 | Mandatory onboarding order; READMEs carry no status; keep tests, quarantine seven; contract audit before more tapping; networking before tap test; "production-ready" = compiles; `git diff -w --stat` before discarding | Session 6 |
| 2026-09-03 | `git show --stat HEAD` after every commit | `3e618c7`, `2368fec` |
| 2026-09-03 | Never `tail -3` a build; build→install `&&`; APK mtime | F-12 |
| 2026-09-03 | Revert diagnosed corruption before the next command | F-11 |
| 2026-09-03 | Onboarding stack claims checked against `package.json`/`build.gradle` | brief said Next.js 16/Prisma/Zod |
| 2026-09-04 | Activity evidence = `dumpsys activity` + `logcat -b crash`; main logcat unusable here | F-19 |
| 2026-09-04 | Scripted UI: force-stop, dismiss 16 KB dialog, clear fields, close IME, retry dump; `MSYS_NO_PATHCONV=1` | F-19 |
| 2026-09-04 | Advice from any source is checked against output already on screen before it changes a command | F-15 |
| 2026-09-04 | Commands stay short; one per paste applies to the lead too | F-20 |
| 2026-09-04 | §14 rows are written against what a screen is *for* (terminal ≠ dashboard) | F-16 |

---

## 13. SESSION 6–8 COMMIT LOG

| Hash | Change | Message accurate? |
|---|---|---|
| `08eb61d` | docs: session 6 re-baseline | Yes |
| `d2659d0` | chore: untrack artifacts (#22) | Yes |
| `3e618c7` | docs: README + handover | **No** — claimed CLAUDE.md |
| `a413471` | docs: CLAUDE.md rewrite | Yes |
| `2368fec` | #21 + smoke script | **No** — smoke yes, fix absent |
| `3f761d4` | #21 actual fix; smoke hardening | Yes |
| `e34b116` | fix(android): #16 click listeners | Yes, with caveat: the `p2p-token 200` line cited was relayed from a second developer's backend log, not pasted raw; layout/manifest/build/install evidence was pasted |
| (next) | docs(handover): Session 8 close-out | — |

---

## 14. FUNCTIONAL SMOKE TABLE

| ID | App | Screen / action | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| M1 | Merchant | Launch | Login screen, no crash | **works** | dumpsys `com.orchestratepay/.ui.LoginActivity`; crash buffer empty |
| M2 | Merchant | Login `merchant@test.com` / `emu-01` | Terminal screen; backend 200 | **works** | `POST /api/v1/auth/login 200 660 ms`; top activity left LoginActivity |
| M3 | Merchant | Terminal screen content | Header, amount keypad, Scan QR, Present NFC | **works** (correct scope — F-16) | human description 4 Sep |
| M4a | Merchant | Amount → Scan QR | Camera preview | **works** to camera (16 KB dialog + permission first); end-to-end scan of a consumer QR not yet attempted | human description |
| M4b | Merchant | Amount → Present NFC | HCE token issued, "hold phones together" | **fails** — backend 400, app shows 401 | `merchant-hce-token 400 6 ms - 68` → #28 |
| W1 | Wallet | Login `consumer2` | Home | works | Sessions 5–8; `consumer/login 200 558 ms` (relayed) |
| W2 | Wallet | Home data | Greeting, points, recent txns | **works** | `/me/transactions 200 1415 B`, `/me/loyalty 200 15 B`, `/me 200 211 B` |
| W3 | Wallet | Scan QR | `P2PQrScannerActivity`, camera | **works** (relayed) | second dev run; layout L88, manifest L42 |
| W4 | Wallet | Send Money | `P2PSendActivity`, amount → QR | **works** (relayed) | `p2p-token 200`; layout L101, manifest L39 |
| W5 | Wallet | Loyalty screen | Renders | API 200; screen unobserved | `/me/loyalty 200` |
| W6 | Wallet | Profile | Renders | — | — |
| W7 | Wallet | History | Renders, matches web | — | — |
| W8 | Wallet | Pay merchant via QR (`qr-token`) | QR displayed | mint seen (`qr-token 200` 00:52:47); triggering element unmapped | backend log |
| W9 | Wallet | `MerchantHcePayActivity` (read merchant HCE) | Reaches reader prompt | — (blocked by #28 upstream) | — |
| W10 | Wallet | Tag writer | Write prompt | — | — |
| W11 | Wallet | `P2PPayActivity` (scan peer QR) | Camera | — | — |
| W12 | Wallet | Logout / re-login | Clean reset | — | WS disconnect clean (relayed) |

## 15. CONTRACT TABLE — filled in Phase 2.5

| Endpoint | Client | Backend | Client fields | Mismatch |
|---|---|---|---|---|
| `POST /transactions` | merchant `PaymentOrchestrator` | `merchantId, amountCents, source, tagId, nfcUid, idempotencyKey, _timestamp, consumerPhone, hceToken, hceExp, currency` (L45–46; L47+ unread) | `PaymentIntent`: `tagId`, `hceToken`, `source ∈ {NFC_TAG, QR_CODE, HCE_PHONE, MERCHANT_HCE?}` | #23: QR identity field unknown |
| `POST /transactions/merchant-hce-token` | merchant (Present NFC) | Joi schema unread; handler `amountCents, consumerId` | unread | #28: 400 at validator; 400 shown as 401 |
| `POST /consumers/qr-token` | wallet | none in; `{token, expiresAt}` out | unread | — |
| `POST /consumers/p2p-token` | wallet Send Money | Joi `p2pTokenSchema` | unread | — |
| `POST /auth/consumer/refresh` | `ConsumerApiClient` | `token, refreshToken, role, consumerId, phone, displayName, expiresAt` | matches (F-3) | none |
| `POST /auth/refresh` | `OrchestaApiClient` | unverified (#17f) | unread | — |

END OF SESSION_HANDOVER.md