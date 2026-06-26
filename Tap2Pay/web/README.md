# OrchestratePay Web App

Vite + React 19 SPA serving three portals from a single codebase.

| Portal | URL prefix | Who uses it |
|--------|-----------|-------------|
| **Merchant** | `/merchant/` | Business owners — analytics, transactions, settings, loyalty |
| **Consumer** | `/consumer/` | Customers — pay merchants, view history, loyalty balance |
| **Admin** | `/admin/` | OrchestratePay staff — merchant approvals, fleet monitoring |

---

## 1. Prerequisites

- **Node.js 20+** (LTS recommended)
- **npm 10+**
- The **backend** running locally (`cd Tap2Pay/backend && npm run dev`) for API calls

---

## 2. Install & Run

```bash
cd Tap2Pay/web
npm install
cp .env.example .env.local
# Edit .env.local — set VITE_API_URL=http://localhost:3000
npm run dev          # Vite dev server on :5173 (or next available port)
```

Open [http://localhost:5173](http://localhost:5173).

---

## 3. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_URL` | Yes | Backend base URL — `http://localhost:3000` for local dev |
| `VITE_GOOGLE_CLIENT_ID` | No | Enables Google OAuth button on the login page |

Create `.env.local` (git-ignored):
```env
VITE_API_URL=http://localhost:3000
VITE_GOOGLE_CLIENT_ID=
```

---

## 4. Available Routes

| URL | Description |
|-----|-------------|
| `/` | Splash screen → redirects to dashboard |
| `/auth/login` | Login (merchant / consumer tabs) |
| `/auth/register/merchant` | Merchant application |
| `/auth/register/consumer` | Consumer registration |
| `/merchant/dashboard` | KPI overview, 7-day revenue chart |
| `/merchant/transactions` | Transaction history + pagination |
| `/merchant/transactions/:id` | Single transaction detail |
| `/merchant/analytics` | Extended revenue and source charts |
| `/merchant/scan` | NFC / QR payment initiation |
| `/merchant/devices` | Device fleet telemetry |
| `/merchant/accounting` | GL export (QuickBooks, Xero, Sage, Wave) |
| `/merchant/loyalty` | Loyalty programme configuration |
| `/merchant/settlement` | Payout accounts + settlement history |
| `/merchant/kyc` | KYC document upload |
| `/merchant/settings` | Business profile |
| `/merchant/onboarding` | Registration wizard |
| `/consumer/dashboard` | Transaction history + spend summary |
| `/consumer/pay` | Initiate M-Pesa payment |
| `/consumer/loyalty` | Points and stamps balances |
| `/consumer/profile` | Display name, SMS opt-in |
| `/admin/dashboard` | Platform-wide stats |
| `/admin/merchants` | Merchant approval queue |
| `/admin/consumers` | Consumer list |
| `/admin/fleet` | Device fleet map + alerts |
| `/pay/:merchantId` | Public QR payment link (no login needed) |

---

## 5. Tests

### Unit tests (Jest + React Testing Library)

No browser or running server needed — all mocked.

```bash
npm run test:unit             # run once
npm run test:unit:watch       # re-run on save
npm run test:unit:coverage    # with coverage report
```

Coverage report: `coverage/lcov-report/index.html`

Run a single file or pattern:
```bash
npx jest src/pages/merchant/__tests__/TransactionsPage.test.tsx
npx jest --testNamePattern "successful payment"
```

### Test suites (452 assertions, 23 suites)

| Suite | Tests | What it covers |
|-------|-------|----------------|
| `lib/__tests__/auth.test.ts` | 33 | JWT decode, token storage, `getRole`, `dashboardPath` |
| `lib/__tests__/api.test.ts` | 61 | `ApiError`, all API namespaces, admin header |
| `pages/auth/__tests__/LoginClient.test.tsx` | 17 | Login form, tabs, loading, redirects, Google OAuth |
| `pages/auth/__tests__/MerchantRegisterPage.test.tsx` | 21 | Form fields, submit, success state, errors |
| `pages/merchant/__tests__/MerchantDashboard.test.tsx` | 13 | KPI aggregation, loading/error/empty states |
| `pages/merchant/__tests__/TransactionsPage.test.tsx` | 18 | Table, badges, row nav, pagination, empty/error |
| `pages/merchant/__tests__/AccountingPage.test.tsx` | 23 | Four platforms, connect/disconnect, GL log |
| `pages/merchant/__tests__/AnalyticsPage.test.tsx` | 9 | Charts, empty data, loading placeholders |
| `pages/merchant/__tests__/DevicesPage.test.tsx` | 15 | Fleet list, battery/NFC/printer badges, alerts |
| `pages/merchant/__tests__/LoyaltyPage.test.tsx` | 18 | POINTS/STAMPS toggle, save flow, validation |
| `pages/merchant/__tests__/OnboardingPage.test.tsx` | 14 | 3-step wizard, validation, submit → redirect |
| `pages/merchant/__tests__/SettingsPage.test.tsx` | 16 | Profile pre-fill, editable name, save |
| `pages/merchant/__tests__/ScanPage.test.tsx` | 21 | NFC fallback, amount validation, STK Push |
| `pages/consumer/__tests__/ConsumerPayPage.test.tsx` | 17 | KSh→cents, idempotency key, success/error |
| `pages/consumer/__tests__/ConsumerDashboard.test.tsx` | 21 | History, status badges, KPI totals |
| `pages/consumer/__tests__/ConsumerProfile.test.tsx` | 18 | Display name, SMS checkbox, save |
| `pages/consumer/__tests__/ConsumerLoyalty.test.tsx` | 24 | Points/stamps, progress bar, redeem threshold |
| `pages/admin/__tests__/AdminMerchants.test.tsx` | 26 | Approve/reject/suspend, in-flight state |
| `pages/admin/__tests__/AdminFleet.test.tsx` | 30 | Device list, battery/NFC/printer, alerts |

### E2E tests (Playwright)

Requires a running dev stack.

```bash
npx playwright install       # first time only
npm run test:e2e             # headless
npm run test:e2e:ui          # interactive UI
```

---

## 6. Build for Production

```bash
npm run build          # outputs to dist/
npm run preview        # serve dist/ locally to verify
```

Docker:
```bash
docker build -t orchestratepay-web .
docker run -p 5173:80 -e VITE_API_URL=https://api.orchestratepay.co.ke orchestratepay-web
```

---

## 7. Project Structure

```
src/
  main.tsx              App entry point
  App.tsx               React Router route tree
  index.css             Tailwind + dark design system (glass, btn-primary, badges)
  vite-env.d.ts         Vite type declarations
  pages/
    auth/               Login, MerchantRegister, ConsumerRegister
    merchant/           Dashboard, Transactions, Scan, Analytics, Devices,
                        Accounting, Loyalty, Settlement, KYC, Settings, Onboarding
    consumer/           Dashboard, Pay, Loyalty, Profile
    admin/              Dashboard, Login, Merchants, Consumers, Fleet
    HomePage.tsx        Splash gate → redirect
    PayLinkPage.tsx     Public /pay/:merchantId page
    ConsumerScanPage.tsx  NFC scan → pay flow
  components/
    ui/                 GlassCard, Badge, KpiCard, PageHeader
    layouts/            MerchantLayout, ConsumerLayout, AdminLayout
  lib/
    api.ts              Typed fetch client for all backend endpoints
    auth.ts             JWT storage, role extraction, login state
  hooks/
    useAuth.ts          Auth state hook
```

---

## 8. Tech Stack

| Layer | Choice |
|-------|--------|
| Build tool | Vite 6 |
| Framework | React 19 + React Router v6 |
| Styling | Tailwind CSS 3 + custom dark design system |
| Charts | Recharts |
| Auth | JWT in sessionStorage / localStorage |
| Unit tests | Jest 29 + React Testing Library + babel-jest |
| E2E tests | Playwright |
