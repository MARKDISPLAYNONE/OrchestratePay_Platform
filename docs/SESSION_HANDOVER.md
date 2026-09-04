# SESSION_HANDOVER.md

**Last Updated:** 4 September 2026, ~19:00 — end of Session 10
**Project:** OrchestratePay Platform
**Prepared by:** Lead Dev, Session 10 (handover from Session 9 lead)
**Recipient:** Any developer or AI session touching this repository

**This is the only document in the repository that carries project STATUS.** READMEs describe design and operation. This file describes what is proven, what is broken, what is unknown, and what to do next — with the command output that backs each claim.

**One-paragraph status:** Session 10 closed **Bug #32 on the backend** (`0ed02d6`): merchant `/auth/refresh` is now device-bound — `deviceId` required, mismatch/NULL revokes the token and returns 401, the JWT is minted with the caller's `deviceId` (the `?? ''` empty-deviceId bypass path is gone), and `merchant:device` is re-armed on refresh. **Smoke is 35/35.** The Android client half (`RefreshRequest.deviceId`, `SessionManager.saveSession(deviceId)`, force-logout on missing deviceId) is **built and installed on emulator-5554 but uncommitted and not yet observed at runtime**. A full-system run was executed for the first time: backend smoke 35/35, backend unit tests **1945/1959 passing (10 failing in 4 suites — down from the recorded 108/7, and at least two of the four are refresh suites that likely now need `deviceId`)**, web unit tests **785/785 in 39 suites** (docs said 452/23), web production build green, all 4 Android modules `BUILD SUCCESSFUL`, both debug APKs installed. Payments are still blocked on Daraja sandbox credentials (every STK Push is 502). NFC/HCE still needs a second physical phone; §16 is the pre-flight checklist to complete before it arrives. Session 9's uncommitted `auth.ts` was found to be a chat-reconstructed file (114 whitespace lines, a stripped generic) — the feature was salvaged by line-range splice from the on-disk copy, never from chat (F-31).

---

## 0. ONBOARDING — mandatory path, in this order

Seven previous handovers, commit messages, or advisors were wrong about repository or device state because the writer trusted a document, a chat message, or their own intent instead of running a command. Budget ~90 minutes. Paste every command's output into your session log. **All commands in this document run from the repository root** unless wrapped in `(cd … && …)`.

**Step 1 — Read this document, top to bottom.** ~25 min. Do not skip §2, §3, §11, §16. Done when you can: name the open High bug (#17) and the half-open one (#32 Android side); explain why Session 9's dirty `auth.ts` was not committed as-is (F-31); say what blocks payments (Daraja keys) and what blocks NFC (second phone).

**Step 2 — Confirm the repository matches §1.**
```
git log --oneline -5
```
```
git status --short
```
```
git remote -v
```
HEAD at or after `0ed02d6`; tree either clean or exactly the two Android files in §1; `fork` → MARKDISPLAYNONE, `origin` → gabrielngige. Anything else: stop, reconcile, record.

**Step 3 — Read the history with §9.** `git log --oneline --reverse`. Done when you can point at the four commits whose messages describe content they lack (#25) and know to read `git show --stat` before believing any message.

**Step 4 — Regenerate the tree and compare to §8.**
```
git ls-files | awk -F/ 'NF>2{print $1"/"$2"/"$3}NF<=2{print $0}' | sort -u
```

**Step 5 — Read the other documents per §10.** Not `Tap2Pay/README.md` first.

**Step 6 — Bring the environment up per §7.** Run the smoke; expect `PASS=35 FAIL=0`.

**Step 7 — Pick the top unchecked item in §11.** Work it, paste the evidence, update §2/§12/§14, commit, `git show --stat HEAD`, push to `fork`.

**Standing rules — each exists because it was violated and something broke (§12):**

- No status claim without pasted command output. Not in chat, not in docs, not in commit messages.
- "Committed", "applied", and "verified" are three different states. §2 tracks all three.
- `git status --short` before every commit. `git show --stat HEAD` after. **Never in the same `&&` chain as the commit.**
- `git diff --stat` and `git diff -w --stat` before every commit. If they disagree, the diff carries whitespace noise; clean it before committing (F-23, F-31).
- **Partial commits use `git commit -m "…" -- path1 path2` — pathspec AFTER the message.** `git commit -- paths -m "…"` treats `-m` as a path and commits nothing (Session 10).
- Push to `fork`, never `origin`.
- One command per paste, keep commands short, run from repo root. If you `cd` somewhere for one command, wrap it in `( … )` so the shell comes back.
- **Never restore or rewrite a source file from a chat paste.** Chat strips angle brackets and eats spaces at random (`Promise<never>` → `Promise(`, `presentwhen`, `backedtoken`). When a file must be reconstructed, `cp` the on-disk copy to `/tmp`, `git checkout --` the original, and splice back only the feature lines by `sed -n 'A,Bp'` line range + `sed -i 'Nr'` (F-31, §7).
- XML / generics-heavy Kotlin through `sed 's/</[/g; s/>/]/g' FILE` before pasting into chat.
- Never pipe a Gradle build to `tail -3`. Use `2>&1 | grep -E "^e: |error:|FAILED|BUILD"`.
- Build → install is one `&&` chain; check the APK mtime against your last edit.
- Activity-state proof is `dumpsys activity activities | grep topResumedActivity`, plus `logcat -b crash -d`. Main logcat buffer is unusable on this emulator.
- A diagnosed corruption is reverted before the next command.
- Advice from any source is checked against output already on screen before it changes a command (F-15).
- **The onboarding brief's stack claim is checked against `package.json` / `build.gradle`.** Sessions 9 and 10 were both briefed "Next.js 16 / Prisma 7 / Zod 4". The repo is Express 4 + TS 5 + `pg` + Joi 17 / Vite 6 + React 19 / Kotlin. The repo wins. Do not introduce Prisma, Zod, or Next.js.
- **Do not run the smoke while the merchant app is signed in on a device** unless you are deliberately testing #32 force-logout (§11 Phase 1). It logs in as `merchant@test.com` / `smoke-01` and rewrites the device binding.
- Backend readiness is the literal log line `OrchestratePay backend running on port 3000`.
- READMEs never carry status words. Status lives here.

---

## 1. GROUND TRUTH — verified by pasted output, 4 September 2026

| Item | State | Evidence |
|---|---|---|
| Machine clock | 4 Sep 2026 ~19:00 | commit `0ed02d6` `Fri Sep 4 18:47:50 2026 +0300`; `/health/deep` `2026-09-04T15:49:46Z` |
| HEAD | `0ed02d6` on `main` | `git show --stat HEAD` → 2 files, +40/−5 (`auth.ts` +30/−2, `e2e-smoke.sh` +15/−3) |
| `fork/main` | `0ed02d6` | `git push fork main` → `b1dd352..0ed02d6` |
| Ahead of `origin/main` | 55 | 54 at `b1dd352` (`git status`) + `0ed02d6` |
| Working tree | **2 files dirty** — `OrchestaApiClient.kt` (+32), `SessionManager.kt` (+30): the Android half of #32 | `git status --short`; `git diff --stat` = `git diff -w --stat` for both |
| Smoke | **`PASS=35 FAIL=0`** — full check list in §14a | run 4 Sep ~18:50, after `0ed02d6` |
| Backend unit tests | **Suites: 4 failed, 1 skipped, 88 passed (92 of 93). Tests: 10 failed, 4 skipped, 1945 passed, 1959 total.** Failing: `ws-server-full`, `merchant-refresh-token`, `routes-auth-mock`, `coverage-gaps-routes` | `npm test` 4 Sep ~18:55 (post-#32) |
| Backend typecheck | clean | `npx tsc --noEmit && echo TSC_OK` → `TSC_OK` (no `typecheck` npm script exists) |
| `/health/deep` | `{"status":"ok","checks":{"redis":"ok","database":"ok"},"version":"1.0.0"}` | curl 4 Sep |
| Web unit tests | **39 suites, 785 tests, all passing** (README/CLAUDE.md say 23/452 — stale) | `npm run test:unit` |
| Web build | `✓ built in 34.48s`; warning: chunks > 500 kB | `npm run build` |
| Android build | `BUILD SUCCESSFUL in 36s`, all 4 modules, zero `e:` lines | `./gradlew assembleDebug` |
| Android install | `app-debug.apk` and `consumer-wallet-debug.apk` → `Success` on `emulator-5554` | `adb install -r` ×2 |
| Devices | `emulator-5554 device` only | `adb devices` |
| Backend stack (actual) | `express ^4.18.2`, `joi ^17.11.0`, `pg ^8.11.3`, `typescript ^5.3.3` in `package.json`; ts-node-dev reports TypeScript **5.9.3** installed | `grep package.json`; `npm run dev` banner |
| Redis on dev machine | **Redis 5.0.14.1** (`/c/Users/admin/redis/redis-server.exe`), not Redis 7 as the READMEs assume for Docker | server banner |
| Line endings | `core.autocrlf=true`; `auth.ts` is CRLF on disk; `e2e-smoke.sh` is LF and Git warns it will be converted → no `.gitattributes` yet | `file`, `git config`, commit warnings |
| Bug #32 backend | **Committed `0ed02d6`, applied (ts-node-dev reload), verified** | smoke checks 14–18 (§14a) |
| Bug #32 Android | **Uncommitted; built + installed; not verified** | `git status`; install `Success` |
| `/auth/refresh` (merchant) contract | body `{refreshToken, deviceId}` → `{token, refreshToken, role, merchantId, expiresAt}`; 400 without `deviceId`; 401 + revoke on mismatch or NULL DB `device_id` | `auth.ts` L163–L199 post-splice; smoke |
| `checkDeviceBinding` legacy bypass | `if (!payload.deviceId) return true` **still present** at `middleware/auth.ts` ~L150; unreachable via refresh now, still reachable by any hand-minted JWT | not modified this session |
| Web `/auth/refresh` callers | **none** — web never refreshes (`grep -rn "auth/refresh" Tap2Pay/web/src/lib` → 0 hits) | grep |
| Android `getDeviceId()` callers | `OrchestaApiClient.kt` L298 (TokenAuthenticator, new), `DeviceTelemetryCollector.kt` L62; `saveDeviceId()` in `LoginActivity.kt` L58; `saveSession()` call at `OrchestaApiClient.kt` L418 now also passes `deviceId` | grep |
| Google merchant login | mints JWT `deviceId='google-oauth'`, writes neither `merchants.device_id` nor Redis → cannot refresh post-#32 (F-32) | `auth.ts` read |

**Inherited (Sessions 4–9, not re-verified this session):** emulator packages, backend cron jobs, #24/#16/#11/#30 closures, merchant terminal screen description, wallet log lines, PG/web/wallet-on-device facts, Android SDK 35/26/35, `adb reverse` setup, HCE token mint key/TTL (`merchant:hce:{uuid}`, 60 s), `validate()` `stripUnknown: true`, reader APDU bytes `80 80`/`80 81`.

**Test accounts:** `consumer2@test.com` / `TestPass123` (ID `a09df433-…`, phone 254700000002). `merchant@test.com` / `TestPass123` / device `emu-01` on the emulator, `smoke-01` in the smoke (ID `6fce73f3-8482-43ff-ad67-7dce1db4074a`, APPROVED; `nfcSigningKey` null). Smoke registers a fresh consumer `smoke{epoch}@test.com` each run.

---

## 2. OPEN BUGS — three-state status

| # | Bug | Severity | Committed | Applied | Verified | Blocks |
|---|---|---|---|---|---|---|
| 32 | Merchant refresh rebinds to last login / empty-deviceId bypass. **Backend half closed.** Remaining sub-items below | 🔴 High — security | backend `0ed02d6` | backend yes | backend yes (smoke 35/35) | — |
| 32-A | **Android client**: `RefreshRequest(refreshToken, deviceId)`, `saveSession(…, deviceId)`, TokenAuthenticator force-logs-out on null deviceId | 🔴 High | **no** (dirty tree) | built + installed | **no** — needs Phase 1 emulator observation | #17 runtime proof |
| 32-B | `middleware/auth.ts` ~L150 `if (!payload.deviceId) return true` legacy bypass still in code. Delete it (no legacy JWT survives 8 h; login and refresh both mint with a deviceId now) | 🟡 Medium — defence in depth | — | — | — | CBK story |
| 32-C | Login does not revoke prior refresh tokens; `merchant_refresh_tokens` has no `device_id` column. Migration `005_refresh_device.sql` + revoke-on-login | 🟡 Medium | — | — | — | true single-device |
| 32-D | Backend unit tests for the new contract: `merchant-refresh-token.test.ts` and `routes-auth-mock.test.ts` fail post-#32 — **hypothesis: they POST `/auth/refresh` without `deviceId` and now get 400**. Verify, then update tests to send `deviceId` and add mismatch/NULL cases | 🟡 Medium | — | — | — | #15, CI |
| 17 | Token expiry / refresh handling on device | 🔴 High | `176101f` | yes | **partial** — a genuine merchant re-arm has never been observed (the only observed refresh was #32 rebinding); consumer runtime not observed | sessions > 8 h / 24 h |
| 17b | Force-logout signal unwired (`AuthEventBus.onForceLogout` never registered by any Activity). TokenAuthenticator now *publishes* it in two places (null refresh token, null deviceId) | 🟡 Medium (raised from Low — #32 now depends on it visibly working) | — | — | — | #32-A UX |
| 17d | WS after refresh unknown | 🟡 Hypothesis | — | — | — | `PAYMENT_CONFIRMED` after hour 8 |
| 15 | Backend test failures. **Re-baselined this session: 10 tests / 4 suites** (`ws-server-full`, `merchant-refresh-token`, `routes-auth-mock`, `coverage-gaps-routes`), not 108/7. Unexplained drop — either fixed by `b6f4f07`/`3f761d4` or 108 was miscounted. CI on fork still unknown | 🟡 Medium | — | — | — | deployment |
| 26 | 16 KB page-size: `libbarhopper_v3.so`, `libimage_processing_util_jni.so` not aligned; Play gate | 🟡 Medium — deployment gate | — | — | — | Play release |
| 25 | Commit messages describing content they lack: `52197d6`, `3e618c7`, `2368fec`, `0f5b311` | 🟡 Corrosive | rule in §0 | — | — | trust in `git log` |
| 33 | Malformed JSON → 500, not 400 (`entity.parse.failed` unmapped) | 🟢 Low | — | — | — | alert hygiene |
| 34 | `transactions.ts` L211–235 `MERCHANT_HCE` branch: merchant-auth route the wallet never calls; dead and wrong. Needs product ruling: delete or repurpose | 🟡 Medium | comment flag only | — | — | reader confusion; #20 |
| 35 | HCE token TTL: backend 60 s, Android HCE `TOKEN_TTL_MS` 90 s (`1e3c431`). Recommend 90 s server-side | 🟡 Medium | — | — | — | §16 tap UX |
| 36 | **NEW (F-32).** Google merchant sign-in mints `deviceId='google-oauth'` without writing `merchants.device_id`/Redis → can never pass refresh; probably never passed `checkDeviceBinding` either. Product ruling: is Google merchant login a supported path? If yes, treat it as a login (write binding); if no, remove the branch | 🟡 Medium | — | — | — | web merchant Google login |
| 37 | **NEW.** No `.gitattributes`; `core.autocrlf=true` converts `scripts/*.sh` to CRLF on checkout → bash `$'\r'` failures on any fresh clone. Add `*.sh text eol=lf`, `*.gradle* text eol=lf`, `gradlew text eol=lf` | 🟡 Medium — onboarding | — | — | — | every new dev machine |
| 20 | APDU INS bytes three-way check, both HCE directions (`80 80`/`80 81` in reader code; stale `C0/C1` comments in `NfcReaderManager.kt` header and `Tap2Pay/README.md`) | 🟡 Medium | — | — | — | §16 |
| 19 | Doc drift (§10): web test counts (452→785, 23→39), backend failing count (108→10), Redis version on dev box, `RefreshRequest` shape in `backend/README.md` | 🟡 Corrosive | partial | — | — | onboarding |
| — | Daraja sandbox credentials are placeholders → every STK Push 502 | 🔴 Product blocker | n/a | — | — | **every payment test on every layer** |
| — | NFC/HCE never run on two physical phones | 🔴 Product thesis | — | — | — | everything |

**Closed this session:** #32 backend half (as `0ed02d6`). #31 stays closed. See §5.
**Closed earlier:** #1–#14, #16, #17c, #17e, #17f, #18, #21, #22, #23, #24, #28, #30, #31.

---

## 3. FINDINGS — Session 10 (F-1 – F-29 in the Session 8/9 text, unchanged)

**F-30 — Onboarding brief misdescribed the stack for the third time** ("Next.js 16, Prisma v7, Zod v4+", dated "3/9/26"). `package.json`: Express 4 / Joi 17 / pg 8 / TS 5. Machine clock: 4 Sep. No command was changed by the brief. Rule in §0 now says explicitly: do not introduce Prisma/Zod/Next.

**F-31 — Session 9 left the #32 backend fix uncommitted in a chat-reconstructed `auth.ts`.** `git diff --stat` said `326` lines, `git diff -w --stat` said `212` → 114 lines of whitespace-only change. Inside the `-w` diff, ~150 of 212 lines were cosmetic reflow of untouched handlers (register, consumer login/OTP, Google, admin approve), `new Promise<never>(` had become `new Promise(` (generic eaten by the chat channel), and the trailing newline was lost. **The feature logic itself was correct and complete.** Recovery: `cp auth.ts /tmp/auth32.dirty.ts` → `git checkout -- auth.ts` → `sed -n` three line-range blocks out of the dirty copy → `sed -i 'Nr'` into HEAD's handler + two one-line `s///`. Result: +28/−2, `--stat` = `-w --stat`, `tsc` clean, smoke 35/35. Technique recorded in §7. Nothing was typed from chat.

**F-32 — Google merchant sign-in cannot refresh.** See #36.

**F-33 — Smoke count arithmetic.** Session 9 §11 targeted 33/33 for #32. Actual: the single "merchant refresh" check was replaced by five (400 / 200 / 401 other device / 401 replay / 200 with new access token) → 31 − 1 + 5 = **35**.

**F-34 — Backend test failures are 10/4, not 108/7.** Recorded count was "as of 2 Sep". Either the intervening fixes reduced it or the original figure was wrong; nobody re-ran until now. Two of the four failing suites are refresh suites, so some of the 10 are probably *new* and caused by #32 (32-D). Unverified until someone runs the single suite.

**F-35 — Web test suite is 39/785, not 23/452.** All green. `Tap2Pay/web/README.md` and `CLAUDE.md` are stale.

**F-36 — `git commit -- paths -m` commits nothing.** Git parsed `-m` and the message as pathspecs and errored; the following `git show --stat HEAD` and `git push` then looked at `b1dd352` and reported "Everything up-to-date". A chained version of that would have looked like success. Rule added to §0.

**F-37 — Redis on the dev machine is 5.0.14.1.** All READMEs say Redis 7 (true for `docker-compose.yml`, which cannot run here). Everything used so far (SETEX, SET NX PX, pub/sub, DEL) exists in Redis 5, so no behaviour difference has been observed — but Redis 7-only commands would pass CI and fail on this machine.

**F-38 — `LoginActivity` writes the deviceId twice now** (`saveDeviceId()` at L58 and `saveSession(deviceId=…)` at `OrchestaApiClient.kt` L418). Same value, same key; harmless. Leave the `saveSession` path (it is atomic with the token pair) and delete the `saveDeviceId` call in the 32-A commit or the one after.

---

## 4. BUG #17 / #32 — exact state

Merchant client (`176101f` + uncommitted 32-A): Authenticator is single-flight, retries once, separate refresh client; now reads `SessionManager.getDeviceId()` and sends `RefreshRequest(refreshToken, deviceId)`; null deviceId → `clearSession()` + `AuthEventBus.notifyForceLogout()` + return null. `onForceLogout` is still registered by nobody (17b) — so a forced logout currently means "requests silently return 401 and the UI stays on the dashboard until the user does something". Consumer side: `176101f` approved by read (F-3), never fired at runtime; consumer has no device binding, so #32 does not apply there.

Server side is now correct: a refresh from the wrong device is refused and the token burned. Therefore the emulator test in §11 Phase 1 will, for the first time, show what the merchant app *actually does* on a refused refresh. Expected outcome given 17b: 401 on the next API call, no navigation. That observation is the acceptance test for wiring 17b.

Remaining: 32-A observe → 17b wire → forced-expiry runtime proof on both apps (set `MERCHANT_ACCESS_TTL_S` to 60 locally, wait, tap something) → concurrency → 17d.

---

## 5. CLOSED BUGS — one line each

| # | What | Commit / evidence |
|---|---|---|
| (Sessions 1–9) | as listed in Session 9 §5 | unchanged |
| 32 (backend) | refresh rebinding + empty-deviceId mint | `0ed02d6`; smoke checks 14–18; `tsc` clean |

---

## 6. OBSERVATIONS — not bugs

1–26 as in Session 9. Added:

27. **The Session 9 handover was written before the #32 code existed, then the code was written and the session ended.** Handover said "tree clean" — true at write time, false at hand-off. Rule: `git status --short` is the *last* command of a session, pasted into §1, after the handover commit.
28. `npm run typecheck` does not exist in the backend; use `npx tsc --noEmit`.
29. Backend `npm test` takes several minutes and prints each failing suite twice (once at fail time, once in the summary) — the grep shows 8 `FAIL` lines for 4 suites.
30. Web `npm run build` warns about >500 kB chunks. Cosmetic until we care about first-load time; note for staging.
31. Smoke §6 comment updated: post-#32, running the smoke while the merchant app is signed in on a device forces that device to **re-login** (its refresh is refused), which is the correct behaviour and the Phase 1 test.
32. `DeviceTelemetryCollector` uses the same stored `deviceId` as `deviceSerial` — so after 32-A the telemetry serial and the auth binding are guaranteed to agree.

---

## 7. ENVIRONMENT — Windows / Git Bash (MINGW64)

All Session 8/9 §7 content stands (Redis path, PostgreSQL, backend readiness line, `adb reverse`, scripted-UI traps, evidence commands, pasting, winpty `node` alias). Changes and additions:

**Bring-up (three terminals, from root):**
```
/c/Users/admin/redis/redis-server.exe --port 6379
```
```
(cd Tap2Pay/backend && npm run dev)
```
wait for `OrchestratePay backend running on port 3000`, then
```
curl -s localhost:3000/health/deep
```

**Smoke:** `bash scripts/e2e-smoke.sh 2>&1 | grep -E "FAIL|PASS="` → expect **`PASS=35 FAIL=0`**. Full per-check list: `… | grep -E "^(PASS|FAIL)"`.

**Full-system run (the Session 10 sequence, reusable as a release gate):**
```
bash scripts/e2e-smoke.sh 2>&1 | grep -E "^(PASS|FAIL)"
```
```
(cd Tap2Pay/backend && npx tsc --noEmit && echo TSC_OK)
```
```
(cd Tap2Pay/backend && npm test 2>&1 | grep -E "^Tests:|^Test Suites:|FAIL src")
```
```
(cd Tap2Pay/web && npm run test:unit 2>&1 | grep -E "^Tests:|^Test Suites:")
```
```
(cd Tap2Pay/web && npm run build 2>&1 | tail -5)
```
```
(cd Tap2Pay/android && ./gradlew assembleDebug 2>&1 | grep -E "^e: |error:|FAILED|BUILD")
```
```
adb devices; adb reverse tcp:3000 tcp:3000; adb -s emulator-5554 install -r Tap2Pay/android/app/build/outputs/apk/debug/app-debug.apk && adb -s emulator-5554 install -r Tap2Pay/android/consumer-wallet/build/outputs/apk/debug/consumer-wallet-debug.apk
```
Baseline results are in §1. Anything worse than §1 is a regression.

**Salvaging a chat-damaged file (F-31 technique):**
1. `cp FILE /tmp/FILE.dirty` — the on-disk copy is the only trustworthy source of the feature.
2. `git checkout -- FILE`.
3. `cat -n /tmp/FILE.dirty | sed -n 'A,Bp'` and `cat -n FILE | sed -n 'C,Dp'` to find block boundaries in both (through `sed 's/</[/g; s/>/]/g'` if pasting).
4. `sed -n 'A,Bp' /tmp/FILE.dirty > /tmp/b1.txt` per block; `wc -l` to confirm.
5. One `sed -i -e 'Nr /tmp/b1.txt' -e "Ms/old/new/" FILE` with HEAD line numbers, highest-numbered edits do not shift lower ones because `sed` addresses input lines.
6. `git diff --stat` and `git diff -w --stat` must agree; `tsc`; smoke.

**Git, commits (four pastes, never chained):**
```
git diff --stat; git diff -w --stat
```
```
git status --short
```
```
git commit -m "…" -- path1 path2
```
```
git show --stat HEAD
```
then `git push fork main`. Whole-tree commits: `git commit -am "…"`.

**Line endings:** until #37 lands, expect `LF will be replaced by CRLF` warnings on `*.sh` and on `auth.ts`; they are warnings, not corruption. Do not "fix" them by re-saving files.

**Android on emulator:** `adb reverse tcp:3000 tcp:3000` per adb daemon start. Both APKs currently installed are the builds from this session (`assembleDebug` 18:5x); the merchant APK **contains the uncommitted 32-A change**.

---

## 8. REPOSITORY STRUCTURE

Unchanged from Session 8 §8 (`git ls-files` top-3 tree regenerated 4 Sep, identical; `skills/` has 42 entries).

---

## 9. ANNOTATED GIT HISTORY

Eras 1–10 unchanged (Session 9 text).

**Era 11 — Session 10 (4 Sep, `b1dd352` → `0ed02d6`).**
`b1dd352` Session 9 handover. `0ed02d6` #32 backend: device-bound merchant refresh, smoke 35/35. Message accurate; 2 files; every claim has a smoke line. The Android client half was deliberately left out (unverified at runtime) and the message says so.

**Pattern update:** still four misdescribing commits (`52197d6`, `3e618c7`, `2368fec`, `0f5b311`). No new one this session. Near-miss: F-36 (`git commit -- paths -m`) would have produced a "pushed" claim with nothing pushed if it had been chained.

---

## 10. DOCUMENTATION MAP

Session 9 table stands. Additions / corrections needed (Phase 4):

| Document | Action |
|---|---|
| `Tap2Pay/backend/README.md` | `/auth/refresh` (merchant) body now `{refreshToken, deviceId}`; 400/401 semantics; note the two HCE directions and which route each uses; `stripUnknown`; smoke 35 checks |
| `Tap2Pay/web/README.md` | test counts 39 suites / 785 tests; dev port is 3001 in this repo (README §2 says 5173) |
| `CLAUDE.md` | backend failing count 10/4 (was 108); web 39/785; `npx tsc --noEmit`; commit pathspec rule; never-restore-from-chat rule; Redis 5 on dev box; brief-vs-repo rule third incident |
| `Tap2Pay/android/README.md` | `NfcReaderManager` APDU bytes `80 80`/`80 81`; HCE TTL (#35); `RefreshRequest` now carries `deviceId` |
| `Tap2Pay/README.md` | still says Next.js / `NEXT_PUBLIC_*` / `0xC0 0xC1` / SDK 34 / 13 routes / 85 suites — cut to Payment Flows + Security Model or mark superseded at the top |
| `docs/ANDROID_NFC_TESTING_PROTOCOL.md` | prepend §16 of this file as the pre-flight; add Test 0b (reverse-HCE provable to 502 without radio) |
| `.gitattributes` | create (#37) |

---

## 11. PLAN

**Phase 0 — close Session 10 (now)**
- [ ] Replace `docs/SESSION_HANDOVER.md` with this file. `git status --short` → expect `M docs/SESSION_HANDOVER.md` plus the two Android files.
- [ ] `git commit -m "docs(handover): Session 10 close-out — #32 backend closed (0ed02d6, smoke 35/35), full-system baseline recorded (backend 1945/1959, web 785/785, 4 Android modules green), 32-A/B/C/D, #36, #37 opened, F-30–F-38, NFC test-day pre-flight (§16)" -- docs/SESSION_HANDOVER.md`
- [ ] `git show --stat HEAD` → 1 file. `git push fork main`.
- [ ] `git status --short` as the literal last command → paste into the next session's §1.

**Phase 1 — #32-A on the emulator (~30 min, no hardware)**
- [ ] Merchant app on emulator: log in `merchant@test.com` / `TestPass123` / device `emu-01`. Confirm dashboard.
- [ ] `adb -s emulator-5554 shell dumpsys activity activities | grep topResumedActivity` → paste.
- [ ] Run the smoke (`PASS=35` expected; it binds the merchant to `smoke-01`).
- [ ] In the merchant app: open Transactions or change amount and Present NFC — anything that calls the API. **Expected now:** 401 → TokenAuthenticator → `/auth/refresh` with `deviceId=emu-01` → backend 401 (DB device_id is `smoke-01`) → Authenticator returns null → app shows an error / stays put (17b unwired). **Must NOT:** silently succeed. Evidence: backend log line `Merchant refresh rejected — device mismatch … currentDevice: smoke-01`, and `logcat -b crash -d` empty.
- [ ] Log in again on the emulator → works (login rebinds to `emu-01`).
- [ ] Then commit 32-A: `git diff --stat; git diff -w --stat` (must agree) · `git status --short` · `git commit -m "fix(android): Bug #32 client — RefreshRequest carries deviceId, saveSession persists it atomically with the token pair, TokenAuthenticator force-logs-out when no deviceId is stored. Emulator: refresh from a superseded device observed rejected (backend 'device mismatch' log), no crash" -- Tap2Pay/android/app/src/main/java/com/orchestratepay/api/OrchestaApiClient.kt Tap2Pay/android/app/src/main/java/com/orchestratepay/db/SessionManager.kt` · `git show --stat HEAD` (2 files) · push.
- [ ] Update §2 rows 32-A, 17 with the observation.

**Phase 2 — wire 17b (~45 min)** — register `AuthEventBus.onForceLogout` in `OrchestaPayApp` (Application class) to clear the back stack and start `LoginActivity`. Re-run Phase 1 steps: the app must land on the login screen by itself. That is the first genuine #17 runtime proof.

**Phase 3 — small backend tickets (~2 h total)**
- [ ] 32-D: `(cd Tap2Pay/backend && npx jest src/__tests__/merchant-refresh-token.test.ts src/__tests__/routes-auth-mock.test.ts 2>&1 | grep -E "✕|✓|●" | head -40)`. Update tests for `{refreshToken, deviceId}`; add mismatch and NULL-device cases. Then the other two suites (`ws-server-full`, `coverage-gaps-routes`) — fix or quarantine with a `// Bug #15` comment. Target: `npm test` green.
- [ ] #37: `.gitattributes` with `* text=auto`, `*.sh text eol=lf`, `gradlew text eol=lf`, `*.bat text eol=crlf`. Commit alone.
- [ ] 32-B: delete `if (!payload.deviceId) return true` in `middleware/auth.ts`; run smoke (35) + `device-binding.test.ts`.
- [ ] #33: map `err.type === 'entity.parse.failed'` → 400 in the global error handler; smoke +1 (malformed body → 400).
- [ ] #35: server `merchant-hce-token` TTL 60 → 90 s (`transactions.ts` ~L546); matches phone and README.
- [ ] Roll `asyncHandler` to every route module (currently `consumers.ts` only) — an unhandled rejection exits the process.
- [ ] 32-C: migration `005_refresh_device.sql` (`ALTER TABLE merchant_refresh_tokens ADD COLUMN device_id TEXT`); login revokes all live tokens for that merchant and inserts with `device_id`; refresh checks the row's `device_id` too. Smoke +1 ("old device's refresh token after new login → 401").
- [ ] #36: after product ruling.

**Phase 4 — docs (§10)** — one commit per file, no status words in READMEs.

**Phase 5 — CI** — check `.github/workflows/ci.yml` runs on `fork` (Actions tab); once Phase 3 makes `npm test` green, CI is the regression gate for everything after.

**Phase 6 — hardware (§16 pre-flight first)** — two phones, both HCE directions, one real STK Push end to end.

**Phase 7 — staging** — VPS + domain + TLS (Let's Encrypt; pins already CA-level), `DARAJA_CALLBACK_BASE_URL` public, signed APKs, `NODE_ENV=production` (enables Safaricom IP allowlist + strict CORS), Sentry DSN. Gates: §7 full-system run green against staging, one real sandbox payment confirmed via callback → WS on both apps.

**Phase 8 — production** — Safaricom go-live, CBK PSP licence, KRA eTIMS credentials, Kenya DPA 2019 review, #26 alignment for Play, FCM re-enable (`google-services` plugin).

**Product-owner rulings outstanding:** `dashboard/` keep or delete · #34 merchant-side `MERCHANT_HCE` endpoint keep or delete · #36 Google merchant login supported? · primary HCE direction (merchant-presents vs consumer-presents) · Daraja credential owner (whose developer account) · `docker-compose.ha.yml` · SoftPOS scope · keypad shillings-vs-cents (`amountCents: 12300000` for an unknown input).

---

## 12. DECISION LOG

Session 8/9 entries stand. Added:

| Date | Decision | Incident |
|---|---|---|
| 2026-09-04 | A chat-reconstructed file is never committed; feature lines are spliced from the on-disk copy by line range | F-31 |
| 2026-09-04 | Partial commits: `git commit -m "…" -- paths`; pathspec after the message | F-36 |
| 2026-09-04 | Client and server halves of a contract change are separate commits; the client commit waits for a runtime observation | #32-A |
| 2026-09-04 | The §7 full-system run is the release gate; §1 holds the baseline; worse = regression | first full run |
| 2026-09-04 | `git status --short` is the last command of every session, pasted into §1 | Obs. 27 |
| 2026-09-04 | Onboarding brief stack claims are noise; repo files decide (third incident); Prisma/Zod/Next are not to be introduced | F-30 |
| 2026-09-04 | All documented commands run from repo root; one-off directory changes are wrapped in `( … )` | Session 10 `No such file` pastes |

---

## 13. SESSION 6–10 COMMIT LOG

| Hash | Change | Message accurate? |
|---|---|---|
| `08eb61d` … `a13551e` | as Session 9 §13 | as recorded |
| `b1dd352` | docs(handover): Session 9 close-out | Yes — but tree was already dirty with the #32 draft when the session ended (Obs. 27) |
| `0ed02d6` | fix(backend): #32 device-bound merchant refresh; smoke +4, 35/35 | Yes — 2 files, +40/−5; smoke checks 14–18 |
| (next) | docs(handover): Session 10 close-out | — |
| (next) | fix(android): #32 client (32-A) after Phase 1 observation | — |

---

## 14. FUNCTIONAL SMOKE TABLE

### 14a. API smoke — 35 checks, all PASS, 4 Sep ~18:50

| # | Check | Status |
|---|---|---|
| 1–2 | `health`, `readiness` | 200 |
| 3–6 | consumer register (201), login, refresh (fields `token,refreshToken,role,consumerId,phone,displayName,expiresAt`), reused old refresh → 401 | ✓ |
| 7–12 | `consumers/me`, `/me/transactions`, `/me/loyalty`, health after loyalty, `qr-token`, `/me` without token → 401 | ✓ |
| 13 | merchant login (`smoke-01`) | 200 |
| 14 | **merchant refresh WITHOUT deviceId → 400** | ✓ |
| 15 | **merchant refresh (correct device) → 200**, fields `token,refreshToken,role,merchantId,expiresAt` | ✓ |
| 16 | **merchant refresh from OTHER device (`evil-99`) → 401, token revoked** | ✓ |
| 17 | **same refresh token after mismatch → 401** | ✓ |
| 18 | **access token from correct-device refresh → `/merchants/me` 200** | ✓ |
| 19–22 | `merchants/me`, transactions list, `analytics/weekly`, `loyalty/programme` | 200 |
| 23 | `POST /transactions` CONSUMER_QR | **502** (Daraja placeholder — accepted) |
| 24–29 | `merchant-hce-token` 200 · wrong amount → 400 (token kept) · consumer pays HCE session → **502** · replay → 401 · bogus → 401 · ledger `source=MERCHANT_HCE status=FAILED` | ✓ |
| 30–32 | `POST /consumers/pay/:merchantId` → **502** · same idempotencyKey → 200 same result · health after payments | ✓ |
| 33–35 | `admin/stats`, `admin/pending`, wrong secret → 403 | ✓ |

Every 502 is the same root cause: `DARAJA_CONSUMER_KEY/SECRET` are placeholders. With real sandbox keys these three become 201 `STK_SENT`; the smoke already accepts `201|502`.

### 14b. Device / UI table

| ID | App | Screen / action | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| M1–M4a | Merchant | login → dashboard → amount → scan/QR | as Session 8 | **works** (inherited; APK re-installed this session, not re-walked) | Session 8 |
| M4b | Merchant | Amount → Present NFC | HCE token issued, "hold phones together" | API works (smoke 24); screen not observed since #28 | — |
| M5 | Merchant | superseded device → any API call | refresh refused, app returns to login (after 17b) | **not yet observed** — Phase 1 | — |
| W1–W4 | Wallet | login → home → WS connect → history | works / relayed | inherited | Session 8 |
| W5–W8, W10–W12 | Wallet | QR pay, P2P send/receive, loyalty redeem, tag write, profile | | unobserved | — |
| W9 | Wallet | `MerchantHcePayActivity` → `POST /consumers/pay/:merchantId` with token | bound, `MERCHANT_HCE` in ledger, STK | works to 502 via API in the wallet's body shape; activity not tapped (no radio) | smoke 26–29 |
| WEB1–3 | Web | merchant / consumer / admin login + dashboards | render | build green, 785 unit tests green; **live login not re-walked this session** | `npm run build` |

---

## 15. CONTRACT TABLE

| Endpoint | Client | Backend | Mismatch |
|---|---|---|---|
| `POST /auth/refresh` (merchant) | Android (uncommitted 32-A) `{refreshToken, deviceId}` → `{token, refreshToken, role, merchantId, expiresAt}` · web: never calls it | same; 400 without `deviceId`; 401 + revoke on mismatch/NULL | **none once 32-A is committed**; until then the installed HEAD APK (if anyone rebuilds from HEAD) sends no `deviceId` and gets 400 on every refresh |
| `POST /auth/consumer/refresh` | `{refreshToken}` | same (F-3) | none |
| `POST /auth/login` (merchant) | Android + web `{email, password, deviceId}` | same | none |
| `POST /auth/google` (merchant role) | web | mints `deviceId='google-oauth'`, no binding write | **#36** |
| `POST /transactions` | merchant `TransactionRequest` | `transactionSchema` superset | none for merchant paths; `merchantHceToken` branch dead (#34) |
| `POST /transactions/merchant-hce-token` | `{amountCents}` | `{amountCents, consumerId?}` | none |
| `POST /consumers/pay/:merchantId` | wallet `{amountCents, idempotencyKey, timestamp, merchantHceToken, source}` | accepts, `source` ignored/derived | none |
| `POST /consumers/qr-token`, `/p2p-token`, `/p2p-pay` | wallet | as Session 8 | unread client-side (Phase 2.5 audit) |

---

## 16. NFC / PAYMENT TEST DAY — PRE-FLIGHT (complete before the second phone arrives)

Everything here can be done with zero NFC hardware. When both phones are on the desk, the only remaining work should be the taps themselves. Tick each with pasted output.

**A. Credentials and environment (product owner)**
- [ ] **Daraja sandbox app** at developer.safaricom.co.ke → `DARAJA_CONSUMER_KEY`, `DARAJA_CONSUMER_SECRET` into `Tap2Pay/backend/.env`. Shortcode `174379`, passkey already in the README. Restart backend. Re-run smoke: checks 23, 26, 30 must flip **502 → 201**. Paste it. *This single item unblocks every payment test on every layer.*
- [ ] **Public callback URL**: Safaricom must reach `POST /api/v1/mpesa-callback`. `ngrok http 3000` → set `DARAJA_CALLBACK_BASE_URL=https://xxxx.ngrok-free.app` → restart. Without this an STK Push fires but the transaction stays `STK_SENT` until the 5-min reconciliation job queries Daraja. (Reconciliation is the fallback, not the test.)
- [ ] `NFC_SIGNING_SECRET` set in `.env` → merchant login returns a non-null `nfcSigningKey` (smoke check 13 prints it). Required for the NFC-tag flow; HCE flows do not need it.
- [ ] Sandbox test MSISDN `254708374149` / PIN `1234` is what the STK Push targets in sandbox regardless of the consumer's real number — confirm the test consumer's phone is set to it, or expect the push to land nowhere visible.

**B. Code prerequisites (dev, ~2 h, all in Phase 3)**
- [ ] 32-A committed after Phase 1; 17b wired so a refused refresh visibly returns to login.
- [ ] #35: server HCE TTL 90 s = phone TTL. Otherwise the wallet can present a token the server dropped.
- [ ] #20 APDU three-way read (no radio needed): `grep -n "0x80\|0x81\|0xC0\|0xC1\|INS" Tap2Pay/android/app/src/main/java/com/orchestratepay/nfc/NfcReaderManager.kt Tap2Pay/android/consumer-wallet/src/main/java/com/orchestratepay/consumer/hce/*.kt` — reader INS bytes must equal what the wallet's `processCommandApdu` switches on, for both GET DATA and CONFIRM. Fix comments while there.
- [ ] #34 ruling applied (delete the dead branch or make it a real endpoint) so the merchant-presents flow has exactly one server path.
- [ ] Decide and record the **primary direction** for the first tap: recommended **merchant-presents (reverse HCE)** — it is already proven server-side to the Daraja boundary (smoke 24–29) and the wallet's `MerchantHcePayActivity` has the exact body shape. Consumer-presents is second.

**C. Devices (the day before)**
- [ ] Both phones: Developer options → USB debugging on; NFC on; screen-lock off for the session (HCE needs the screen on and, on many OEMs, unlocked).
- [ ] Both on USB (a hub is fine). `adb devices` shows `RF8R42CY49R` and the new phone, both `device` (not `unauthorized`).
- [ ] Per phone: `adb -s SERIAL reverse tcp:3000 tcp:3000`, then `adb -s SERIAL reverse --list`. Debug builds talk to `http://localhost:3000` through this tunnel. Redo after any adb restart. If a phone must be on Wi-Fi only, that needs a build pointing at the LAN IP plus an entry in both `network_security_config.xml` — decide now, not on the day.
- [ ] Install: merchant APK on phone A (the terminal), wallet APK on phone B. Do **not** put the wallet on the same phone as the merchant app for the HCE test — reader mode and HCE cannot run in one process, and same-device tests prove nothing.
- [ ] Uninstall any other HCE payment app on phone B or expect AID routing conflicts (`adb shell dumpsys nfc | grep -i aid`).
- [ ] Log in: merchant `merchant@test.com` on A (device id of your choosing, e.g. `phoneA`); consumer `consumer2@test.com` on B. **Do not run the smoke again after this point** — it will unbind phone A.

**D. Test sequence (from `docs/ANDROID_NFC_TESTING_PROTOCOL.md`, ordered by what is already proven)**
1. **Test 0b (no radio):** smoke 24–29 green with real Daraja keys → 201. Baseline.
2. **Reverse HCE, merchant presents:** A: amount → Present NFC → "waiting". B: open wallet → `MerchantHcePayActivity` (or whatever the home entry is — map it first, W9). Tap. Expect: B posts `/consumers/pay/{merchantId}` with the token → 201 → STK on the sandbox MSISDN → callback → WS `PAYMENT_CONFIRMED` on A. Evidence: backend log lines for `merchant-hce-token`, `consumers/pay`, `mpesa-callback`; `GET /consumers/me/transactions` row `source=MERCHANT_HCE status=CONFIRMED`; `logcat -b crash -d` empty on both.
3. **Consumer presents (HCE_PHONE):** B: wallet shows HCE ready. A: amount → tap consumer. Expect APDU SELECT → GET DATA → CONFIRM (#20), `POST /transactions source=HCE_PHONE` → 201 → same callback path.
4. **NFC tag:** needs a written NTAG215 (`ConsumerTagWriterActivity` / `DisplayTagWriterActivity`) and `NFC_SIGNING_SECRET`. Third priority.
5. **Refresh under load:** leave A logged in > 8 h once (or set `MERCHANT_ACCESS_TTL_S` to 300 locally) and tap after expiry — #17 for real.

**E. Failure triage on the day**
- Tap does nothing: `adb -s B shell dumpsys nfc | grep -iA3 "F04F5243"` — is the AID registered and is our service the default? Screen on? Other wallet app?
- Tap reads but 401/400: backend log tells you which check refused (token expired → #35; amount mismatch → keypad question; wrong merchant → token from a stale session).
- 201 but no confirmation: ngrok URL wrong or expired → check `daraja_callback_log` is empty; wait 5 min for reconciliation.
- Merchant app suddenly 401 on everything: something logged in as `merchant@test.com` elsewhere (smoke, web). Log in again on A.

**F. What "done" looks like:** one pasted sequence showing token mint → tap → 201 → callback row in `daraja_callback_log` → `transactions.status=CONFIRMED` → WS message received on A. That paste closes the product thesis row in §2 and opens Phase 7.

---

END OF SESSION_HANDOVER.md