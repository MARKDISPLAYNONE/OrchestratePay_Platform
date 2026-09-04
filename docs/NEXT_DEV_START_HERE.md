# START HERE — OrchestratePay, handed off 4 Sep 2026 (Session 10)

**Read `docs/SESSION_HANDOVER.md` first.** §0 (rules), §2 (open bugs), §11 (plan), §16 (NFC test-day pre-flight). It is the only status document; READMEs describe design only.

## State at hand-off
- Branch `main`, fork `MARKDISPLAYNONE/OrchestratePay_Platform`. Push to `fork`, never `origin`.
- Stack is **Express 4 + TypeScript + pg + Joi / Vite 6 + React 19 / Kotlin**. Ignore any brief that says Next.js, Prisma or Zod.
- Baseline (all pasted in handover §1): smoke `PASS=35 FAIL=0` · backend tests 1945/1959 (10 failing, 4 suites) · web 785/785 · 4 Android modules build · both APKs on `emulator-5554`.

## What was done this session
- **Bug #32 (security):** merchant `/auth/refresh` could hand a stale device another device's session. Backend fixed and proven (`0ed02d6`). Android client half committed in the same close-out — **built and installed, runtime behaviour not yet observed** (handover §11 Phase 1 is that observation).

## What blocks the product
1. **Daraja sandbox keys** in `Tap2Pay/backend/.env` — every STK Push is 502 until set. 10 minutes at developer.safaricom.co.ke.
2. **Second NFC phone** — HCE/NFC has never run on hardware. Complete §16 before it arrives.

## Do next, in order
1. §11 Phase 1 — log in on emulator, run smoke, confirm the merchant app's refresh is refused (backend log "device mismatch"), no crash.
2. Phase 2 — wire `AuthEventBus.onForceLogout` so a refused refresh returns to the login screen (#17b).
3. Phase 3 — fix the 4 red backend suites (two are refresh tests that now need `deviceId`), add `.gitattributes` (#37), small tickets #33/#35/32-B.

## Non-negotiable habits
- No claim without pasted command output. "Committed", "applied", "verified" are three states.
- `git diff --stat` and `git diff -w --stat` must agree before any commit.
- Never restore a source file from a chat paste — splice from the on-disk copy (handover §7).
- Partial commits: `git commit -m "…" -- paths` (pathspec after the message).
- Don't run the smoke while the merchant app is signed in on a device unless testing #32.
- One command per paste, from repo root.