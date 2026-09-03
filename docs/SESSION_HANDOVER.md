# SESSION_HANDOVER.md

**Last Updated:** 3 September 2026 (Session 6 — onboarding re-baseline)
**Project:** OrchestratePay Platform
**Status:** 🟡 Backend + web + consumer-wallet proven against one live backend. Merchant terminal (`:app`) has a committed Sentry fix (`94afe82`) that has NEVER been launch-verified. Bug #16 (dead P2P buttons) unfixed. Bug #17 (token-expiry 401) committed (`176101f`), never runtime-tested. Working tree DIRTY (1 file). NFC/HCE never tested on two physical phones — the product thesis remains unverified.
**Prepared by:** Incoming Lead Dev — Session 6
**Recipient:** Any developer touching this repo. **This document is the single source of truth for project STATE.** READMEs describe how things are *meant* to work; this file describes what is *proven* to work.

---

## 0. HOW TO ONBOARD — mandatory order, do not skip steps

Every previous handover was wrong about something because the writer trusted a doc instead of a command. You will not repeat that if you do the following, in order, and paste outputs as you go.

| Step | Do this | Why |
|---|---|---|
| **1** | Read this file top to bottom (≈20 min). | Ground truth, open bugs, environment traps. |
| **2** | Run `git log --oneline --reverse` and read **§9 Annotated History** alongside it. | You need to know *which* commits are real fixes, which are retractions, and which are docs-claiming-things. Roughly 30% of commits are docs. |
| **3** | Run `git status --short` and `git remote -v`. Confirm the tree matches **§1**. If it doesn't, stop and reconcile before anything else. | Three consecutive handovers have mis-stated tree state. |
| **4** | Regenerate the directory tree (**§8**, command included) and compare to the tree in this doc. | Undocumented modules exist (`dashboard/`, `skills/`). |
| **5** | Read the docs in the order and with the trust ratings in **§10**. Do NOT read `Tap2Pay/README.md` first. | It is the most detailed and the most wrong. |
| **6** | Bring the environment up per **§7** and run the **Phase 0 checklist** in §11. | Every "Android bug" in July/August turned out to be an environment problem first. |
| **7** | Only now: pick the top item in **§11 Immediate**. | — |

**Standing rules (each born from a real incident — see §12):**
- No status claim without pasted command output. Not in chat, not in docs, not in commit messages.
- `git status --short` before EVERY commit. Check `N files changed` against intent.
- Push to `fork`, never `origin`.
- Terminal: one command per paste. Multi-line pastes scramble in this MINGW64 setup.
- XML files: paste through `sed 's/</[/g; s/>/]/g' <file>` (see §7, "angle-bracket stripping").
- "Committed" ≠ "applied" ≠ "verified". Track all three separately (see bug table, §2).

---

## 1. GROUND TRUTH — verified by pasted output, 3 Sep 2026 17:30 UTC

**Machine clock:** `2026-09-03T17:30:21Z` (from `/health`). Prior handovers flagged a date discrepancy vs the onboarding brief; the clock has been internally consistent since 2 Sep. Treat 3 Sep 2026 as real.

| Item | State | Evidence |
|---|---|---|
| Backend | ✅ up | `GET /health` → `{"status":"ok","version":"1.0.0"}`; `GET /readiness` → `{"status":"ready"}` (Postgres + Redis both answering) |
| HEAD | `176101f` | `git log`; == `fork/main` |
| Ahead of `origin/main` | 41 commits | `git status` |
| Working tree | 🔴 **DIRTY** — `M Tap2Pay/android/consumer-wallet/src/main/java/com/orchestratepay/consumer/api/ConsumerApiClient.kt` | `git status --short` **after** `176101f` was pushed. Likely CRLF normalisation churn (git warned "LF will be replaced by CRLF" on this file during the commit). **Unconfirmed — see §11 Phase 0.** |
| Gradle wrapper | ✅ present | `ls Tap2Pay/android` shows `gradlew`, `gradlew.bat`, `gradle/` (android/README.md §3 says it isn't checked in — stale) |
| Android SDK levels | compileSdk 35 / minSdk 26 / targetSdk 35 | `app/build.gradle` (Tap2Pay/README says target 34 — stale) |
| `:app` debug API URL | `http://localhost:3000/api/v1/` + `ws://localhost:3000` | `app/build.gradle` buildTypes.debug (requires `adb reverse tcp:3000 tcp:3000`) |
| `:app` release API URL | `https://api.orchestratepay.co.ke/api/v1/` | `app/build.gradle` — **no such host is known to be deployed** |
| `:app` defaultConfig API URL | `https://api-sandbox.orchestratepay.co.ke/v1/` | ⚠️ path is `/v1/` not `/api/v1/`. Dead today (both buildTypes override it) but any future `staging` buildType inherits the wrong path. Backlog nit, fix in Phase S. |
| Sentry in `:app` | `io.sentry:sentry-android:7.6.0` | `app/build.gradle`; DSN from `-PSENTRY_DSN` gradle property, empty by default → root cause of Bug #11 |
| TLS pins | `api.orchestratepay.co.ke` → `C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M=`, `diGVwiVYbubAI3RW4hB9xU8e/CH2GnkuvmFZRIjnadY=` | `network_security_config.xml`. These are the published ISRG Root X1 / X2 SPKI pins (root README correct; Tap2Pay/README "placeholder pins" claim stale). Also pins `sandbox.safaricom.co.ke`/`api.safaricom.co.ke` — the app never calls Safaricom directly; harmless, odd. Cleartext permitted for `10.0.2.2` and `localhost`. |
| Remotes | `origin` = gabrielngige (upstream, DO NOT PUSH); `fork` = MARKDISPLAYNONE (push target) | verified prior session |

**Inherited from Session 5 — verified then by pasted output, not re-verified today:**
- Redis 5.0.14.1 manual start; PostgreSQL native on `:5432`; 4 migrations applied (001–004).
- Web on `:3001` via Vite; consumer + merchant web portals log in and render.
- Consumer wallet: login → JWT → WebSocket → dashboard, on emulator `emulator-5554` AND on real device `RF8R42CY49R` (16 Aug).
- Backend tests: **93 suites / 1959 tests / 108 failing** (Bug #15).
- Test accounts: `consumer2@test.com` / `TestPass123` (ID `a09df433-…`); `merchant@test.com` / `TestPass123` (ID `6fce73f3-…`, APPROVED, `nfcSigningKey: null` because `NFC_SIGNING_SECRET` unset); `consumer@example.com` (jane kamaea — pre-existing, different data).

---

## 2. OPEN BUG INVENTORY — with the three-state status

"Committed" = code is in git. "Applied" = the fix is on disk/in the APK that gets run. "Verified" = a human watched it work and pasted the evidence.

| # | Bug | Severity | Committed | Applied | Verified | Blocker for |
|---|---|---|---|---|---|---|
| **11** | `:app` fatal crash on launch — `SentryInitProvider: DSN is required` | 🔴 Blocker | ✅ `94afe82` | ❓ APK not rebuilt/installed since | ❌ | Every merchant-app test |
| **16** | Consumer wallet "Scan QR" / "Send Money" — no click listeners in `HomeFragment.kt` | 🔴 High | ❌ | ❌ | ❌ | P2P feature entirely unreachable |
| **17** | Token expiry → raw 401 / `"Bearer null"` / possible `HttpException` crash; no refresh handling | 🔴 High | ✅ `176101f` (4 files, +556/−293) | ✅ in source; APKs not rebuilt | ❌ never fired a real refresh | Any session > 8h (merchant) / 24h (consumer) |
| **17b** | `AuthEventBus` / `ConsumerAuthEventBus` force-logout signal not consumed by any Activity | 🟢 Low | — | — | — | Only matters when refresh itself fails |
| **17c** | Device-binding key (`merchant:device:{id}`, 9h TTL) may not be re-armed by `/auth/refresh` → valid refreshed JWT rejected at hour 9 | 🟡 Hypothesis | — | — | — | Sustained merchant sessions. Read `middleware/auth.ts` + refresh handler in `auth.ts` to confirm/deny. |
| **17d** | WebSocket authenticated at connect with old JWT; behaviour after refresh unknown | 🟡 Hypothesis | — | — | — | `PAYMENT_CONFIRMED` delivery after hour 8 |
| **15** | 108 backend test failures (7 suites); CI status on fork unknown | 🟡 Medium | — | — | — | Any deployment (Phase S) |
| **18 (new)** | Working tree dirty after clean commit — `ConsumerApiClient.kt` | 🟡 Process | — | — | — | Trusting `git status` |
| **19 (new)** | Doc drift catalogue (§10) — incl. this doc's predecessor mis-stating Bug #11 as unapplied one day after it was committed | 🟡 Corrosive | — | — | — | Onboarding accuracy |
| **20 (new)** | APDU instruction bytes: commit `16e333c` changed reader to `0x80`/`0x81`; Tap2Pay/README documents `0x80 0xC0` / `0x80 0xC1`. Reader vs HCE service vs docs need a three-way check. | 🟡 Medium | — | — | — | Phase 6 tap test |
| — | NFC/HCE never tested on two physical phones | 🔴 Product thesis | — | — | — | Everything |
| 1–10, 12–14 | Closed. Summaries in §5, details in git history. | ✅ | ✅ | ✅ | — |

---

## 3. NEW FINDINGS THIS SESSION (3 Sep 2026)

### F-1: Bug #11 fix is committed, not verified — and the previous handover said otherwise
`git log` shows `94afe82 fix(android): disable Sentry auto-init in debug builds (Bug #11) + session 5 handover rewrite` at 2 Sep 23:14. The handover committed 19 hours later (`feebff7`) and the Session-5 summary both state "fix written, not applied." One of those is wrong, and git wins. **Verify:** `git show --stat 94afe82` and `ls Tap2Pay/android/app/src/debug/`. If `AndroidManifest.xml` is there containing a `meta-data android:name="io.sentry.auto-init" android:value="false"` entry, the fix is applied in source; the remaining step is rebuild → install → launch → paste logcat showing no `SentryInitProvider` exception and `LoginActivity` on screen.

### F-2: The "terminal `cat` rendering quirk" is (very probably) chat-side angle-bracket stripping
Session 5 logged four failed `cat`s on XML files and concluded MinTTY was at fault. Today's evidence contradicts that: `cat network_security_config.xml` pasted as `api.orchestratepay.co.ke C5+lpZ7… localhost` — exactly the XML **text nodes**, with every `<tag>` removed. `cat AndroidManifest.xml` pasted as nothing — it is ~100% tags. The terminal is printing fine; the content is being stripped as HTML when pasted into the chat. This also explains the empty backticks in the previous handover where `<meta-data …>` should be.
**Workaround (untested — test it first):** `sed 's/</[/g; s/>/]/g' <file>` then paste. If square brackets arrive intact, use this for every XML file from now on and **Bug #16 is unblocked**. If not, `code <file>` and copy from the editor.
**Consequence:** delete the "cat quirk" runbook item from §7 once confirmed; it sent people down the wrong path for a day.

### F-3: Working tree dirty immediately after a clean commit (Bug #18)
`176101f` committed `ConsumerApiClient.kt`; `git status` afterwards shows it modified again. Git emitted `LF will be replaced by CRLF` for exactly this file. Most likely `core.autocrlf` is rewriting line endings on checkout and the index disagrees with the working copy. **Diagnose before doing anything:** `git diff --stat` (expect large) then `git diff -w --stat` (if empty → whitespace only). Fix options: (a) `git add --renormalize Tap2Pay/android` + commit "chore: normalise line endings"; (b) add a `.gitattributes` with `*.kt text eol=lf`. Do NOT just `git checkout -- file` without looking — if it isn't whitespace, it's an uncommitted Bug #17 edit.

### F-4: Build configuration facts (from `app/build.gradle`, first time captured in a handover)
- Groovy DSL for root + `:app`; commit history says `nfc-core` and `consumer-wallet` are `.kts`. Mixed — fine, just know it.
- `testImplementation project(':softpos')` — `:app` unit tests depend on the softpos module. Any softpos compile break breaks `:app:test`.
- Google Services plugin absent (commented out in `1d332fb`, Jul 28) → FCM push is dead in both apps until re-enabled. Not documented anywhere except that commit.
- Retrofit 2.9 / OkHttp logging 4.11 / Room 2.6 via KSP / WorkManager 2.11.2 / CameraX 1.3.4 / ML Kit barcode 17.2.0 / security-crypto 1.1.0-alpha06 (alpha in a payments app — backlog).

### F-5: Release build has no backend to talk to
Release `API_BASE_URL` is `https://api.orchestratepay.co.ke/api/v1/`. No deployment of that host is recorded anywhere in git, docs, or prior handovers. Root README says K8s manifests exist with P0 gaps; Tap2Pay/README says they don't exist; commit `534c7ba` (Jun 21) says P0 gaps were fixed. **Nobody has run `kubectl apply`.** "Production-ready" in any doc must be read as "compiles."

### F-6: Physical-device networking will fail on the day of the tap test unless prepared
Debug builds use `localhost` + `adb reverse`. That works for one phone on USB. Two phones both need `adb reverse` set (per device, non-persistent across daemon restarts). If either phone is on Wi-Fi only, it needs a build pointing at the dev machine's LAN IP with that IP added to the cleartext allowlist in **both** apps' `network_security_config.xml`, or an ngrok HTTPS URL. **Decide and build this before the phones are in the room.**

---

## 4. BUG #17 — what was committed, what is still unknown

Committed in `176101f` (per the Session-5 design; treat file-level details as claims until you read the diff):
- `refreshToken` added to both `AuthResponse` data classes and persisted in both `SessionManager` / `ConsumerSessionManager` (EncryptedSharedPreferences).
- OkHttp `Authenticator` (not Interceptor) on both clients, synchronized single-flight refresh, retry-with-new-token, force-logout fallback via an event bus.
- Consumer `bearer()` no longer renders `"Bearer null"`.

Backend contract (mapped from `auth.ts`, Session 5):

| | Merchant | Consumer |
|---|---|---|
| Endpoint | `POST /api/v1/auth/refresh` | `POST /api/v1/auth/consumer/refresh` |
| Body | `{ "refreshToken": "…" }` | same |
| Response | `{ "token": "…", "refreshToken": "…" }` | same |
| Rotation | single-use (old token revoked on use) | single-use |
| TTL | 8h access / 30d refresh | 24h access / refresh TTL unverified |

**Unknowns that must be closed before calling #17 done:**
1. Has anyone read the `176101f` diff end-to-end? (`git show 176101f`) — Session-5 lead wrote it; Session-6 lead has not reviewed it.
2. Runtime: set stored `expiresAt` to the past (or wait), fire an authenticated call, paste OkHttp logging showing 401 → `/auth/refresh` 200 → original request retried 200.
3. Concurrency: fire two authenticated calls simultaneously after expiry; confirm exactly ONE refresh request appears in the backend log.
4. #17c device binding and #17d WebSocket (table in §2).
5. Whether `ConsumerService` return types were wrapped in `Response<T>` (hardening) or still throw `HttpException` on non-2xx.

---

## 5. CLOSED BUGS — one line each (details in git)

| # | What | Fix commit |
|---|---|---|
| — | APDU INS bytes in `NfcReaderManager` (0xC0→0x80, 0xC1→0x81) — **see Bug #20 re: docs mismatch** | `16e333c` |
| — | HCE payload thread-safety (AtomicReference) | `8ef53d8` |
| — | HCE token TTL 60s→90s | `1e3c431` |
| — | targetSdk 35 for nfc-core compat | `186521c` |
| — | Google Services plugin disabled (FCM off) | `1d332fb` |
| — | consumer-wallet compile failures + gradle wrapper generated | `fd21ba5` |
| 1 | `:app` launcher icons missing | `e9866d0` |
| 2 | HCE service "not in manifest" — **retracted, was a tooling false-negative** | `4d77878` |
| 3 | colors.xml | `e9866d0` |
| 4 | kapt→KSP for Room | `e9866d0` |
| 5 | 5 post-KSP compile clusters (WorkManager dep, ApiClient typo, NdefFormatable import, missing layout, generic inference) | `e9866d0` |
| 6 | nfc-core `consumer-rules.pro` missing | `6e33592` |
| 7 | softpos launcher icons + AnimatorSet.repeatCount | `35ec698` |
| 8 | Debug URL `10.0.2.2` → `localhost` + `adb reverse` | `73b066c` |
| 9 | No merchant/consumer test accounts | manual DB (Session 4) |
| 10 | Consumer auth response missing `phone`/`displayName` → NPE on login | `154b0a9` |
| 12 | Web `npm run dev` used Linux-only `fuser` | `1df609c` |
| 13 | Orphaned ts-node-dev + premature curl = phantom failures (runbook) | §7 |
| 14 | `/consumers/me/loyalty` SQL against non-existent columns killed the process; + `asyncHandler` | `b6f4f07`, `27bf4af`, `52197d6` (accidental revert), `23ef6f6` (restore) |

---

## 6. OBSERVATIONS (not bugs)

1. **Web vs Android "disparity" was two different accounts.** Parity comparisons only valid same-account.
2. **Functional parity proven, visual parity not.** Wallet UI is green; web is dark glass. Product decision (item #43) — after functional milestones.
3. **`nfcSigningKey: null`** at merchant login until `NFC_SIGNING_SECRET` is set. Required before any tag-payment test.
4. **Undocumented background jobs** (subscription billing, webhook delivery) run live. Backend README §9 lists them; CLAUDE.md doesn't.
5. **`Tap2Pay/dashboard/`** — React 18 + Vite 5, zero docs, purpose unknown. Product-owner ruling needed. Also `skills/` at root (mentioned in `39bb40a`, never described).
6. **`androidTest` is stale** — `LoginActivityTest.kt` references view IDs that no longer exist. Doesn't block `assembleDebug`.
7. **`npm` blocks install scripts** on this machine; bcrypt native binding works anyway. Never approve `@scarf/scarf`.
8. **Emulators have no NFC radio.** Emulator = login/UI/API testing only. Two physical phones (or phone + ACR122U reader) for HCE/tag.
9. **Merchant single-device login** — emulator/phone/web kick each other. By design.
10. **`IdempotencyKeyGen.kt`** produces 32 lowercase hex → passes Joi. Not a bug.
11. **`POST /transactions` never returns `PENDING`** — expect `201 STK_SENT` or `502 FAILED`. Tests must accept both.
12. **P2P / wallet features** (`P2PSendActivity`, `/wallet`, `p2p-transactions` tests) appear in code and tests and in **zero** product docs — exactly the profile that produced Bug #16.
13. **`softpos/` has no login screen** (android/README §9). It is not a shippable product. Descope from any "production" claim.
14. **Merchant onboarding prerequisite:** registration needs `ADMIN_SECRET`, login needs `APPROVED`. A fresh environment cannot log a merchant in from Android until both are done server-side.

---

## 7. ENVIRONMENT SETUP — Windows / MINGW64

**Every new terminal:** `pwd`, `which adb`, `java -version`. PATH does not persist reliably.

**Redis:** not on PATH. `/c/Users/admin/redis/redis-server.exe --port 6379` (leave running). `redis-cli ping` → PONG. Backend log "Reached the max retries per request limit" = Redis down.

**PostgreSQL:** native on `:5432`. **Docker is NOT installed** — the docker-compose docs are unusable here.

**netstat:** `/c/Windows/System32/netstat.exe -ano`.

**Backend:** `cd Tap2Pay/backend && npm run dev`. **Wait for the literal line `OrchestratePay backend running on port 3000`** — the version banner is not readiness. `EADDRINUSE` = orphan: find PID via netstat, `taskkill //F //PID <pid>`. Ctrl+C does not reliably kill npm children.

**Web:** `cd Tap2Pay/web && npm run dev` → `:3001`, proxies `/api/*` → `:3000`.

**Android:**
- `export PATH="$PATH:/c/Users/admin/AppData/Local/Android/Sdk/platform-tools"` if `adb` missing.
- `adb reverse tcp:3000 tcp:3000` — **per device, every time the daemon restarts.** Check `adb reverse --list` before diagnosing "Failed to connect."
- Emulator: `emulator-5554`. Real device: `RF8R42CY49R`.
- Build: `cd Tap2Pay/android && ./gradlew assembleDebug`. Gradle 9.4.1, Java 21.
- Install: `adb -s emulator-5554 install -r app/build/outputs/apk/debug/app-debug.apk`.

**Pasting discipline:** one command per paste. Multi-line blocks scramble.

**Angle-bracket stripping (replaces the "cat quirk"):** XML pasted into the chat loses every tag. Use `sed 's/</[/g; s/>/]/g' <file>` before pasting, or open in VS Code. See F-2.

**Git:** `git status --short` before every commit. Push: `git push fork main`. Check `git diff -w --stat` when a file shows modified right after committing (F-3).

---

## 8. REPOSITORY STRUCTURE

Regenerate with: `find . -maxdepth 3 -type d -not -path '*/node_modules*' -not -path './.git*' -not -path '*/build*' -not -path '*/.gradle*' | sort`

```
OrchestratePay_Platform/
├── CLAUDE.md                         AI-assistant orientation. Partially corrected (Vite). Test count + route count stale.
├── README.md                         Root overview. "Production-ready" table is aspirational. Pin claim correct.
├── .github/workflows/ci.yml          Claims to run tests on push. Fork status UNKNOWN (Bug #15).
├── docs/
│   ├── SESSION_HANDOVER.md           ← this file. Only doc that carries STATUS.
│   ├── PRODUCTION_READINESS_CHECKLIST.md   ~43 numbered items; compliance + deploy gates. Needs restructure (§10).
│   ├── ANDROID_NFC_TESTING_PROTOCOL.md     Tests 1–4 for two-phone tap. Pre-flight tables superseded by this doc.
│   ├── (iOS limitations / QR fallback doc — name per 8f4a279)
│   ├── (security audit doc — per 07a1d92)
│   └── archive/  or *_ARCHIVE.md     Old handovers. Delete or move; git has them.
├── infra/
│   ├── k8s/                          Manifests. P0 gaps "fixed" in 534c7ba; never applied to a cluster.
│   └── nginx/
├── skills/                           Mentioned once (39bb40a). Undocumented.
├── test-logs/                        Check whether tracked; probably shouldn't be.
└── Tap2Pay/
    ├── docker-compose.yml            Unusable on this machine (no Docker).
    ├── README.md                     Most detailed, most stale. See §10.
    ├── backend/                      Express + TS + pg + ioredis + ws. Most trustworthy README.
    │   └── src/{routes(21),middleware,integrations,jobs,realtime,util,db/migrations(001–004),__tests__(93)}
    ├── web/                          Vite 6 + React 19 + react-router. NOT Next.js.
    ├── dashboard/                    ⚠️ Undocumented React 18 + Vite 5 app.
    └── android/
        ├── build.gradle / settings.gradle / gradle.properties / local.properties (Groovy root)
        ├── gradlew, gradlew.bat, gradle/        ✅ checked in (android/README says otherwise)
        ├── common-proguard-rules.pro
        ├── build_log.txt                        ⚠️ should not be tracked — check `git ls-files`
        ├── README.md
        ├── app/                                 Merchant terminal, com.orchestratepay. Sentry 7.6.0. Bug #11.
        │   └── src/{main,debug(94afe82 overlay?),test,androidTest}
        ├── consumer-wallet/                     HCE wallet, com.orchestratepay.consumer. Bugs #16, #17.
        ├── nfc-core/                            Shared library (.kts).
        └── softpos/                             Builds; no login UI; not a product.
```

---

## 9. ANNOTATED GIT HISTORY — read with `git log --oneline --reverse`

**Era 1 — Upstream (Gabriel, 5 Jun – 20 Jul 2026, `5c96c86` → `fb1dad6`)**
`851e5c9`/`caad8f7` Next.js 14→15. `8f72155` (26 Jun) **"web app changes to react"** — this is where web became Vite; every doc that says Next.js is from before this commit. `534c7ba` "Fix P0 k8s gaps." `9b4a72e`/`5e65226` "production ready" — code had never been run on a device. `fb1dad6` = `origin/main` tip. **Nothing in this era was hardware-tested.**

**Era 2 — Session 1 (23–24 Jul, `16e333c` → `24b761a`)** Fork begins. APDU INS bytes changed in reader (Bug #20 asks: does the HCE side agree?). Thread-safety, TTL 90s. Security audit doc. 6 docs commits claiming "system verified" — meaning web login worked.

**Era 3 — Session 2 (27–29 Jul, `186521c` → `39bd03c`)** targetSdk 35. Google Services plugin disabled (**FCM dead since here**). Gradle wrapper generated. 150+ compile errors → 4 root causes. First full `assembleDebug` → Bug #1 (icons) real, Bug #2 (HCE manifest) **false** — retracted `4d77878` (8 Aug). Lesson: grep returning nothing ≠ file missing (and, in hindsight, probably the same angle-bracket problem as F-2).

**Era 4 — Session 3 (12 Aug, `e9866d0` → `c6d2b57`)** kapt→KSP, 5 compile clusters, nfc-core proguard, softpos icons. **All 4 modules build green** for the first time. `c6d2b57` claims "2nd NFC phone confirmed available" — **retracted** by `b3c2cc9`.

**Era 5 — Session 4 (16 Aug, `73b066c` → `b3c2cc9`)** `10.0.2.2`→`localhost`. Consumer auth contract NPE fixed (Bug #10). **Consumer wallet works end-to-end on a real phone** — the first real-device proof in the project. `b3c2cc9` corrects the prior handover's false claims.

**Era 6 — Session 5 (2–3 Sep, `1df609c` → `176101f`)** Windows dev script fix. Bug #14 process-kill + accidental revert + restore. Docs: Vite. `94afe82` Bug #11 Sentry overlay committed. `feebff7` handover (incorrectly still says #11 unapplied). `176101f` Bug #17 refresh-token + Authenticator, both apps.

**Pattern to internalise:** every "verified / production ready / confirmed" claim in a commit message before `b3c2cc9` should be read as "compiled." Three retractions (`4d77878`, `b3c2cc9`, this doc's F-1) all came from the same cause.

---

## 10. DOCUMENTATION MAP — trust ratings and what to do with each

| Doc | Trust | Read when | Action |
|---|---|---|---|
| `docs/SESSION_HANDOVER.md` | High (evidence-cited) | First | Keep as the ONLY status document. Update every session. |
| `Tap2Pay/backend/README.md` | High for how-to; route list (21) is the most complete | Backend work | Keep. Fix test count. |
| `Tap2Pay/web/README.md` | High | Web work | Keep. |
| `CLAUDE.md` | Medium | Any AI-assisted session | Fix: "71 suites" → 93; "13 route modules" → 21; add jobs list; add Android debug-URL + adb reverse note; add link to this doc as status source. |
| `README.md` (root) | Medium | Overview | **Replace the "Key Capabilities" status column** with three columns: Backend impl / Client wired / Verified on hardware. Currently every row says "Production-ready" and none are verified. |
| `Tap2Pay/android/README.md` | Medium | Android setup | Fix: wrapper IS checked in; add Prerequisites block (backend up, merchant approved, `adb reverse`, `NFC_SIGNING_SECRET`); note Sentry debug overlay; note FCM disabled; add XML-paste workaround. |
| `docs/ANDROID_NFC_TESTING_PROTOCOL.md` | Medium | Phase 6 | Keep. Replace its pre-flight/account tables with a pointer to this doc. Add F-6 networking prep. Add Bug #20 APDU three-way check as Test 0. |
| `docs/PRODUCTION_READINESS_CHECKLIST.md` | Low-Medium (not re-read this session) | Before Phase S | **Do not delete** — it holds CBK/KRA/DPA compliance items with month-long lead times. **Restructure** into Phase S / H / P gates (§11) and give every item the three-state columns. Drop items now covered by bug tracking here. |
| `Tap2Pay/README.md` | **Low** | Payment Flows + Security Model sections only | **Slim it to those two sections plus an index** pointing at backend/web/android READMEs. Delete: Next.js + `NEXT_PUBLIC_API_URL`, both test counts, "no k8s yet", `10.0.2.2`, SDK 34, "placeholder pins", SoftPOS-as-product. Everything it duplicates is more accurate elsewhere. |
| Archived handovers | None | Never | Move to `docs/archive/` or delete. |
| iOS limitations, security audit | Medium (static analyses) | Reference | Keep, no action. |
| `Tap2Pay/android/build_log.txt`, `test-logs/` | — | — | Untrack if tracked. |

**Convention change (adopt now):** READMEs describe *how to run and how it is designed*. They never carry status words ("ready", "verified", "done"). Status lives here, with the three-state table. Checklist items are split into backend / client / verified — a merged checkbox is how the refresh-token gap survived for months.

---

## 11. PLAN — in order; each phase unblocks the next

### Phase 0 — Environment & tree truth (today, ~20 min)
- [ ] `git diff -w --stat` on `ConsumerApiClient.kt`; resolve F-3 (commit renormalisation or the real change). Tree must be clean before Phase 1.
- [ ] `git show --stat 94afe82`; `ls Tap2Pay/android/app/src/debug/`; paste. Confirms Bug #11 applied-in-source.
- [ ] Test the XML workaround: `sed 's/</[/g; s/>/]/g' Tap2Pay/android/app/src/debug/AndroidManifest.xml`. Result decides F-2.
- [ ] `git ls-files | grep -E 'build_log|test-logs'` — untrack if present.
- [ ] Backend up (`/readiness` ready — ✅ today), Redis PONG, `adb devices`, `adb reverse --list`.

### Phase 1 — Merchant app exists (Bug #11 verify)
- [ ] `./gradlew :app:assembleDebug` → install on `emulator-5554` → launch → paste logcat (no `SentryInitProvider` exception) + screenshot/description of `LoginActivity`.
- [ ] Login `merchant@test.com` / `TestPass123` / device `emu-01`. Paste backend log line for the login.
- [ ] Mark Bug #11 Verified in §2.

### Phase 2 — Bug #16 (dead P2P buttons)
- [ ] Dump `fragment_home.xml`, `activity_home.xml`, `consumer-wallet/.../AndroidManifest.xml` via the F-2 workaround.
- [ ] Wire `setOnClickListener` → `P2PQrScannerActivity` / `P2PSendActivity` in `HomeFragment.kt`; confirm manifest declarations; rebuild; tap; paste logcat showing the Activity start.

### Phase 2.5 — Contract audit, done once, as a table (no hardware)
- [ ] `grep -rn '"/api/v1\|@GET\|@POST\|@PUT' Tap2Pay/android/app/src/main Tap2Pay/android/consumer-wallet/src/main` → list every endpoint each app calls.
- [ ] For each: Kotlin response data class vs the route's actual `res.json(...)`. Nullable/missing fields = Bug #10/#14/#17 class. Record in a table in this doc.
- [ ] Include Bug #20: `NfcReaderManager` INS bytes vs `ConsumerHceService`/`OrchestaHceService` vs `apduservice.xml` vs README. Three-way agreement or fix.
- [ ] Include #17c (device binding on refresh) and #17d (WS after refresh) by reading `middleware/auth.ts`, `auth.ts` refresh handler, `ws-server.ts`.

### Phase 3 — Bug #17 runtime verification + full smoke pass
- [ ] Read `git show 176101f` end-to-end (Session 6 lead has not).
- [ ] Force expiry, one call → paste 401 → refresh 200 → retry 200. Two concurrent calls → exactly one refresh in backend log.
- [ ] Smoke checklist, both apps, every screen, every button: table of screen / expected / actual / evidence. Expect more Bug-#16-class finds.

### Phase 4 — Docs (per §10)
- [ ] Root README three-column status table; CLAUDE.md numbers; android README prerequisites; Tap2Pay/README slimmed; checklist restructured; archives moved.

### Phase 5 — Bug #15 + CI
- [ ] Confirm whether Actions run on the fork (GitHub → Actions tab, or `gh run list`). If red/absent → deployment gate.
- [ ] Triage the 7 failing suites by cluster (`routes-auth-mock` 55, `admin-audit`, `merchant-refresh-token`, `account-lockout`, `consumer-otp`, `coverage-gaps-routes`, `ws-server-full`). Fix or quarantine with reasons.

### Phase 6 prerequisites (do BEFORE phones arrive)
- [ ] Decide networking (F-6): two USB `adb reverse`, or LAN-IP build with cleartext allowlisted in both apps, or ngrok. Build and install the chosen config on one phone and prove a login over it.
- [ ] Set `NFC_SIGNING_SECRET`; confirm `nfcSigningKey` non-null at merchant login.
- [ ] Daraja sandbox credentials in `.env` (currently placeholders → every STK Push returns 502).
- [ ] Merchant app on real device `RF8R42CY49R` login proven.

### Phase 6 — The milestone
- [ ] `adb devices` showing two physical devices, pasted.
- [ ] ANDROID_NFC_TESTING_PROTOCOL Tests 1–4. One real tap → one real STK Push → callback → `PAYMENT_CONFIRMED` on the terminal. Logs pasted for each hop.

### Deployment path (unchanged; gated on Phases 3, 5, 6)
**S (staging):** k8s P0 re-check → VPS docker-compose or k8s → domain + TLS → nginx → Daraja sandbox → `staging` buildType (fix defaultConfig `/v1/` path) → signed APKs.
**H (hardening):** JWT_SECRET rotation, DB SSL, Sentry DSN for Android + backend Sentry 8→10, security-crypto stable release, backups, re-enable FCM.
**P (production):** Safaricom go-live, CBK PSP licence (3–6 months — must already be in motion), KRA eTIMS, Kenya DPA 2019.

**Product-owner rulings outstanding:** `dashboard/` fate · design-language unification (#43) · SoftPOS in or out of scope · Daraja sandbox creds owner.

---

## 12. DECISION LOG (Session 6 additions; Session 5 log retained in git at `feebff7`)

| Date | Decision | Rationale |
|---|---|---|
| 2026-09-03 | Adopted three-state bug status (Committed / Applied / Verified) | Bug #11 was committed and still reported unapplied a day later; a single "status" column cannot represent this |
| 2026-09-03 | Reclassified the "cat quirk" as chat-side angle-bracket stripping (hypothesis, test defined) | `network_security_config.xml` pasted as text-nodes-only — terminal is fine, tags are lost on paste |
| 2026-09-03 | Added mandatory onboarding order (§0) and annotated history (§9) | New devs were reading the most-detailed-most-wrong doc first |
| 2026-09-03 | READMEs carry no status words; status lives only here | Doc drift is the mechanism that hid Bugs #11/#16/#17 |
| 2026-09-03 | Phase 2.5 contract audit inserted before further button-tapping | Bugs #10/#14/#17 are one disease; find the rest in one read, not one at a time |
| 2026-09-03 | Physical-device networking prep moved ahead of the tap test | Debug builds are USB-`adb reverse` only; discovering this with two phones in hand wastes the session |
| 2026-09-03 | "Production-ready" in any existing doc redefined as "compiles" until Phase 6 passes | No feature in the Key Capabilities table has been executed on hardware end-to-end |

---
END OF SESSION_HANDOVER.md
```

---

## Save, verify, commit

One command per paste:

```bash
code docs/SESSION_HANDOVER.md
```
Replace the whole file with the block above, save. Then:

```bash
git diff -w --stat
```
This answers F-3 first — if it prints nothing except the handover, the `ConsumerApiClient.kt` change is line-endings only. Paste the result before committing. Then:

```bash
git add docs/SESSION_HANDOVER.md
```
```bash
git status --short
```
Expect `M docs/SESSION_HANDOVER.md` plus (still unstaged) `M …ConsumerApiClient.kt`. Do **not** add the Kotlin file to this commit.

```bash
git commit -m "docs(handover): session 6 re-baseline — three-state bug status, onboarding order, annotated history, F-1 (Bug #11 committed in 94afe82 not verified), F-2 (XML tag stripping is chat-side), F-3 (dirty tree post-commit), Phase 0–6 plan"
```
```bash
git push fork main
```

## Docs: what to clean up vs. update

Short version of §10, since you asked directly:

- **Don't delete anything that holds compliance or protocol content** — `PRODUCTION_READINESS_CHECKLIST.md`, `ANDROID_NFC_TESTING_PROTOCOL.md`, the iOS and security-audit docs. Restructure the checklist into Phase S/H/P gates with the three-state columns; point the protocol's pre-flight at the handover.
- **Gut `Tap2Pay/README.md`** down to Payment Flows + Security Model + an index. It's the only doc that is both authoritative-looking and wrong in six places.
- **Fix numbers in `CLAUDE.md`**, and make root `README.md`'s capabilities table honest (three columns, not one "Production-ready").
- **Move archived handovers out**; untrack `build_log.txt` / `test-logs/` if tracked.
- **Rule going forward:** status lives in the handover only. READMEs never say "ready".

## Next implementation step

Phase 0, four commands, paste each result:

```bash
git diff -w --stat
```
```bash
git show --stat 94afe82
```
```bash
ls -la Tap2Pay/android/app/src/debug/ 2>&1
```
```bash
sed 's/</[/g; s/>/]/g' Tap2Pay/android/app/src/debug/AndroidManifest.xml
```

The fourth one is the important experiment: if it arrives with square brackets intact, the XML-paste problem is solved, Bug #16 is unblocked, and Phase 1 (rebuild `:app`, launch, paste logcat) starts immediately after.