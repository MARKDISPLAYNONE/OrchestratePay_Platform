# OrchestratePay Web Frontend

Next.js 14 web app serving the merchant portal, consumer portal, admin portal, and the public QR payment page. Located at `Tap2Pay/web/`.

---

## Tech Stack

| Layer | Library / Version |
|---|---|
| Framework | Next.js 14.2.0 (App Router) |
| React | 18.3.x |
| Styling | Tailwind CSS 3.4.x |
| Charts | Recharts 2.12.x |
| QR codes | qrcode.react 3.1.x |
| JWT decode | jose 5.4.x |
| HTTP client | Native `fetch` (no Axios) |
| Language | TypeScript 5.x |
| Testing (unit) | Jest 29 + React Testing Library |
| Testing (E2E) | Playwright 1.60.x |
| Build output | `output: 'standalone'` (self-contained Node server) |

Tailwind is configured with a `brand` color scale (green-50 → green-900, primary accent is `brand-600 = #16a34a`), Inter font, and rounded-2xl/3xl extensions. Config is at `Tap2Pay/web/tailwind.config.ts`.

---

## Environment Variables

Only one env var is used by the web app:

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes (production) | Base URL of the backend API, e.g. `https://api.orchestratepay.co.ke`. In development, leave unset — the Next.js rewrite proxy handles `/api/*` automatically. |

`NEXT_PUBLIC_API_URL` is baked into the client bundle at build time (Next.js `NEXT_PUBLIC_` prefix). You must pass it as a `--build-arg` to Docker or set it before running `npm run build`. See the Dockerfile and `web-deployment.yaml` for how this is done in CI and K8s.

In development, the variable can be left unset — the rewrite rule in `next.config.mjs` proxies `/api/*` to `http://localhost:3000` (the backend default port).

---

## Running the Dev Server

```bash
cd Tap2Pay/web
npm install
npm run dev          # Next.js on :3001 if :3000 is taken (start backend first)
```

Start the backend before the web app. Both default to port 3000; Next.js auto-increments to 3001.

Available scripts:

```bash
npm run dev              # hot-reload dev server
npm run build            # production build (requires NEXT_PUBLIC_API_URL set)
npm start                # serve the production build (PORT env var, default 3000)
npm run lint             # Next.js ESLint
npm run test:unit        # Jest unit tests
npm run test:unit:watch  # Jest in watch mode
npm run test:e2e         # Playwright E2E
npm run test:e2e:ui      # Playwright with interactive UI
npm run test:e2e:headed  # Playwright in headed browser
```

---

## Project Structure

```
Tap2Pay/web/src/
  app/                     Next.js App Router pages
    layout.tsx             Root layout (sets <html lang>, imports globals.css)
    page.tsx               / — redirects to role-appropriate dashboard
    globals.css            Tailwind base styles

    auth/
      login/page.tsx       /auth/login — merchant login (dynamic import, no SSR)
      register/
        merchant/page.tsx  /auth/register/merchant — merchant registration
        consumer/page.tsx  /auth/register/consumer — consumer registration

    merchant/
      layout.tsx           Merchant layout: sidebar nav + auth guard (MERCHANT role)
      dashboard/page.tsx   /merchant/dashboard — 7-day KPI cards + bar chart
      scan/page.tsx        /merchant/scan — Web NFC reader (Chrome/Android only)
      transactions/
        page.tsx           /merchant/transactions — paginated transaction list
        [id]/page.tsx      /merchant/transactions/[id] — transaction detail
      analytics/page.tsx   /merchant/analytics — peak hours, weekly revenue
      devices/page.tsx     /merchant/devices — fleet status for this merchant
      loyalty/page.tsx     /merchant/loyalty — loyalty programme setup
      accounting/page.tsx  /merchant/accounting — QuickBooks/Xero/Sage/Wave connect
      settings/page.tsx    /merchant/settings — profile, M-Pesa shortcode, KRA PIN

    consumer/
      layout.tsx           Consumer layout: bottom nav + auth guard (CONSUMER role)
      dashboard/page.tsx   /consumer/dashboard — recent payments, total spent card
      pay/page.tsx         /consumer/pay — payment initiation for authenticated consumers
      loyalty/page.tsx     /consumer/loyalty — points/stamps balance
      profile/page.tsx     /consumer/profile — display name, SMS opt-in

    admin/
      layout.tsx           Admin layout: dark theme sidebar + cookie-based auth guard
      login/page.tsx       /admin/login — admin secret entry
      page.tsx             /admin — platform stats (transactions, timing, infra health)
      fleet/page.tsx       /admin/fleet — all device fleet + unresolved alerts
      merchants/page.tsx   /admin/merchants — pending merchant approvals

    pay/
      [merchantId]/page.tsx  /pay/[merchantId] — PUBLIC QR payment page (no login required to view)

    scan/page.tsx          /scan — consumer Web NFC scan (reads merchant tag → redirects to /pay/[id])

  lib/
    api.ts                 Typed API client (all backend calls go through here)
    auth.ts                JWT decode, token storage, role detection
    webnfc.d.ts            TypeScript types for the Web NFC API

  hooks/                   Custom React hooks directory
  types/                   Shared TypeScript types
  middleware.ts            Next.js middleware: route guards for /admin/* and /consumer/*
```

---

## Pages and What They Do

### `/` (root)
Client component. Reads the current user's role from the JWT in storage and immediately redirects:
- MERCHANT → `/merchant/dashboard`
- CONSUMER → `/consumer/dashboard`
- ADMIN → `/admin/fleet`
- No token → `/auth/login`

### `/auth/login`
Merchant login form. Loaded with `dynamic(..., { ssr: false })` to avoid SSR issues with localStorage. Calls `POST /api/v1/auth/login` with `{ email, password, deviceId }`. On success, saves the JWT and redirects to `/merchant/dashboard`.

### `/auth/register/merchant`
Merchant registration. Calls `POST /api/v1/auth/register`. New accounts land in `PENDING` status until admin approval.

### `/auth/register/consumer`
Consumer registration. Calls `POST /api/v1/auth/consumer/register`.

### `/merchant/dashboard`
Requires MERCHANT JWT. Fetches 7-day revenue (`GET /api/v1/merchants/me/analytics/weekly`) and payment source breakdown (`GET /api/v1/merchants/me/analytics/sources`). Renders KPI cards and a Recharts BarChart.

### `/merchant/scan`
Web NFC scanner for merchants. Uses the `NDEFReader` Web NFC API (Chrome 89+ on Android only). Reads two tag formats:
1. Consumer-written NTAG215: `https://orchestratepay.co.ke/c/{consumerId}` — resolves via `GET /api/v1/consumers/c/{consumerId}`
2. Merchant-programmed consumer identity tag: `orchestratepay://pay?mid=...&tid=...` — uses `tagId` directly

After resolving the consumer, merchant enters amount and hits Pay. Calls `POST /api/v1/transactions` and polls `GET /api/v1/transactions/{txnId}/status` every 2.5 seconds. Timeout is 90 seconds.

### `/merchant/transactions`
Paginated list of the merchant's transactions (25 per page). Calls `GET /api/v1/transactions?limit=25&offset=N`.

### `/merchant/transactions/[id]`
Transaction detail view. Calls `GET /api/v1/transactions/{txnId}/status`.

### `/merchant/analytics`
Peak-hours heatmap and extended analytics. Calls `GET /api/v1/merchants/me/analytics/peak-hours`.

### `/merchant/devices`
Fleet status for the logged-in merchant's own devices. Calls `GET /api/v1/admin/fleet` (merchant-scoped result). Shows battery, printer status (1=Ready, 4=No paper, 5=Overheat), NFC availability, app version, last-seen time.

### `/merchant/loyalty`
Programme setup: POINTS (points per KSh) or STAMPS (stamps-for-reward). Calls `GET/POST /api/v1/loyalty/programme`.

### `/merchant/accounting`
Connect/disconnect accounting platforms (QuickBooks, Xero, Sage, Wave). Pastes an API access token. Shows GL posting log. Calls `GET/POST/DELETE /api/v1/accounting/integrations/...` and `GET /api/v1/accounting/gl-postings`.

### `/merchant/settings`
Profile edit: name, phone, M-Pesa shortcode, account ref, KRA PIN. Calls `PUT /api/v1/merchants/me`.

### `/consumer/dashboard`
Recent 10 payments and total-spent summary card. Calls `GET /api/v1/consumers/me/transactions?limit=10`.

### `/consumer/pay`
Authenticated consumer payment initiation. Used when consumer is already logged in and wants to pay a specific merchant by ID.

### `/consumer/loyalty`
Loyalty balance (points or stamps). Calls `GET /api/v1/consumers/me/loyalty`.

### `/consumer/profile`
Display name, SMS opt-in toggle. Calls `GET/PUT /api/v1/consumers/me`.

### `/admin`
Platform-wide stats: all-time totals, last-24h breakdown, timing percentiles (p50/p95), hourly bar sparkline, Redis health, Daraja circuit breaker state. Calls `GET /api/v1/admin/stats` with `X-Admin-Secret` header.

### `/admin/login`
Admin secret entry form. Stores the secret in `sessionStorage` and sets an `admin_auth` cookie (non-httpOnly) so the Next.js middleware can gate `/admin/*` routes.

### `/admin/fleet`
All device fleet across all merchants. Shows online/offline status (online = last seen < 5 minutes ago), battery, printer, NFC, app version. Unresolved alerts shown at top. Calls `GET /api/v1/admin/fleet` and `GET /api/v1/admin/fleet/alerts?unresolved`.

### `/admin/merchants`
Pending merchant approvals. Calls `GET /api/v1/auth/admin/pending` and `POST /api/v1/auth/admin/approve/{merchantId}`.

### `/pay/[merchantId]` (PUBLIC — no auth required to view)
The consumer-facing QR payment page. This is what renders when a customer scans the merchant's QR code. Works on any device including iOS.

**Flow:**
1. On mount: `GET /api/v1/consumers/pay/{merchantId}` (no auth) — fetches merchant name
2. If no CONSUMER JWT in storage → shows inline login/register form
3. Consumer enters amount (minimum KSh 1.00; pre-filled from `?amount=` query param if present)
4. Consumer taps "Pay with M-Pesa" → `POST /api/v1/consumers/pay/{merchantId}` with `{ amountCents, idempotencyKey, timestamp }`
5. Page polls `GET /api/v1/consumers/transactions/{txnId}/status` every 2.5 seconds
6. On CONFIRMED: shows M-Pesa receipt reference
7. On DECLINED/FAILED/EXPIRED: shows error with retry button
8. Hard timeout: 3 minutes

The idempotency key is generated client-side via `crypto.randomUUID()`. The JWT is read from `sessionStorage` first, then `localStorage` (consumers can choose persistent login).

### `/scan`
Consumer Web NFC scanner. Reads merchant display tags (`https://orchestratepay.co.ke/pay/{merchantId}`) and redirects to `/pay/{merchantId}`. Fallback for consumers who have the web PWA but not the native Android app. Shows a clear unsupported message on iOS (iOS cannot use Web NFC API; on iOS, the NFC tag triggers an OS-level URL open instead).

---

## How the Web App Calls the Backend API

All API calls go through `src/lib/api.ts`. The base URL is:

```ts
const BASE = process.env.NEXT_PUBLIC_API_URL ?? ''
```

In development, `NEXT_PUBLIC_API_URL` is typically unset (empty string), and the Next.js rewrite rule in `next.config.mjs` proxies `/api/*` to the backend:

```js
// Only active in development (process.env.NODE_ENV === 'development')
{ source: '/api/:path*', destination: `${NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'}/api/:path*' }
```

In production, `NEXT_PUBLIC_API_URL` is set to `https://api.orchestratepay.co.ke` and requests go directly to the backend domain (no proxy — the rewrite only applies in development).

### Auth headers

The `request()` helper in `api.ts` attaches headers automatically:

- **JWT Bearer token**: Read from `sessionStorage('token')` first, then `localStorage('token')`. Attached as `Authorization: Bearer <token>` on all calls unless `{ auth: false }` is passed.
- **Admin secret**: Read from `sessionStorage('admin_secret')`. Attached as `X-Admin-Secret: <secret>` when `{ adminAuth: true }` is passed.
- **Content-Type**: `application/json` by default.

Errors: non-2xx responses throw `ApiError(status, message)`. All pages catch this and display the `message` to the user.

---

## Auth State Management (`src/lib/auth.ts`)

JWTs are stored in browser storage. The server never sees the token except via the `Authorization` header on API calls.

| Actor | Storage | Persistence |
|---|---|---|
| Merchant | `sessionStorage` | Tab lifetime only |
| Consumer | `sessionStorage` (default) or `localStorage` (if "remember me") | Tab or 30 days |
| Admin secret | `sessionStorage` | Tab lifetime only |

A non-httpOnly `auth_role` cookie is set alongside the token so that Next.js middleware can gate routes at the edge without reading the JWT. The middleware at `src/middleware.ts` gates:
- `/admin/*` (except `/admin/login`): requires `admin_auth` cookie
- `/consumer/*`: requires `auth_role=CONSUMER` cookie

The merchant portal (`/merchant/*`) is NOT gated by the middleware — instead the `merchant/layout.tsx` does a client-side check via `useEffect` and redirects if `getRole() !== 'MERCHANT'`.

Role is extracted client-side by base64-decoding the JWT payload (no signature verification — the server verifies on every API call). Legacy tokens without a `role` claim are treated as MERCHANT.

---

## Consumer Payment Link Flow (QR Code)

The shareable payment link for a merchant is:

```
https://orchestratepay.co.ke/pay/{merchantId}
```

Optionally with a pre-filled amount:

```
https://orchestratepay.co.ke/pay/{merchantId}?amount=500
```

The QR code on the merchant's physical sticker encodes the first form. When scanned:
- On iOS: the OS intercepts the NDEF URL record and opens Safari directly to the page (native NFC URL launch)
- On Android with native app installed: `NfcTagPaymentActivity` handles the tap directly (skips the web page)
- On Android without native app / from Chrome Web NFC via `/scan`: the web page loads

The page at `/pay/[merchantId]/page.tsx` handles the full flow inline — no redirect away from the page. The consumer never needs to install anything.

---

## Route Guard Summary

| Path prefix | Guard type | Redirects to |
|---|---|---|
| `/merchant/*` | Client-side (`useEffect` in layout) | `/auth/login` |
| `/consumer/*` | Edge middleware (cookie check) | `/auth/login` |
| `/admin/*` (not `/admin/login`) | Edge middleware (cookie check) | `/admin/login` |
| `/pay/[merchantId]` | None — fully public | — |
| `/scan` | None — fully public | — |
| `/auth/*` | None | — |

---

## Common Issues

### CORS errors in the browser
**Symptom**: `Access-Control-Allow-Origin` errors when calling the backend.

**Cause**: `NEXT_PUBLIC_API_URL` is set in the web app but the backend's CORS allowlist does not include the web app's origin. The backend uses `cors-origin` from the ConfigMap (`https://orchestratepay.co.ke` in production). In development this should be unset and traffic should go through the Next.js rewrite proxy instead of hitting the backend directly from the browser.

**Fix in development**: Leave `NEXT_PUBLIC_API_URL` unset so the proxy applies. Or set the backend's `CORS_ORIGIN` env var to `http://localhost:3001`.

**Fix in production**: Verify `cors-origin` in `infra/k8s/backend/configmap.yaml` matches the web app's domain exactly.

### `NEXT_PUBLIC_API_URL` not baked into the build
**Symptom**: The web app makes API calls to an empty base URL (relative paths that 404 in production).

**Cause**: `NEXT_PUBLIC_API_URL` must be set at **build time**, not runtime, because Next.js inlines `process.env.NEXT_PUBLIC_*` during compilation.

**Fix**: Set it as a Docker build arg (`--build-arg NEXT_PUBLIC_API_URL=https://api.orchestratepay.co.ke`) or as an environment variable before `npm run build`. The Dockerfile accepts it as `ARG NEXT_PUBLIC_API_URL`.

### Web NFC "Permission denied" or "Not supported"
**Symptom**: `/merchant/scan` or `/scan` shows "NFC not available".

**Cause**: Web NFC (`NDEFReader`) only works in Chrome 89+ on Android over HTTPS. It does not work on iOS, Firefox, desktop Chrome, or over HTTP.

**Fix**: Use the native Android app for NFC scanning. The web scan pages show a clear fallback message — do not suppress it.

### Admin login loop
**Symptom**: After entering the admin secret, the page redirects back to `/admin/login`.

**Cause**: The `admin_auth` cookie is not being set (JS error in `saveAdminSecret()`, or the browser is blocking cookies with `SameSite=Strict` in a cross-origin iframe).

**Fix**: Verify the secret is being stored in `sessionStorage('admin_secret')` and the cookie is present in DevTools → Application → Cookies.

### Consumer portal redirects to login after refresh
**Symptom**: Consumer logs in, navigates away, returns, is sent back to login.

**Cause**: Consumer login defaults to `sessionStorage` (cleared on tab close). If the consumer did not opt for persistent login, the token is gone after a refresh.

**Fix**: The `/pay/[merchantId]` page explicitly checks both `sessionStorage` and `localStorage`. The consumer dashboard redirects because the `auth_role` cookie has also expired. This is by design for security. If you need persistence, confirm the consumer selected "remember me" (which saves to `localStorage` and sets `max-age=2592000` on the cookie).
