# SESSION_HANDOVER.md

**Last Updated:** 3 September 2026 — end of Session 6
**Project:** OrchestratePay Platform
**Prepared by:** Lead Dev, Session 6
**Recipient:** Any developer or AI session touching this repository

**This is the only document in the repository that carries project STATUS.** Every README describes how the system is designed and how to run it. This file describes what is proven, what is broken, what is unknown, and what to do next — with the command output that backs each claim.

**One-paragraph status:** Backend, web, and consumer-wallet all run against one live local backend and have been login-verified. The merchant terminal app has a committed and on-disk Sentry fix that has never been launch-tested. Consumer-wallet P2P is unreachable from the UI (no click listeners). Refresh-token handling is committed in both apps and has never fired a real refresh; a possible backend bug may make consumer refresh return 500 every time. NFC and HCE — the product thesis — have never been executed on two physical phones. Nothing is deployed anywhere.

---

## 0. ONBOARDING — mandatory path, in this order

Three previous handovers were wrong about repository state because the writer trusted a document instead of running a command. This path exists so you do not become the fourth. Budget about 90 minutes. Paste the output of every command into your session log; you will need it for §12.

**Step 1 — Read this document, top to bottom.** About 25 minutes. Do not skip §7 (environment traps) or §9 (annotated history). You are done when you can name the four open Blocker/High bugs and the one command that closes #21.

**Step 2 — Confirm the repository matches §1.** Run `git log --oneline -5`, `git status --short`, `git remote -v`. HEAD must be at or after `08eb61d`; the tree must be clean; `fork` must point at MARKDISPLAYNONE and `origin` at gabrielngige. If any of these differ, stop, reconcile, and record what you found before touching anything.

**Step 3 — Read the history with the annotations.** Run `git log --oneline --reverse` and read it side by side with §9. About 15 minutes. Roughly a third of commits are documentation; three commits are retractions of earlier claims. You are done when you understand why "verified" in a commit message before `b3c2cc9` means "compiled".

**Step 4 — Regenerate the tree and compare to §8.** Run `git ls-files | awk -F/ 'NF>2{print $1"/"$2"/"$3}NF<=2{print $0}' | sort -u`. Anything present that §8 does not mention is new since 3 Sep and needs a line in §8 before you continue.

**Step 5 — Read the other documents in the order and with the trust ratings in §10.** Do not start with `Tap2Pay/README.md`; it is the most detailed and the most wrong. `Tap2Pay/backend/README.md` is the best technical reference in the repository.

**Step 6 — Bring the environment up per §7 and run the Phase 0 checklist in §11.** Every "Android bug" reported in July and August was an environment problem first: wrong URL, missing port forward, unapproved merchant, backend not actually started.

**Step 7 — Pick the top unchecked item in §11.** Work it, paste the evidence, update §2 and §12, commit, push to `fork`.

**Standing rules — each one exists because it was violated and something broke (see §12 for the incident):**

- No status claim without pasted command output. Not in chat, not in docs, not in commit messages.
- "Committed", "applied", and "verified" are three different states. Always say which. §2 tracks all three.
- `git status --short` before every commit. Check the "N files changed" line against your intent.
- Push to `fork`, never `origin`.
- One command per paste. Multi-line pastes scramble in this MINGW64 setup.
- Any XML or generics-heavy Kotlin pasted into an AI chat loses every angle bracket. Dump such files through `sed 's/</[/g; s/>/]/g' FILE` first. `grep` returning nothing on an XML file is not evidence the file is empty.
- Backend readiness is the literal log line `OrchestratePay backend running on port 3000`. Curling before that line produces phantom failures.
- READMEs never carry status words ("ready", "verified", "done"). Status lives here.

---

## 1. GROUND TRUTH — verified by pasted output on 3 September 2026

| Item | State | Evidence |
|---|---|---|
| Machine clock | 3 Sep 2026, consistent since 2 Sep | `/health` timestamp `2026-09-03T17:30:21Z` |
| Backend | Up and ready | `/health` → `status ok`, `version 1.0.0`; `/readiness` → `status ready` (PostgreSQL and Redis both answering) |
| HEAD | `08eb61d` on `main`, equals `fork/main` | `git push fork main` → `176101f..08eb61d` |
| Ahead of `origin/main` | 42 commits | `git status` |
| Working tree | One file dirty: `Tap2Pay/android/gradle.properties` — trailing newline only | `git diff` shows `\ No newline at end of file`; restore with `git checkout -- Tap2Pay/android/gradle.properties` |
| Bug #11 fix on disk | Yes | `Tap2Pay/android/app/src/debug/AndroidManifest.xml`, 237 bytes, dated 2 Sep 23:09; content is a manifest whose application block holds one meta-data entry `io.sentry.auto-init` = `false` |
| Bug #17 consumer client | HEAD `176101f` is the final version | `git add` of the working copy produced no staged change → working copy equals HEAD; `:consumer-wallet:compileDebugKotlin` BUILD SUCCESSFUL (UP-TO-DATE) |
| Consumer refresh returns `expiresAt` | Yes | `auth.ts` lines ~703–711: `expiresAt: Date.now() + CONSUMER_ACCESS_TTL_S * 1000` |
| Gradle wrapper | Checked in | `git ls-files` shows `Tap2Pay/android/gradlew`, `gradlew.bat`, `gradle/` |
| Android SDK levels | compile 35 / min 26 / target 35 | `app/build.gradle` |
| `:app` debug API | `http://localhost:3000/api/v1/` and `ws://localhost:3000` | `app/build.gradle`; requires `adb reverse tcp:3000 tcp:3000` |
| `:app` release API | `https://api.orchestratepay.co.ke/api/v1/` | `app/build.gradle`; no deployment of this host exists |
| `:app` defaultConfig API | `https://api-sandbox.orchestratepay.co.ke/v1/` — path lacks `/api` | Dead today (both buildTypes override it); would break any future `staging` buildType |
| TLS pins | ISRG Root X1 and X2 SPKI pins for `api.orchestratepay.co.ke`; also pins Safaricom hosts the app never calls; cleartext allowed for `10.0.2.2` and `localhost` | `network_security_config.xml` |
| Tracked build artifacts | `Tap2Pay/web/.next/` and `Tap2Pay/web/tsconfig.tsbuildinfo` are in git | `git ls-files` — cleanup commit today |
| Archived handovers in git | None | `git ls-files | grep -i archive` → empty |
| androidTest files | 4: `app/.../LoginActivityTest.kt`, `app/.../NfcTagPaymentFlowTest.kt`, `consumer-wallet/.../ConsumerP2PPayFlowTest.kt`, `consumer-wallet/.../ConsumerWalletLoginFlowTest.kt` | `git ls-files` |

**Inherited from Session 5 (verified then by pasted output, not re-verified today):** Redis 5.0.14.1 manual start; PostgreSQL native on `:5432`; migrations 001–004 applied; web on `:3001`, consumer and merchant portals log in and render; consumer wallet login → JWT → WebSocket → dashboard on emulator `emulator-5554` and on real device `RF8R42CY49R` (16 Aug); backend tests 93 suites / 1959 tests / 108 failing.

**Test accounts:** `consumer2@test.com` / `TestPass123` (ID `a09df433-…`, phone 254700000002). `merchant@test.com` / `TestPass123` (ID `6fce73f3-…`, APPROVED; `nfcSigningKey` is null because `NFC_SIGNING_SECRET` is unset). `consumer@example.com` ("jane kamaea") exists with different data — do not use it for parity comparisons.

---

## 2. OPEN BUGS — three-state status

Committed = code is in git. Applied = the fix is on disk and in the artifact that actually runs. Verified = a human watched it work and pasted the evidence.

| # | Bug | Severity | Committed | Applied | Verified | Blocks |
|---|---|---|---|---|---|---|
| 11 | Merchant app fatal crash on launch: `SentryInitProvider` "DSN is required" | 🔴 Blocker | `94afe82` | Yes — debug manifest overlay on disk | **No** — APK not rebuilt or launched since | Every merchant-app test |
| 16 | Consumer wallet "Scan QR" and "Send Money" buttons have no click listeners (`HomeFragment.kt` binds seven text views, zero buttons) | 🔴 High | No | No | No | P2P entirely unreachable. **Unblocked today** — XML can now be read (F-2) |
| 17 | Token expiry → raw 401 / `Bearer null` / possible `HttpException`; no refresh handling | 🔴 High | `176101f` (both apps) | Yes in source; APKs not rebuilt | **No** — never fired a real refresh | Any session beyond 8 h (merchant) or 24 h (consumer) |
| 21 | **NEW.** Consumer refresh handler in `auth.ts` builds its response from `consumer.id`, `consumer.phone`, `consumer.display_name`, but the visible code destructures `consumer_id`, `phone`, `display_name` from the row and never defines `consumer`. If undefined, every consumer refresh returns 500 | 🟡 Hypothesis — 🔴 if true | — | — | — | Bug #17 consumer verification. One curl closes it (§11 Phase 0) |
| 17b | `AuthEventBus` / `ConsumerAuthEventBus` force-logout signal not consumed by any Activity | 🟢 Low | — | — | — | Only matters when refresh itself fails |
| 17c | Merchant device-binding key (`merchant:device:{id}`, 9 h TTL) may not be re-armed by `/auth/refresh` → a valid refreshed JWT is rejected at hour 9 | 🟡 Hypothesis | — | — | — | Sustained merchant sessions |
| 17d | WebSocket authenticated at connect with the old JWT; behaviour after refresh unknown | 🟡 Hypothesis | — | — | — | `PAYMENT_CONFIRMED` delivery after hour 8 |
| 17f | **NEW.** Merchant refresh response reportedly returns fewer fields than consumer (`token`, `refreshToken` only per Session 5). Whether the merchant client derives `expiresAt` correctly is unread | 🟡 Unknown | — | — | — | Bug #17 merchant verification |
| 20 | APDU instruction bytes: reader changed to `0x80`/`0x81` in `16e333c`; `Tap2Pay/README.md` documents `0x80 0xC0` / `0x80 0xC1`. Reader, HCE service, `apduservice.xml`, and docs need a three-way check | 🟡 Medium | — | — | — | Phase 6 tap test |
| 15 | 108 backend test failures across 7 suites; CI status on the fork unknown | 🟡 Medium | — | — | — | Any deployment |
| 22 | **NEW.** Build artifacts tracked in git (`web/.next/`, `web/tsconfig.tsbuildinfo`) | 🟡 Hygiene | Cleanup commit today | — | — | Repo hygiene, diff noise |
| 19 | Documentation drift catalogue (§10) | 🟡 Corrosive | Root README + CLAUDE.md rewritten today | — | — | Onboarding accuracy |
| — | NFC and HCE never executed on two physical phones | 🔴 Product thesis | — | — | — | Everything |

**Closed this session:** #17e (consumer refresh does return `expiresAt` — see §1), #18 (dirty tree was a stale working copy, not line endings — see F-3).

**Closed earlier:** #1–#10, #12–#14 — one line each in §5.

---

## 3. FINDINGS THIS SESSION

**F-1 — Bug #11 is applied on disk, not just committed.** `ls -la Tap2Pay/android/app/src/debug/` shows `AndroidManifest.xml`, 237 bytes, 2 Sep 23:09. Dumped through sed, it is a manifest containing an application block with one meta-data entry disabling Sentry auto-init. The Session 5 handover, committed the next day, said "fix written, not applied" — that was wrong by one state. Remaining: rebuild `:app`, install, launch, paste logcat showing no `SentryInitProvider` exception and the login screen on screen.

**F-2 — CONFIRMED: angle brackets are stripped when text is pasted into the AI chat.** Three independent proofs today: the sed-transformed manifest arrived intact with square brackets; the Kotlin file pasted directly arrived with every generic removed (`List`, `Map`, `retrofit2.Response` all lost their type parameters); `network_security_config.xml` arrived as text nodes only. The "terminal cat quirk" recorded in Session 5 never existed — the terminal was fine. The Bug #2 false positive in July ("HCE service not in manifest", retracted in `4d77878`) was almost certainly the same mechanism. This rule is now in §0 and in `CLAUDE.md`.

**F-3 — The dirty `ConsumerApiClient.kt` was a stale working copy; HEAD is correct.** `git diff -w --stat` showed 53 insertions / 407 deletions — the working copy was the pre-Bug-#17 file. After the previous dev's final version was pasted back in, `git add` produced no staged change: working copy equals HEAD `176101f`. The Session 6 lead has now read the consumer client in full. It is sound: OkHttp `Authenticator` (correct mechanism, not an interceptor); synchronized single-flight refresh with a "did another thread already refresh" check; separate refresh client with no authenticator attached (no recursion); one retry enforced via `priorResponse` counting; `bearer()` returns null instead of the string `Bearer null`; nullable `@Header` so Retrofit omits the header; force-logout via `ConsumerAuthEventBus.onForceLogout` (unwired — #17b). The merchant-side files in `176101f` (`OrchestaApiClient.kt`, `SessionManager.kt`) have not been read by the Session 6 lead.

**F-4 — Reading the consumer refresh handler closed #17e and opened #21.** Lines ~690–711 of `auth.ts`: the row is destructured as `id: tokenId, consumer_id, display_name, phone, active`; the token is revoked; new tokens are issued; the response is built from `consumer.id`, `consumer.phone`, `consumer.display_name`, plus `expiresAt`. No `consumer` variable is defined in the visible range. If it is not defined above line 690, the reference throws, the catch returns 500, and the consumer Authenticator will always fall into its force-logout path. This looks like a copy-paste from the login handler where the row was named `consumer`. It is a hypothesis until one of two things is done: read lines 660–690, or — better, because it is the actual proof — log in as consumer2, take the `refreshToken`, POST it to `/api/v1/auth/consumer/refresh`, and paste the status and body.

**F-5 — Repository contents that no document mentioned.** From `git ls-files`: `skills/` contains 42 `SKILL.md` files (one per subsystem: daraja, hce-crypto, reconciliation, softpos, websocket, etc.) plus `skills-lock.json` — these are AI-agent skill packs written in Era 1 and should be read as design intent, never as status. `.agents/skills/` holds two generic skills (`systematic-debugging`, `tdd`). Three docker-compose files exist: root `docker-compose.yml`, root `docker-compose.ha.yml`, and `Tap2Pay/docker-compose.yml` — none usable on the current machine (no Docker). `scripts/extract-tls-pin.sh` exists. `Tap2Pay/backend/docs/` exists with unknown contents. `Tap2Pay/backend/load-test.js` exists. `Tap2Pay/package.json` provides aggregate test scripts. `Tap2Pay/web/.next/` — a Next.js build directory — and `tsconfig.tsbuildinfo` are tracked (Bug #22). No archived handovers are tracked. `build_log.txt` under `android/` is on disk but untracked; it needs a gitignore entry.

**F-6 — `gradle.properties` dirty by a trailing newline only.** A pasted git command was removed by hand and the final newline went with it. Restore with `git checkout --`; no commit.

**F-7 — The release build has no backend.** Release `API_BASE_URL` is `https://api.orchestratepay.co.ke/api/v1/`. No deployment of that host is recorded in git, docs, or handovers. K8s manifests had their P0 env-var gaps fixed in `534c7ba` (21 Jun) and have never been applied to a cluster. "Production-ready" anywhere in this repository means "compiles".

**F-8 — Physical-device networking will fail on tap-test day unless prepared.** Debug builds reach the backend via `localhost` plus `adb reverse`, which works for USB-connected devices only, per device, and does not survive an ADB daemon restart. Two phones need two `adb reverse` calls. A Wi-Fi-only phone needs a build pointing at the dev machine's LAN IP with that IP added to the cleartext allowlist in both apps' `network_security_config.xml`, or an ngrok HTTPS URL. Decide, build, and prove a login over the chosen path before the phones are in the room.

---

## 4. BUG #17 — exact state

**Committed (`176101f`, four files, +556 / −293):** merchant `OrchestaApiClient.kt` and `SessionManager.kt`; consumer `ConsumerApiClient.kt` and `ConsumerSessionManager.kt`. Consumer side read and approved by Session 6 (F-3). Merchant side unread by Session 6.

**Backend contract:**

| | Merchant | Consumer |
|---|---|---|
| Endpoint | `POST /api/v1/auth/refresh` | `POST /api/v1/auth/consumer/refresh` |
| Body | `refreshToken` (string) | `refreshToken` (string) |
| Response | `token`, `refreshToken` (per Session 5; re-verify) | `token`, `refreshToken`, `role`, `consumerId`, `phone`, `displayName`, `expiresAt` (verified 3 Sep, subject to #21) |
| Rotation | Single-use; old token revoked on use | Single-use; old token revoked on use |
| TTL | 8 h access / 30 d refresh | 24 h access; refresh TTL unverified |

**Why single-use rotation matters for the client:** two concurrent 401s that both call refresh with the same token → the first succeeds and burns it, the second gets 401 and force-logs-out a user who has a perfectly good session. The consumer client's synchronized block plus its "current token differs from the failed token → just retry with it" check handles this. Confirm the merchant client does the same.

**To call #17 verified, all of the following must be pasted:**
1. #21 closed by a successful curl to the consumer refresh endpoint (200, all seven fields).
2. Merchant refresh curl: 200; note exactly which fields come back (#17f).
3. `git show 176101f -- Tap2Pay/android/app` read end to end; confirm single-flight guard and `expiresAt` derivation.
4. On device: force expiry (set stored `expiresAt` to the past, or wait), fire one authenticated call, paste OkHttp BASIC logging showing 401 → refresh 200 → original request retried 200.
5. Two concurrent authenticated calls after expiry → exactly one refresh request in the backend log.
6. #17c and #17d answered from `middleware/auth.ts`, the refresh handlers, and `ws-server.ts`.
7. #17b: wire `onForceLogout` in both Application classes to clear the back stack and launch the login Activity.

---

## 5. CLOSED BUGS — one line each; details in git

| # | What | Commit |
|---|---|---|
| — | Reader APDU INS bytes `0xC0`→`0x80`, `0xC1`→`0x81` (docs still disagree — #20) | `16e333c` |
| — | HCE payload thread-safety via AtomicReference | `8ef53d8` |
| — | HCE token TTL 60 s → 90 s | `1e3c431` |
| — | targetSdk 35 for nfc-core compatibility | `186521c` |
| — | Google Services plugin disabled — FCM has been off since | `1d332fb` |
| — | consumer-wallet compile failures; Gradle wrapper generated | `fd21ba5` |
| 1 | `:app` launcher icons missing | `e9866d0` |
| 2 | "HCE service not in manifest" — false positive, retracted | `4d77878` |
| 3 | colors.xml | `e9866d0` |
| 4 | kapt → KSP for Room | `e9866d0` |
| 5 | Five post-KSP compile clusters | `e9866d0` |
| 6 | nfc-core `consumer-rules.pro` missing | `6e33592` |
| 7 | softpos launcher icons + AnimatorSet.repeatCount | `35ec698` |
| 8 | Debug URL `10.0.2.2` → `localhost` + `adb reverse` | `73b066c` |
| 9 | No test accounts | manual DB, Session 4 |
| 10 | Consumer auth response missing `phone`/`displayName` → NPE on login | `154b0a9` |
| 12 | Web `npm run dev` used Linux-only `fuser` | `1df609c` |
| 13 | Orphaned ts-node-dev + premature curl (runbook, §7) | — |
| 14 | `/consumers/me/loyalty` SQL against non-existent columns killed the process; `asyncHandler` added | `b6f4f07`, `27bf4af`, `52197d6` (accidental revert), `23ef6f6` (restore) |
| 17e | Consumer refresh returns `expiresAt` | verified 3 Sep |
| 18 | Dirty tree after commit — stale working copy | resolved 3 Sep |

---

## 6. OBSERVATIONS — not bugs

1. The web-vs-Android "disparity" was two different accounts. Parity comparisons are only valid on the same account.
2. Functional parity proven; visual parity not. Wallet UI is green, web is dark glass. Product decision (#43), after functional milestones.
3. `nfcSigningKey` is null at merchant login until `NFC_SIGNING_SECRET` is set. Required before any tag-payment test.
4. Seven cron jobs run live (reconciliation, GL posting, webhook delivery, subscription billing, trial expiry, FX refresh, MV refresh). Backend README §9 lists them.
5. `Tap2Pay/dashboard/` — React 18 + Vite 5, zero docs, purpose unknown. Product-owner ruling needed.
6. `androidTest` sources are stale — `LoginActivityTest.kt` references view IDs that no longer exist. Does not affect `assembleDebug`. The other three files are unassessed; one Gradle command (Phase 3) will show which compile.
7. `npm` on this machine blocks install scripts; bcrypt's native binding works anyway. Never approve `@scarf/scarf`.
8. Emulators have no NFC radio. Emulator value = login, UI, API, parity. HCE and tag flows need two physical phones, or one phone plus an ACR122U USB reader.
9. Merchant login enforces single device — emulator, phone, and web kick each other. By design.
10. `IdempotencyKeyGen.kt` produces 32 lowercase hex characters and passes Joi. Not a bug.
11. `POST /transactions` never returns `PENDING` over HTTP — expect `201 STK_SENT` or `502 FAILED`. Tests must accept both.
12. P2P features (`P2PSendActivity`, `/wallet`, `p2p-transactions` tests) appear in code and tests and in zero product docs — the exact profile that produced Bug #16.
13. `softpos/` has no login screen. Not a shippable product; descoped from every "production" claim.
14. A fresh environment cannot log a merchant in from Android until a merchant is registered (needs `ADMIN_SECRET`) and approved.
15. Daraja `DARAJA_CONSUMER_KEY/SECRET` are placeholders on the dev machine → every STK Push returns 502. Real sandbox keys are a Phase 6 prerequisite.
16. `skills/` (42 files) is a large body of subsystem design notes written before any hardware test. Useful for understanding intent; useless for understanding status.

---

## 7. ENVIRONMENT — Windows / Git Bash (MINGW64)

**Every new terminal:** `pwd`, `which adb`, `java -version`. PATH does not persist reliably.

**Redis:** not on PATH. `/c/Users/admin/redis/redis-server.exe --port 6379`, leave running. `redis-cli ping` → PONG. Backend log "Reached the max retries per request limit" means Redis is down.

**PostgreSQL:** native on `:5432`. **Docker is not installed** — all three compose files are unusable here.

**netstat:** `/c/Windows/System32/netstat.exe -ano`.

**Backend:** `cd Tap2Pay/backend && npm run dev`. Wait for the literal line `OrchestratePay backend running on port 3000`. `EADDRINUSE` means an orphan: find the PID via netstat, `taskkill //F //PID <pid>` (double slashes). Ctrl+C does not reliably kill npm children — verify the port is free after stopping.

**Web:** `cd Tap2Pay/web && npm run dev` → `:3001`, proxies `/api/*` to `:3000`.

**Android:** `export PATH="$PATH:/c/Users/admin/AppData/Local/Android/Sdk/platform-tools"` if adb is missing. `adb reverse tcp:3000 tcp:3000` per device, again after every ADB daemon restart; check `adb reverse --list` before diagnosing "Failed to connect". Emulator `emulator-5554`; real device `RF8R42CY49R`. Build: `cd Tap2Pay/android && ./gradlew assembleDebug` (Gradle 9.4.1, Java 21; AGP deprecation warnings are noise). Fast single-module check: `./gradlew :consumer-wallet:compileDebugKotlin`. Install: `adb -s emulator-5554 install -r app/build/outputs/apk/debug/app-debug.apk`. Crash triage: `adb logcat -s AndroidRuntime:E`.

**Pasting:** one command per paste. XML and Kotlin through `sed 's/</[/g; s/>/]/g' FILE` before pasting into chat (F-2). Editing files: VS Code, not heredocs.

**Git:** `git status --short` before every commit. `git push fork main`. A file showing modified immediately after a commit: `git diff -w --stat` first, then decide — it was a stale copy last time, not line endings.

---

## 8. REPOSITORY STRUCTURE — from `git ls-files`, 3 Sep 2026

    OrchestratePay_Platform/
    ├── README.md                      design + how-to; rewritten 3 Sep; no status words
    ├── CLAUDE.md                      AI-session orientation + rules; rewritten 3 Sep
    ├── LICENSE
    ├── .gitignore
    ├── .github/workflows/ci.yml       claims to test on push; fork status unknown (Bug #15)
    ├── .agents/skills/                systematic-debugging, tdd — generic agent skills
    ├── skills/                        42 orchestratepay-* SKILL.md + skills-lock.json — design intent, not status
    ├── scripts/extract-tls-pin.sh
    ├── docker-compose.yml             root; unusable here (no Docker)
    ├── docker-compose.ha.yml          root; HA variant; unusable here
    ├── docs/
    │   ├── SESSION_HANDOVER.md        THIS FILE — the only status document
    │   ├── PRODUCTION_READINESS_CHECKLIST.md   compliance + deploy gates; needs restructure (§10)
    │   ├── ANDROID_NFC_TESTING_PROTOCOL.md     two-phone tap procedure; pre-flight superseded by this file
    │   └── IOS_LIMITATIONS_AND_FALLBACK.md     why no iOS HCE; QR fallback
    ├── infra/
    │   ├── k8s/  namespace, secrets.template, backend/, postgres/, redis/, ingress/   never applied
    │   └── nginx/nginx-lb.conf
    └── Tap2Pay/
        ├── README.md                  most detailed, most stale — slim in Phase 4
        ├── package.json               aggregate test scripts
        ├── docker-compose.yml         third compose file
        ├── backend/                   Express + TS; src/{routes(21), middleware, integrations, jobs, realtime, util, db/migrations(001–004), __tests__(93)}
        │   ├── docs/                  contents not yet inventoried
        │   ├── load-test.js
        │   ├── Dockerfile, entrypoint.sh, jest.config.js, .env.example, README.md (best reference)
        ├── web/                       Vite 6 + React 19; src/, e2e/, __mocks__/, public/, README.md
        │   ├── .next/                 TRACKED Next.js artifact — removing today (Bug #22)
        │   └── tsconfig.tsbuildinfo   TRACKED artifact — removing today (Bug #22)
        ├── dashboard/                 React 18 + Vite 5; undocumented; ruling pending
        └── android/
            ├── build.gradle, settings.gradle, gradle.properties, common-proguard-rules.pro   (Groovy root)
            ├── gradlew, gradlew.bat, gradle/           checked in
            ├── build_log.txt                           on disk, untracked — gitignore today
            ├── README.md
            ├── app/                   merchant terminal, com.orchestratepay; src/{main, debug (Sentry overlay), test, androidTest(2 files)}
            ├── consumer-wallet/       HCE wallet, com.orchestratepay.consumer; src/{main, test, androidTest(2 files)}
            ├── nfc-core/              shared library (.kts)
            └── softpos/               builds; no login UI

Regenerate with the command in §0 step 4 whenever you suspect drift.

---

## 9. ANNOTATED GIT HISTORY — read alongside `git log --oneline --reverse`

**Era 1 — Upstream (Gabriel, 5 Jun – 20 Jul 2026, `5c96c86` → `fb1dad6`).** Initial platform. `851e5c9`/`caad8f7` upgrade Next.js 14→15. `8f72155` (26 Jun) "web app changes to react" — web becomes Vite; every Next.js reference in docs predates this. `534c7ba` fixes K8s P0 env gaps. `9b4a72e` and `5e65226` declare "production ready" — no device had run the code. `fb1dad6` is `origin/main` tip. Nothing in this era was hardware-tested. The `skills/` directory and `.next/` artifact date from here.

**Era 2 — Session 1 (23–24 Jul, `16e333c` → `24b761a`).** Fork begins. Reader APDU INS bytes changed (#20 asks whether the HCE side agrees). Thread-safety and TTL fixes. Security audit and iOS docs. Six documentation commits claiming "system verified" — meaning web login worked.

**Era 3 — Session 2 (27–29 Jul, `186521c` → `39bd03c`).** targetSdk 35. Google Services plugin disabled (`1d332fb`) — FCM dead since. Gradle wrapper generated. 150+ compile errors traced to four root causes. First full `assembleDebug` finds Bug #1 (real) and Bug #2 (false — retracted 8 Aug in `4d77878`; in hindsight the F-2 mechanism).

**Era 4 — Session 3 (12 Aug, `e9866d0` → `c6d2b57`).** kapt → KSP, five compile clusters, nfc-core proguard, softpos icons. All four modules build green for the first time. `c6d2b57` claims "2nd NFC phone confirmed" — retracted in `b3c2cc9`.

**Era 5 — Session 4 (16 Aug, `73b066c` → `b3c2cc9`).** `10.0.2.2` → `localhost`. Consumer auth NPE fixed (Bug #10). Consumer wallet works end to end on a real phone — the project's first real-device proof. `b3c2cc9` corrects the prior handover's false claims and institutes the "no status without output" rule.

**Era 6 — Session 5 (2–3 Sep, `1df609c` → `176101f`).** Windows dev-script fix. Bug #14 process-kill fixed, accidentally reverted in `52197d6`, restored in `23ef6f6`. `94afe82` commits the Bug #11 Sentry overlay. `feebff7` handover (wrongly says #11 unapplied). `176101f` Bug #17 refresh-token handling, both apps.

**Era 7 — Session 6 (3 Sep, `08eb61d` →).** Onboarding re-baseline: three-state bug tracking, annotated history, F-1 through F-8. Root README and CLAUDE.md rewritten with no status claims. Build-artifact cleanup. No product code changed.

**The pattern to internalise:** three separate retractions (`4d77878`, `b3c2cc9`, F-1) all came from writing status without running the command. Before `b3c2cc9`, read "verified" as "compiled".

---

## 10. DOCUMENTATION MAP — trust and action

| Document | Trust | Action |
|---|---|---|
| `docs/SESSION_HANDOVER.md` | High — evidence-cited | Update every session. Only status document. |
| `README.md` (root) | High after 3 Sep | Rewritten: three-column feature status, native quick start, no "production-ready". |
| `CLAUDE.md` | High after 3 Sep | Rewritten: rules, 21 routes, 7 jobs, real test counts, Android facts, F-2 rule. |
| `Tap2Pay/backend/README.md` | High | Best technical reference. Fix test count in Phase 4. |
| `Tap2Pay/web/README.md` | High | Keep. |
| `Tap2Pay/android/README.md` | Medium | Phase 4: wrapper IS checked in; add prerequisites block; Sentry overlay; FCM disabled; sed paste rule; androidTest status. |
| `docs/ANDROID_NFC_TESTING_PROTOCOL.md` | Medium | Phase 4: point pre-flight and accounts at this file; add F-8 networking prep; add #20 APDU three-way check as Test 0. |
| `docs/PRODUCTION_READINESS_CHECKLIST.md` | Low–Medium (not re-read since Session 5) | Do not delete — holds CBK/KRA/DPA items with month-long lead times. Phase 4: restructure into Phase S/H/P gates with three-state columns; drop items now tracked as bugs here. |
| `docs/IOS_LIMITATIONS_AND_FALLBACK.md` | Medium | Keep. Reference. |
| `Tap2Pay/README.md` | **Low** | Phase 4: cut to Payment Flows + Security Model + an index. Delete Next.js, `NEXT_PUBLIC_*`, all three test counts, "no k8s yet", `10.0.2.2`, SDK 34, "placeholder pins", SoftPOS-as-product. |
| `skills/*/SKILL.md`, `.agents/skills/` | Design intent only | Keep. Never cite for status. Consider a one-line header in each stating this (Phase 4, optional). |
| `Tap2Pay/backend/docs/` | Unknown | Inventory in Phase 4. |

**Test files — decision: keep them, quarantine the failing seven.** Backend: 1,847 passing tests are the only regression net on idempotency, callbacks, lockout, and the circuit breaker; deleting them would blind every future change. The problem is seven failing suites, not 93. Web: 452 passing assertions, keep. Android JVM tests: keep, they run without a device. Android `androidTest`: `LoginActivityTest.kt` is confirmed dead; the other three are assessed by one compile command in Phase 3 and deleted if they fail.

**Convention adopted 3 Sep:** READMEs describe design and operation and never carry status words. Status lives here in three states. Checklist items are split into backend / client / verified — a merged checkbox is how the refresh-token gap survived for months.

---

## 11. PLAN — each phase unblocks the next

**Phase 0 — Truth (start of next session, ~20 min)**
- [ ] Log in as consumer2 via curl, extract `refreshToken`, POST it to `/api/v1/auth/consumer/refresh`. Paste status + body. **Closes or confirms #21.** If 500: read `auth.ts` lines 660–690 and fix the `consumer` reference in the same session.
- [ ] Same for merchant: login, refresh, paste the exact response fields. **Closes #17f.**
- [ ] `git status --short` clean; `adb devices`; `adb reverse --list`; `/readiness` ready; `redis-cli ping`.

**Phase 1 — Merchant app exists (Bug #11 → Verified)**
- [ ] `./gradlew :app:assembleDebug` → `adb install -r` on `emulator-5554` → launch → paste `adb logcat -s AndroidRuntime:E` showing nothing, and describe the login screen.
- [ ] Login `merchant@test.com` / `TestPass123` / device `emu-01`. Paste the backend log line.

**Phase 2 — Bug #16**
- [ ] Dump `fragment_home.xml`, `activity_home.xml`, and the consumer-wallet `AndroidManifest.xml` through sed. Record button view IDs.
- [ ] Wire click listeners in `HomeFragment.kt` to `P2PQrScannerActivity` and `P2PSendActivity`; confirm both are declared in the manifest; rebuild; tap; paste logcat showing the Activity start.

**Phase 2.5 — Contract audit, once, as a table (no hardware)**
- [ ] Grep both Android modules for every Retrofit endpoint. For each, compare the Kotlin response class to the route's actual JSON. Record in a new §13 table. This is the Bug #10/#14/#17 disease found in one pass instead of one tap at a time.
- [ ] #20: `NfcReaderManager` INS bytes vs both HCE services vs `apduservice.xml` vs README.
- [ ] #17c and #17d from `middleware/auth.ts`, the refresh handlers, `ws-server.ts`.

**Phase 3 — Bug #17 runtime + smoke pass**
- [ ] Read `git show 176101f -- Tap2Pay/android/app` end to end.
- [ ] Force expiry; one call → paste 401 → refresh 200 → retry 200. Two concurrent calls → one refresh in the backend log.
- [ ] Wire `onForceLogout` in both Application classes (#17b).
- [ ] `./gradlew :app:compileDebugAndroidTestKotlin :consumer-wallet:compileDebugAndroidTestKotlin` — delete whatever fails.
- [ ] Smoke checklist, both apps, every screen, every button: table of screen / expected / actual / evidence. Expect more Bug-#16-class finds.

**Phase 4 — Documentation (per §10)**
- [ ] `Tap2Pay/README.md` slimmed; android README prerequisites; NFC protocol pointers; checklist restructured; backend README test count; inventory `backend/docs/`.

**Phase 5 — Bug #15 and CI**
- [ ] Determine whether Actions run on the fork. If red or absent, it is a deployment gate.
- [ ] Quarantine the seven failing suites with a comment referencing #15 so `npm test` is green and meaningful; then fix by cluster (`routes-auth-mock` 55, `admin-audit`, `merchant-refresh-token`, `account-lockout`, `consumer-otp`, `coverage-gaps-routes`, `ws-server-full`).

**Phase 6 prerequisites — before phones arrive**
- [ ] Networking decision (F-8) built and proven with one login.
- [ ] `NFC_SIGNING_SECRET` set; `nfcSigningKey` non-null at merchant login.
- [ ] Real Daraja sandbox keys in `.env`; one STK Push returns `201 STK_SENT`.
- [ ] Merchant app login on real device `RF8R42CY49R`.

**Phase 6 — The milestone**
- [ ] `adb devices` showing two physical devices, pasted.
- [ ] `ANDROID_NFC_TESTING_PROTOCOL.md` Tests 1–4: one real tap → one STK Push → callback → `PAYMENT_CONFIRMED` on the terminal. Logs pasted for each hop.

**Deployment path — gated on Phases 3, 5, 6.** S (staging): re-check k8s P0 → VPS → domain + TLS → nginx → Daraja sandbox → `staging` buildType (fix the defaultConfig `/v1/` path) → signed APKs. H (hardening): JWT_SECRET rotation, DB SSL, Sentry DSN for Android + backend Sentry 8→10, `security-crypto` off alpha, backups, re-enable FCM. P (production): Safaricom go-live, CBK PSP licence (3–6 months — must already be in motion), KRA eTIMS, Kenya DPA 2019.

**Product-owner rulings outstanding:** `Tap2Pay/dashboard/` fate · design-language unification (#43) · SoftPOS in or out of scope · owner for Daraja sandbox credentials · whether `docker-compose.ha.yml` is maintained.

---

## 12. DECISION LOG

| Date | Decision | Rationale / incident |
|---|---|---|
| 2026-08-16 | No status claim without pasted output | Prior handover declared a clean tree and a second phone; both false |
| 2026-09-02 | `git status --short` before every commit | `52197d6` swept in a reverted file — one-line fix became a regression |
| 2026-09-02 | One command per paste; wait for the "running on port" line | Scrambled heredocs; phantom "backend broken" |
| 2026-09-02 | Emulator adopted as standing third test surface | Found Bug #11 for free; proved wallet parity |
| 2026-09-03 | Three-state bug status (Committed / Applied / Verified) | Bug #11 committed and reported unapplied the next day |
| 2026-09-03 | Angle-bracket rule: sed before pasting XML/Kotlin | Confirmed by three independent pastes; retires the false "cat quirk"; likely explains the July Bug #2 false positive |
| 2026-09-03 | Mandatory onboarding order (§0) | Newcomers were reading the most-detailed-most-wrong doc first |
| 2026-09-03 | READMEs carry no status; status lives here only | Doc drift is the mechanism that hid #11, #16, #17 |
| 2026-09-03 | Keep all test suites; quarantine the failing seven | 1,847 passing tests are the only regression net |
| 2026-09-03 | Contract audit (Phase 2.5) before more button-tapping | #10, #14, #17 are one disease |
| 2026-09-03 | Physical-device networking solved before the tap test | Debug builds are USB-only |
| 2026-09-03 | "Production-ready" in any existing doc redefined as "compiles" until Phase 6 passes | No feature has been executed on hardware end to end |
| 2026-09-03 | Do not `git checkout --` a mysteriously dirty file without `git diff -w --stat` first | Today's was a stale copy; tomorrow's could be an uncommitted fix |

---

## 13. SESSION 6 COMMIT LOG

| Hash | Change |
|---|---|
| `08eb61d` | docs(handover): session 6 re-baseline |
| (today) | chore: untrack `web/.next/` and `tsconfig.tsbuildinfo`; gitignore artifacts (Bug #22) |
| (today) | docs: root README + CLAUDE.md rewrite; handover final for Session 6 |

No product code was changed in Session 6. The next session starts at Phase 0 with the #21 curl.

---
END OF SESSION_HANDOVER.md