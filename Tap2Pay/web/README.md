# OrchestratePay Web App — Setup & Testing Guide

Next.js 14 PWA serving three portals from a single codebase:

| Portal | URL prefix | Who uses it |
|--------|-----------|-------------|
| **Merchant** | `/merchant/` | Business owners — analytics, transactions, settings, loyalty |
| **Consumer** | `/consumer/` | Customers — pay merchants, view history, loyalty balance |
| **Admin** | `/admin/` | OrchestratePay staff — merchant approvals, fleet monitoring |

The app proxies `/api/*` requests to the Express backend in development. In production it runs as a standalone Docker container.

---

## 1. Prerequisites

- **Node.js 18+** (LTS recommended) — [download](https://nodejs.org/)
- **npm 9+** (ships with Node 18)
- The **backend** running locally (`cd Tap2Pay/backend && npm run dev`) — the web app needs it for API calls

Verify:
```bash
node -v   # should be 18.x or 20.x
npm -v    # should be 9.x or 10.x
```

---

## 2. Install Dependencies

```bash
cd Tap2Pay/web
npm install
```

---

## 3. Environment Variables

Create a `.env.local` file in `Tap2Pay/web/`:

```env
# Backend API base URL — Next.js rewrites /api/* to this in development
NEXT_PUBLIC_API_URL=http://localhost:3000
```

> **Note:** In development the `next.config.mjs` rewrite rule proxies `/api/*` to `NEXT_PUBLIC_API_URL`, so you don't need CORS configuration. In production the backend URL is injected at build time via CI.

---

## 4. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser (Next.js uses port 3001 if 3000 is taken by the backend).

The dev server supports:
- Hot module replacement (HMR) — changes appear instantly without a page reload
- Fast Refresh for React components

### Available pages

| URL | Description |
|-----|-------------|
| `http://localhost:3001/auth/login` | Login page (merchant / consumer tabs) |
| `http://localhost:3001/auth/register/merchant` | Merchant application form |
| `http://localhost:3001/auth/register/consumer` | Consumer registration |
| `http://localhost:3001/merchant/dashboard` | Merchant analytics overview |
| `http://localhost:3001/merchant/transactions` | Transaction history + pagination |
| `http://localhost:3001/merchant/transactions/:id` | Single transaction detail |
| `http://localhost:3001/merchant/analytics` | Extended analytics charts |
| `http://localhost:3001/merchant/settings` | Business profile settings |
| `http://localhost:3001/merchant/devices` | Device fleet management |
| `http://localhost:3001/merchant/accounting` | Accounting integrations |
| `http://localhost:3001/merchant/loyalty` | Loyalty programme settings |
| `http://localhost:3001/merchant/scan` | QR code scanner |
| `http://localhost:3001/consumer/dashboard` | Consumer home |
| `http://localhost:3001/consumer/pay` | Initiate M-Pesa payment |
| `http://localhost:3001/consumer/loyalty` | Loyalty points/stamps |
| `http://localhost:3001/consumer/profile` | Consumer profile |
| `http://localhost:3001/admin/fleet` | Terminal fleet map + alerts |
| `http://localhost:3001/admin/merchants` | Merchant approval queue |
| `http://localhost:3001/pay/:merchantId` | Public consumer payment link |

---

## 5. Run Unit Tests

Unit tests use **Jest** + **React Testing Library**. They run entirely in Node — no browser, no running server needed.

```bash
# Run all unit tests once
npm run test:unit

# Run in watch mode (re-runs on file save — great for TDD)
npm run test:unit:watch

# Run with coverage report
npm run test:unit:coverage
```

Coverage report is generated at `coverage/lcov-report/index.html`. Open it in a browser:
```bash
open coverage/lcov-report/index.html       # macOS
xdg-open coverage/lcov-report/index.html   # Linux
```

### Run a single test file

```bash
npx jest src/lib/__tests__/auth.test.ts
npx jest src/app/merchant/dashboard
```

### Run tests matching a name pattern

```bash
npx jest --testNamePattern "getRole"
npx jest --testNamePattern "successful payment"
```

---

## 6. Run E2E Tests

End-to-end tests use **Playwright**. They test real browser flows against a running Next.js + backend stack.

### First-time setup — install browsers

```bash
npx playwright install
```

### Run E2E tests

```bash
# Headless (default — fastest, used in CI)
npm run test:e2e

# Interactive UI mode — see browser as tests run
npm run test:e2e:ui

# Headed — watch the actual browser window
npm run test:e2e:headed

# Run a single spec file
npx playwright test e2e/auth/login.spec.ts

# Run against a specific environment
BASE_URL=https://staging.orchestratepay.co.ke npx playwright test
```

> **Important:** E2E tests expect the dev server on `http://localhost:3000`. When running locally, `playwright.config.ts` auto-starts `npm run dev` for you. In CI the server is started as a separate job step.

### E2E test suites

All E2E specs intercept API calls with `page.route()` mocks — no live backend required.

| Spec file | What it covers |
|-----------|---------------|
| `e2e/auth/login.spec.ts` | Merchant + consumer login, lockout, redirect |
| `e2e/auth/register.spec.ts` | Merchant registration form + pending state |
| `e2e/merchant/dashboard.spec.ts` | KPI cards, chart rendering, navigation |
| `e2e/merchant/scan.spec.ts` | NFC fallback banner, amount entry, STK Push + poll → success/failure |
| `e2e/merchant/transactions.spec.ts` | List columns, status badges, row detail, receipt, CSV export |
| `e2e/merchant/accounting.spec.ts` | Platform cards, connect/disconnect, GL posting log |
| `e2e/merchant/loyalty.spec.ts` | Programme onboarding, POINTS/STAMPS toggle, save flow |
| `e2e/admin/merchant-approval.spec.ts` | Approve/reject/suspend flows, notes field, error state |
| `e2e/admin/portal.spec.ts` | Admin login, merchant approval, fleet view |
| `e2e/consumer/pay.spec.ts` | Auth stage → amount stage → STK Push → confirmed/failed |
| `e2e/consumer/portal.spec.ts` | Consumer pay flow, loyalty balance, profile |
| `e2e/consumer/loyalty.spec.ts` | Points/stamps cards, progress bar, redeem threshold, empty state |

---

## 7. What Unit Tests Exist

| Test file | Tests | What it covers |
|-----------|-------|----------------|
| `lib/__tests__/auth.test.ts` | 33 | JWT decode, `saveToken`/`clearToken`/`getToken`, `getRole` (all roles + expiry), `getSubject`/`getName` (including missing-claim null path), `dashboardPath` |
| `lib/__tests__/api.test.ts` | 61 | `ApiError`, admin secret helpers, Authorization header, all API namespaces: `auth`, `merchants`, `consumers`, `transactions`, `fx`, `devices`, `accounting`, `loyalty`, `admin` (X-Admin-Secret header) |
| `auth/login/__tests__/LoginClient.test.tsx` | 17 | Login form, tab switch, loading state, redirects, error display |
| `auth/register/merchant/__tests__/MerchantRegisterPage.test.tsx` | 21 | Registration form, submit, success state, error handling |
| `merchant/dashboard/__tests__/MerchantDashboard.test.tsx` | 13 | KPI aggregation, loading/error/empty states, payment sources |
| `merchant/transactions/__tests__/TransactionsPage.test.tsx` | 18 | Table render, status badges, row navigation, pagination, empty/error states |
| `merchant/accounting/__tests__/AccountingPage.test.tsx` | 23 | GL export, all four platforms, connect flow, token input, GL posting log |
| `merchant/analytics/__tests__/AnalyticsPage.test.tsx` | 9 | Revenue section, peak hours, empty data, loading placeholders |
| `merchant/devices/__tests__/DevicesPage.test.tsx` | 15 | Fleet list, battery/NFC/printer badges, alerts count, empty/error states |
| `merchant/loyalty/__tests__/LoyaltyPage.test.tsx` | 18 | POINTS/STAMPS toggle, field switching, no-programme banner, save flow |
| `merchant/onboarding/__tests__/OnboardingPage.test.tsx` | 14 | All fields, validation, KRA PIN, submit → redirect, error display |
| `merchant/settings/__tests__/SettingsPage.test.tsx` | 16 | Profile pre-fill, editable name, save success/error, "Saving…" state |
| `merchant/scan/__tests__/ScanPage.test.tsx` | 21 | NFC unsupported fallback, amount validation, STK Push, CONFIRMED/DECLINED |
| `consumer/pay/__tests__/ConsumerPayPage.test.tsx` | 17 | KSh→cents conversion, idempotency key, success/loading/error states |
| `consumer/dashboard/__tests__/ConsumerDashboard.test.tsx` | 21 | Transaction history, status colour badges, KPI totals, empty state |
| `consumer/profile/__tests__/ConsumerProfile.test.tsx` | 18 | Read-only phone, editable display name, save, SMS opt-in checkbox |
| `consumer/loyalty/__tests__/ConsumerLoyalty.test.tsx` | 24 | Points/stamps cards, progress bar, "ready to redeem", multiple merchants |
| `admin/merchants/__tests__/AdminMerchants.test.tsx` | 26 | Approve/reject/suspend flows, action in-flight state, error banner |
| `admin/fleet/__tests__/AdminFleet.test.tsx` | 30 | Device list, battery warning colours, printer codes, NFC status, alerts |

---

## 8. Build for Production

```bash
# Build a production-optimised bundle
npm run build

# Run the production server locally (after build)
npm start
```

The build output is a standalone Next.js app. The Docker image is built from `Dockerfile`:

```bash
docker build -t orchestratepay-web .
docker run -p 3001:3000 -e NEXT_PUBLIC_API_URL=https://api.orchestratepay.co.ke orchestratepay-web
```

---

## 9. Project Structure

```
src/
  app/
    auth/          — Login + registration pages
    merchant/      — Merchant portal (dashboard, transactions, settings, …)
    consumer/      — Consumer portal (pay, loyalty, profile)
    admin/         — Admin portal (fleet, merchant approvals)
    pay/[merchantId]/  — Public payment link page
  lib/
    api.ts         — Typed fetch client for all backend endpoints
    auth.ts        — JWT storage, role extraction, login state
```

---

## 10. Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Next.js 14 App Router | SSR + RSC + file-based routing |
| Styling | Tailwind CSS | Utility-first, no stylesheet context switching |
| Charts | Recharts | React-native bar/line charts for analytics |
| QR codes | qrcode.react | Merchant QR display for consumer scan |
| Auth | JWT in sessionStorage / localStorage | Stateless, works offline |
| Unit tests | Jest + React Testing Library | jsdom, no browser needed |
| E2E tests | Playwright | Cross-browser, mobile viewport support |
| PWA | Service worker + Web App Manifest | Works on Android home screen |
