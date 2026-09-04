# SESSION_HANDOVER.md

**Last Updated:** 4 September 2026, 14:30 — end of Session 9
**Project:** OrchestratePay Platform
**Prepared by:** Lead Dev, Session 9 (handover from Session 8 lead)
**Recipient:** Any developer or AI session touching this repository

**This is the only document in the repository that carries project STATUS.**
READMEs describe design and operation. This file describes what is proven, what is
broken, what is unknown, and what to do next — with the command output that backs
each claim.

**One-paragraph status:** Backend, web, consumer wallet, and merchant terminal all run
against one live local backend and are login-verified on emulator-5554. Session 9
closed **#30** (`a13551e`): the consumer-reads-merchant HCE flow is now bound
server-side — token looked up, merchantId/consumerId/amount enforced, single-use,
and the ledger records `source=MERCHANT_HCE`. The smoke script proves it end to end
with no radio: mint → pay → replay-rejected → ledger row. **Smoke is 31/31.** #31
(unexpected 401 on the emulator) closed as "the smoke's merchant login rewrote the
device binding." Investigating #17c exposed **#32 (High, security)**: merchant refresh
rebinds the caller to whichever device logged in last, and can mint a token with an
empty `deviceId` that bypasses binding entirely — single-device enforcement lasts one
request. Commit `0f5b311` was found to claim work it did not contain (#25, fourth
entry) and was fixed forward. NFC/HCE have still never run on two physical phones;
Daraja keys are still placeholders; nothing is deployed.

---

## 0. ONBOARDING — mandatory path, in this order

Six previous handovers, commit messages, or advisors were wrong about repository or
device state because the writer trusted a document, a chat message, or their own
intent instead of running a command. Budget ~90 minutes. Paste every command's output
into your session log.

**Step 1 — Read this document, top to bottom.** ~25 min. Do not skip §3, §7, §9.
Done when you can name the open High bugs (#17, #32), say why `0f5b311`'s message is
false (F-23), and say why the emulator 401'd after an 81-minute session (#31/#32).

**Step 2 — Confirm the repository matches §1.** `git log --oneline -5`,
`git status --short`, `git remote -v`. HEAD at or after `a13551e`; tree clean;
`fork` → MARKDISPLAYNONE, `origin` → gabrielngige. Anything else: stop, reconcile,
record.

**Step 3 — Read the history with §9.** `git log --oneline --reverse`. Done when you
can point at the four commits whose messages describe content they lack (#25) and know
to read `git show --stat` before believing any message.

**Step 4 — Regenerate the tree and compare to §8.**
`git ls-files | awk -F/ 'NF>2{print $1"/"$2"/"$3}NF<=2{print $0}' | sort -u`.

**Step 5 — Read the other documents per §10.** Not `Tap2Pay/README.md` first.

**Step 6 — Bring the environment up per §7.** Run the smoke; expect `PASS=31 FAIL=0`.

**Step 7 — Pick the top unchecked item in §11.** Work it, paste the evidence, update
§2/§12/§14, commit, `git show --stat HEAD`, push to `fork`.

**Standing rules — each exists because it was violated and something broke (§12):**

- No status claim without pasted command output. Not in chat, not in docs, not in
  commit messages.
- "Committed", "applied", and "verified" are three different states. §2 tracks all three.
- `git status --short` before every commit. `git show --stat HEAD` after. **Never in the
  same `&&` chain as the commit** — the chain commits regardless of what the check
  printed (`0f5b311`).
- `git diff --stat && git diff -w --stat` before every commit. If they disagree, the
  diff carries whitespace noise; clean it before committing.
- Push to `fork`, never `origin`.
- One command per paste, and keep commands short.
- XML / generics-heavy Kotlin through `sed 's/</[/g; s/>/]/g' FILE` before pasting
  into chat. Chat-side stripping also eats spaces at random (F-2/F-23 pastes showed
  `presentwhen`, `backedtoken`) — never re-type code from a chat paste.
- Never pipe a Gradle build to `tail -3`. Use `2>&1 | grep -E "^e: |error:|FAILED|BUILD" | head -30`.
- Build → install is one `&&` chain; check the APK mtime against your last edit.
- Activity-state proof is `dumpsys activity activities | grep topResumedActivity`,
  plus `logcat -b crash -d`. Main logcat buffer is unusable on this emulator.
- A diagnosed corruption is reverted before the next command.
- Advice from any source is checked against output already on screen before it
  changes a command (F-15).
- **The onboarding brief's stack claim is checked against `package.json` /
  `build.gradle`.** Session 9's brief said Next.js 16 / Prisma 7 / Zod 4. The repo is
  Express + TS + `pg` + Joi / Vite 6 + React 19 / Kotlin. The repo wins.
- **Do not run the smoke while the merchant app is signed in on a device.** It logs
  in as `merchant@test.com` / `smoke-01` and rewrites the device binding (#31, #32).
- Backend readiness is the literal log line `OrchestratePay backend running on port 3000`.
- READMEs never carry status words. Status lives here.

---

## 1. GROUND TRUTH — verified by pasted output, 4 September 2026

| Item | State | Evidence |
|---|---|---|
| Machine clock | 4 Sep 2026 ~14:30 | commit `a13551e` `Fri Sep 4 14:12:41 2026 +0300` |
| HEAD | `a13551e` on `main` | `git show --stat HEAD` (3 files, +65/−11) |
| `fork/main` | `a13551e` | `git push fork main` → `0f5b311..a13551e` |
| Ahead of `origin/main` | 53 | derived: 51 at `f51bca0` + `0f5b311` + `a13551e` |
| Working tree | clean after `a13551e` (this file uncommitted at time of writing) | `git status --short` |
| Smoke | **`PASS=31 FAIL=0`** | run output 4 Sep ~14:05 |
| Bug #30 | Closed — committed `a13551e`, applied (ts-node-dev reload), verified | smoke: mismatch `400`, pay `502`, replay `401`, bogus `401`, `GET /me/transactions` → `source=MERCHANT_HCE status=FAILED` |
| `0f5b311` content | schema key + destructure **only** (2 feature lines in +28/−13) | `git show 0f5b311 \| grep …` → 2 hits, neither touches `'QR_CODE'` |
| `validate()` | `stripUnknown: true` — unknown body keys are silently deleted, never 400 | `validate.ts` L22 |
| Wallet HCE-pay contract | `POST api/v1/consumers/pay/{merchantId}` body `{amountCents, idempotencyKey, timestamp, merchantHceToken, source:"MERCHANT_HCE"}` | `ConsumerApiClient.kt` L115–116, L201, L399–401 |
| `merchant-hce-token` mint | key `merchant:hce:{uuid}`, **TTL 60 s**, JSON `{merchantId, merchantName, consumerId?, amountCents, exp}`; `consumerId` absent from JSON when not supplied | `transactions.ts` L534–555 |
| `transactions.source` enum | includes `CONSUMER_QR`, `MERCHANT_HCE` (DB + Joi) | `001_initial.sql` L98–99; `validate.ts` L62–63 |
| Device binding | JWT `deviceId` must equal Redis `merchant:device:{id}` (DB `merchants.device_id` on miss); **`if (!payload.deviceId) return true`** legacy bypass; fails open on infra error | `middleware/auth.ts` L150–182 |
| `merchant:device` writes | login only (L126 DB, L133 Redis); deleted at logout L328; **refresh never touches it** | `auth.ts` grep, 9 lines |
| Merchant refresh | mints with `device_id ?? ''` read from `merchants.device_id`; revokes the used refresh token only | `auth.ts` L162–214 |
| Refresh-token revocation sites | L192 (on refresh), L322 (logout, by client-supplied hash). **Login does not revoke prior tokens** | grep |
| Merchant TTLs | access 8 h, consumer 24 h | `auth.ts` L799–800 |
| Merchant Android refresh | `RefreshRequest{refreshToken}` — no `deviceId`; `SessionManager.getDeviceId()` exists | `OrchestaApiClient.kt`, `SessionManager.kt` |
| `RefreshResponse` (#17f) | `token, refreshToken, role, merchantId, expiresAt` — matches backend | `OrchestaApiClient.kt` vs `auth.ts` L205–211 |
| Smoke merchant login | `deviceId: "smoke-01"` | `e2e-smoke.sh` L59 |
| Reader APDU bytes | GET DATA `80 80`, CONFIRM `80 81` (code); header comment still says `C0`/`C1` | `NfcReaderManager.kt` |
| Git Bash `node` | interactive profile aliased `node` → `winpty node.exe`; empty output inside `$(…)` | `type node`; fixed in `~/.bashrc` on this machine |

**Inherited (Sessions 4–8, not re-verified this session):** everything in the Session 8
§1 table — emulator packages, backend cron jobs, #24/#16/#11 closures, merchant terminal
screen description, wallet log lines, Redis/PG/web/wallet-on-device facts, test counts
(93/1959/108), Android SDK 35/26/35, `adb reverse` setup.

**Test accounts:** `consumer2@test.com` / `TestPass123` (ID `a09df433-…`, phone
254700000002). `merchant@test.com` / `TestPass123` / device `emu-01` on the emulator,
`smoke-01` in the smoke (ID `6fce73f3-8482-43ff-ad67-7dce1db4074a`, APPROVED;
`nfcSigningKey` null).

---

## 2. OPEN BUGS — three-state status

| # | Bug | Severity | Committed | Applied | Verified | Blocks |
|---|---|---|---|---|---|---|
| 32 | **NEW.** Merchant `/auth/refresh` mints the new JWT with `deviceId = merchants.device_id` — i.e. **whichever device logged in last** — so a stale refresh token from device A comes back wearing device B's binding and passes `checkDeviceBinding`. Single-device enforcement lasts until A's Authenticator fires (automatic, `176101f`). **32b:** login on A, login on B, logout on B → DB `device_id NULL` → A refreshes → `device_id ?? ''` → JWT with empty `deviceId` → middleware L150 bypass, permanently. Root cause: refresh body carries no `deviceId` and `merchant_refresh_tokens` isn't device-bound; login never revokes prior refresh tokens. Fix shape in §11 Phase 2.6 | 🔴 High — security | — | — | — | single-device login guarantee; CBK story |
| 17 | Token expiry / refresh handling on device | 🔴 High | `176101f` | yes | **partial** — merchant runtime refresh observed 02:10 (401→refresh 200→retry 200) but the 200 was #32, not a re-arm; consumer runtime not observed | sessions > 8 h / 24 h |
| 26 | 16 KB page-size: `libbarhopper_v3.so`, `libimage_processing_util_jni.so` not aligned; Play gate | 🟡 Medium — deployment gate | — | — | — | Phase H; scripted UI |
| 25 | Commit messages describing content they lack: `52197d6`, `3e618c7`, `2368fec`, **`0f5b311`** | 🟡 Corrosive | rule in §0 | — | — | trust in `git log` |
| 33 | **NEW.** Backend answers malformed JSON with **500**, not 400 (`entity.parse.failed` unmapped in the global error handler) | 🟢 Low | — | — | — | alert hygiene once deployed |
| 34 | **NEW (F-24).** `transactions.ts` L211–235 `MERCHANT_HCE` branch: merchant-auth route the wallet never calls; reads `hceSession.consumerId` which `f51bca0` made optional; comment L215 and cast L223 disagree. Dead and wrong. Remove or make it a merchant-side "confirm HCE session" endpoint — product ruling | 🟡 Medium — dead code with a wrong contract | comment flag only (`a13551e`) | — | — | reader confusion; #20 |
| 35 | **NEW (F-25).** HCE token TTL: backend mints 60 s (`transactions.ts` L546); Android HCE `TOKEN_TTL_MS` was set to 90 s in `1e3c431`. Phone may emit a token the server dropped 30 s ago → wallet sees 401 "expired" on a still-live screen | 🟡 Medium | — | — | — | Phase 6 tap UX |
| 17b | Force-logout signal unwired (`AuthEventBus.onForceLogout` never registered) | 🟢 Low | — | — | — | when refresh fails |
| 17d | WS after refresh unknown | 🟡 Hypothesis | — | — | — | `PAYMENT_CONFIRMED` after hour 8 |
| 20 | APDU INS bytes three-way check, both HCE directions. Reader side now read: `80 80`/`80 81` in code, stale `C0/C1` comment | 🟡 Medium | — | — | — | Phase 6 |
| 15 | 108 backend test failures / 7 suites; CI on fork unknown | 🟡 Medium | — | — | — | deployment |
| 19 | Doc drift (§10) — grows: NfcReaderManager APDU/TTL comments, Session 8 handover missing four commits | 🟡 Corrosive | partial | — | — | onboarding |
| — | NFC/HCE never run on two physical phones | 🔴 Product thesis | — | — | — | everything |

**Closed this session:** #30, #31, #17c (as #32), #17f, #23 (was `0a9ab03`, Session 8
close), #28 (was `f51bca0`, Session 8 close). See §5.
**Closed earlier:** #1–#14, #16, #17e, #18, #21, #22, #24.

---

## 3. FINDINGS — Session 9 (F-1 – F-20 in the Session 8 text, unchanged)

**F-21 — Git Bash `node` alias.** Interactive profile aliases `node` → `winpty node.exe`.
Inside `$(…)` or a pipe winpty prints `stdin is not a tty` and outputs nothing; a
curl body built from it became `"timestamp":,` and the backend returned 500 (which
surfaced #33). Non-interactive `bash scripts/…` never loads the alias, so the smoke was
unaffected. Fix: `unalias node 2>/dev/null; alias node='node.exe'` in `~/.bashrc`.

**F-22 — Malformed JSON → 500.** See #33.

**F-23 — `0f5b311` claims (d), contains (a)+(b).** Message: "parse merchantHceToken …
**and record source as MERCHANT_HCE**". Diff: schema line + destructure, nothing else;
`'QR_CODE'` untouched. A direct curl with a fabricated token returned **502** — the token
was parsed and ignored. Also +26/−13 of whitespace noise from a full-file reconstruction
in chat. Cause: `git add && git commit && git show --stat && git push` in one chain, with
a message written before the verifying paste happened. Fixed forward in `a13551e`.
Fourth #25 entry.

**F-24 — Two MERCHANT_HCE implementations, one unreachable.** See #34. The wallet posts
to `/consumers/pay/:merchantId` (`ConsumerApiClient.kt` L201) — the branch in
`transactions.ts` requires a merchant JWT and a `consumerId` the token no longer carries.

**F-25 — HCE TTL 60 s server / 90 s phone.** See #35.

**F-26 — #31 root cause.** Smoke logs in as merchant with `smoke-01` (L59) →
`auth.ts` L126/L133 write `smoke-01` → emulator's `emu-01` JWT → middleware L175 →
401 "Session invalidated — another device has logged in". 8 h TTL; 81 min was not
expiry. By design. Runbook rule added to §0.

**F-27 — The 02:10 retry passed because of #32, not a re-arm.** Refresh minted a JWT
with `deviceId = smoke-01` from `merchants.device_id`; that matched Redis; 200. The
emulator was silently rebound to the smoke's device identity. #17c "does refresh
re-arm?" → no; it captures.

**F-28 — Consumed-on-502 is deliberate.** `/consumers/pay/:merchantId` DELs the HCE
token after all checks and *before* STK Push. A Daraja 502 therefore burns the
merchant's session; the wallet's 502 message should say "ask the merchant to tap again".
Deleting after STK would open a replay window between checks and push. Observation
(§6), not a bug.

**F-29 — The Session 9 onboarding brief misdescribed the stack** (Next.js 16 / Prisma 7 /
Zod 4). Caught by the existing 2026-09-03 rule; no command was changed by it. Recorded
because it happened again.

---

## 4. BUG #17 — exact state

Merchant client (`176101f`): Authenticator read in full this session — single-flight,
retries once, separate refresh client, force-logout event published but unwired (17b).
`RefreshResponse` matches backend (#17f closed). Runtime refresh observed once (02:10)
but the successful retry is explained by #32, so **a genuine re-arm has never been
observed** and cannot be until #32 is fixed. Consumer side: `176101f` approved by read
(F-3), never fired at runtime. Remaining: #32 fix → forced-expiry runtime proof on
both apps → concurrency → #17d → wire #17b.

---

## 5. CLOSED BUGS — one line each

| # | What | Commit / evidence |
|---|---|---|
| (Sessions 1–8) | as listed in Session 8 §5 | unchanged |
| 23 | Smoke merchant-QR case sent `QR_CODE` with no identity | `0a9ab03`; smoke 25/25 |
| 28 | `merchant-hce-token` required `consumerId` before any consumer exists | `f51bca0`; smoke 26/26 |
| 30 | `merchantHceToken` parsed but ignored; HCE payments recorded as `QR_CODE`; merchant amount never enforced | `a13551e`; smoke 31/31; ledger `source=MERCHANT_HCE` |
| 31 | Emulator 401 at 02:10 after 81 min | smoke `smoke-01` login rewrote `merchant:device` (F-26) |
| 17c | "Does refresh re-arm device binding?" | No — it rebinds to the last login (F-27) → reopened as #32 |
| 17f | Merchant refresh response fields | `OrchestaApiClient.kt` `RefreshResponse` = `auth.ts` L205–211 |

---

## 6. OBSERVATIONS — not bugs

1–21 as in Session 8. Added:

22. **`stripUnknown: true`** on every Joi-validated route: a client sending an extra
    key gets it silently deleted, not a 400. Contract mismatches of the "client sends a
    field the server doesn't list" kind are therefore invisible in status codes — they
    show up only as missing behaviour (#30 was exactly this).
23. HCE token is consumed before STK Push (F-28). A 502 burns the merchant session.
24. `/consumers/pay/:merchantId` now tolerates `source` in the body and ignores it;
    source is derived from the token. Wallet may keep sending it.
25. Merchant login inserts a new refresh token each time and revokes none — one
    merchant can hold N live refresh tokens across devices (#32 surface).
26. The merchant refresh grep returned 9 lines under `head -12` — complete, not
    truncated. Check `head` counts before treating a grep as exhaustive; the F-24 mint
    handler was missed the first time because a grep was cut at 25 lines.

---

## 7. ENVIRONMENT — Windows / Git Bash (MINGW64)

All Session 8 §7 content stands (Redis, PostgreSQL, backend, web, Android build/install,
packages, scripted-UI traps, evidence commands, pasting, git). Changes:

**Smoke:** `bash scripts/e2e-smoke.sh 2>&1 | grep -E "FAIL|PASS="` from root. Expect
**`PASS=31 FAIL=0`**. It logs the merchant in as `smoke-01` — do not run it while the
merchant app is signed in on a device; if you do, expect one 401 → silent refresh there,
and (until #32 is fixed) the device is then bound as `smoke-01`.

**`node` in command substitution:** `type node` on a new terminal. If it says
`aliased to 'winpty node.exe'`, `$(node -e …)` returns empty. `~/.bashrc` on this
machine already carries `unalias node 2>/dev/null; alias node='node.exe'`; any other
Windows machine needs the same line.

**Direct API check without the smoke:** login → capture with `node -e` → curl. Confirm
`echo "CT len=${#CT} MID=$MID"` shows a non-empty token and a UUID before reading a
status code; an empty var produces malformed JSON and a 500 (#33), not an auth error.

**Git, commits:** four pastes — `git diff --stat && git diff -w --stat` (must agree) ·
`git status --short` · `git commit -am "…"` · `git show --stat HEAD`. Then
`git push fork main`. Never chain them.

**Editing:** targeted find→replace in VS Code, or a full-file replacement generated
from the file *as it currently sits on disk* — never from an earlier chat paste. Verify
with `grep -n` on the changed identifiers before building or running.

---

## 8. REPOSITORY STRUCTURE

Unchanged from Session 8 §8 (`git ls-files` regenerated 4 Sep, identical top-3 tree).

---

## 9. ANNOTATED GIT HISTORY

Eras 1–9 unchanged (Session 8 text).

**Era 10 — Session 8 close / Session 9 (4 Sep, `a9bdb21` → `a13551e`).**
`a9bdb21` Session 8 handover. `0a9ab03` #23: smoke sends `CONSUMER_QR` + real token
(25/25). `f51bca0` #28: `consumerId` optional on `merchant-hce-token` (26/26).
`0f5b311` **misdescribed** — schema key + destructure only, +26/−13 whitespace; message
claims `MERCHANT_HCE` source (#25). `a13551e` #30 actually enforced; ledger proof;
smoke 31/31; message references `0f5b311`'s overstatement.

**Pattern update:** four misdescribing commits (`52197d6`, `3e618c7`, `2368fec`,
`0f5b311`) and six retractions/corrections. Every one of them: status written before
the verifying output existed, or a checkpoint collapsed into an `&&` chain.

---

## 10. DOCUMENTATION MAP

Session 8 table stands. Additions:

| Document | Action |
|---|---|
| `Tap2Pay/backend/README.md` | Document: the two HCE directions and which route each uses; `stripUnknown`; smoke 31 checks; #32 once fixed |
| `Tap2Pay/android/README.md` | Add `NfcReaderManager` APDU bytes (`80 80` / `80 81`) and fix the in-code header comment; HCE TTL (#35) |
| `CLAUDE.md` | Add: no `&&`-chained commits; `diff -w` gate; smoke-vs-device rule; winpty alias; brief-vs-repo stack rule (second incident) |
| `docs/ANDROID_NFC_TESTING_PROTOCOL.md` | Reverse-HCE (merchant presents) is now provable to 502 without radio — add as Test 0b; Phase 6 adds the tap |

---

## 11. PLAN

**Phase 0 — close Session 9 (now)**
- [ ] Commit this file; `git show --stat HEAD` → 1 file; `git push fork main` → `a13551e..`.

**Phase 2.6 — #32 (backend + merchant app + smoke, ~1 h, no hardware)**
- [ ] Read: `grep -n "saveDeviceId" -r Tap2Pay/android/app/src/main/java` (does the
      merchant app store its deviceId at login?); `grep -rn "merchant_refresh_tokens" Tap2Pay/backend/src/db/migrations`
      (table columns).
- [ ] Backend `auth.ts` `/refresh`: accept `deviceId` in body; if `merchants.device_id`
      is NULL **or** `!== deviceId` → revoke this refresh token, 401; else mint with
      `deviceId` and `redis.setex(merchant:device:{id}, DEVICE_CACHE_TTL_S, deviceId)`.
      Remove `?? ''`. Optional v2: add `device_id` to `merchant_refresh_tokens`, revoke
      prior tokens for the same merchant at login.
- [ ] Android `RefreshRequest(refreshToken, deviceId = SessionManager.getDeviceId())`.
      Both apps if the wallet has an analogous path (consumer has no device binding —
      check before touching).
- [ ] Smoke §6: send `smoke-01`; add "refresh with wrong deviceId → 401" and "refresh
      after logout → 401". Target 33/33.
- [ ] Emulator: log in `emu-01`, run smoke, watch merchant app → should force-logout,
      not silently rebind. That is the first genuine #17 runtime proof.

**Phase 2.2 — finish §14 (emulator, ~30 min)** — W5–W11 by hand with backend `http:`
lines; map which wallet element calls `qr-token`; merchant Present NFC now reaches
"waiting for tap" (stop there — no radio).

**Phase 2.7 — small backend tickets** — #33 (map `entity.parse.failed` → 400); #34
ruling then delete or repurpose; #35 pick one TTL (recommend 90 s server-side to match
the phone and the README).

**Phase 2.5 — contract audit (§15)**, **Phase 3 — #17 runtime + androidTest compile**,
**Phase 4 — docs (§10)**, **Phase 5 — #15/CI**, **Phase 6 prerequisites** (F-8
networking; `NFC_SIGNING_SECRET`; Daraja sandbox keys; merchant on `RF8R42CY49R`;
#26 alignment), **Phase 6 — two phones, both HCE directions, one STK Push end to end** —
unchanged.

**Product-owner rulings outstanding:** `dashboard/` · #43 design language · SoftPOS
scope · Daraja credential owner · `docker-compose.ha.yml` · primary HCE direction ·
**#34: keep a merchant-side MERCHANT_HCE endpoint or delete the branch?**

**Open question (no evidence yet):** merchant keypad produced `amountCents: 12300000`
(KSh 123,000) for whatever was typed. What was typed? If "123000" expecting KSh 1,230,
the keypad treats input as shillings — product decision, not yet a bug.

---

## 12. DECISION LOG

Session 8 entries stand. Added:

| Date | Decision | Incident |
|---|---|---|
| 2026-09-04 | `git diff --stat` and `git diff -w --stat` must agree before commit | `0f5b311` +26/−13 whitespace |
| 2026-09-04 | Never chain `status`/`commit`/`show --stat`/`push` with `&&` | `0f5b311` message written before verification |
| 2026-09-04 | Full-file replacements only from the file as it currently sits on disk; verify with `grep -n` before running | F-23 |
| 2026-09-04 | Do not run the smoke while the merchant app is signed in on a device | #31, #32 |
| 2026-09-04 | Onboarding brief stack claims are noise; repo files decide (second incident) | F-29 |
| 2026-09-04 | Server derives `source` from credentials/tokens; never from the body | #30 |
| 2026-09-04 | Negative checks (replay, bogus, mismatch) ship with every token-consuming route | #30 — a bogus token passed for a full session before anyone noticed |

---

## 13. SESSION 6–9 COMMIT LOG

| Hash | Change | Message accurate? |
|---|---|---|
| `08eb61d` … `e34b116` | as Session 8 §13 | as recorded |
| `a9bdb21` | docs(handover): Session 8 close-out | Yes |
| `0a9ab03` | test(smoke): #23 CONSUMER_QR + token, 25/25 | Yes |
| `f51bca0` | fix(backend): #28 consumerId optional, 26/26 | Yes |
| `0f5b311` | "fix #30 — parse merchantHceToken **and record source as MERCHANT_HCE**" | **No** — schema key + destructure only; `'QR_CODE'` untouched; +26/−13 whitespace (F-23) |
| `a13551e` | fix(backend): #30 enforced — Redis lookup, bindings, single-use, `source=MERCHANT_HCE`; F-24 flag; smoke +5, 31/31 | Yes — 3 files; each claim has a smoke line |
| (next) | docs(handover): Session 9 close-out | — |

---

## 14. FUNCTIONAL SMOKE TABLE

| ID | App | Screen / action | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| M1–M4a | Merchant | as Session 8 | | **works** | unchanged |
| M4b | Merchant | Amount → Present NFC | HCE token issued, "hold phones together" | **API works** (`merchant-hce-token 200`); screen after #28 fix not yet observed on emulator | smoke check 26 |
| W1–W4 | Wallet | as Session 8 | | works / relayed | unchanged |
| W5–W8, W10–W12 | Wallet | as Session 8 | | unobserved | — |
| W9 | Wallet | `MerchantHcePayActivity` → `POST /consumers/pay/:merchantId` with token | bound to merchant session, `MERCHANT_HCE` in ledger, STK | **works to 502** (Daraja placeholder) via API in the wallet's exact body shape; activity itself not tapped (no radio) | smoke checks 27–31; ledger `source=MERCHANT_HCE` |

---

## 15. CONTRACT TABLE

| Endpoint | Client | Backend | Mismatch |
|---|---|---|---|
| `POST /transactions` | merchant `TransactionRequest` (`merchantId, amountCents, source, tagId, nfcUid, idempotencyKey, timestamp, consumerPhone?, hceToken?, hceExp?, consumerTagId?, consumerQrToken?`) | `transactionSchema` — superset incl. `merchantHceToken, deviceType, integrityToken, currency` | none for merchant paths; `merchantHceToken` branch dead (#34) |
| `POST /transactions/merchant-hce-token` | `{amountCents}` | `{amountCents, consumerId?}` → `{token, expiresAt, amountCents, merchantName}` | none (post-#28) |
| `POST /consumers/pay/:merchantId` | wallet `{amountCents, idempotencyKey, timestamp, merchantHceToken, source:"MERCHANT_HCE"}` | `consumerPaySchema` accepts all five + `currency`; `source` ignored, derived | none (post-#30) |
| `POST /auth/refresh` (merchant) | `{refreshToken}` → `{token, refreshToken, role, merchantId, expiresAt}` | same | shape matches (#17f); **semantics wrong** — no `deviceId` in, rebinding out (#32) |
| `POST /auth/consumer/refresh` | matches (F-3) | | none |
| `POST /consumers/qr-token`, `/p2p-token`, `/p2p-pay` | wallet | as Session 8 | unread client-side |

END OF SESSION_HANDOVER.md