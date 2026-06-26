import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { GoogleOAuthProvider } from '@react-oauth/google'

import MerchantLayout from '@/components/layouts/MerchantLayout'
import ConsumerLayout from '@/components/layouts/ConsumerLayout'
import AdminLayout    from '@/components/layouts/AdminLayout'

import HomePage              from '@/pages/HomePage'
import LoginPage             from '@/pages/auth/LoginPage'
import MerchantRegisterPage  from '@/pages/auth/MerchantRegisterPage'
import ConsumerRegisterPage  from '@/pages/auth/ConsumerRegisterPage'

import MerchantDashboard     from '@/pages/merchant/DashboardPage'
import MerchantTransactions  from '@/pages/merchant/TransactionsPage'
import TransactionDetail     from '@/pages/merchant/TransactionDetailPage'
import MerchantScan          from '@/pages/merchant/ScanPage'
import MerchantAnalytics     from '@/pages/merchant/AnalyticsPage'
import MerchantDevices       from '@/pages/merchant/DevicesPage'
import MerchantAccounting    from '@/pages/merchant/AccountingPage'
import MerchantLoyalty       from '@/pages/merchant/LoyaltyPage'
import MerchantSettlement    from '@/pages/merchant/SettlementPage'
import MerchantKyc           from '@/pages/merchant/KycPage'
import MerchantSettings      from '@/pages/merchant/SettingsPage'
import MerchantOnboarding    from '@/pages/merchant/OnboardingPage'

import ConsumerDashboard     from '@/pages/consumer/DashboardPage'
import ConsumerPay           from '@/pages/consumer/PayPage'
import ConsumerLoyalty       from '@/pages/consumer/LoyaltyPage'
import ConsumerProfile       from '@/pages/consumer/ProfilePage'

import AdminDashboard        from '@/pages/admin/DashboardPage'
import AdminLogin            from '@/pages/admin/LoginPage'
import AdminMerchants        from '@/pages/admin/MerchantsPage'
import AdminConsumers        from '@/pages/admin/ConsumersPage'
import AdminFleet            from '@/pages/admin/FleetPage'

import PayLinkPage           from '@/pages/PayLinkPage'
import ConsumerScanPage      from '@/pages/ConsumerScanPage'

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

export default function App() {
  return (
    <GoogleOAuthProvider clientId={clientId}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          {/* Public */}
          <Route path="/"                          element={<HomePage />} />
          <Route path="/auth/login"                element={<LoginPage />} />
          <Route path="/auth/register/merchant"    element={<MerchantRegisterPage />} />
          <Route path="/auth/register/consumer"    element={<ConsumerRegisterPage />} />
          <Route path="/pay/:merchantId"           element={<PayLinkPage />} />
          <Route path="/scan"                      element={<ConsumerScanPage />} />

          {/* Admin */}
          <Route path="/admin/login"               element={<AdminLogin />} />
          <Route path="/admin"                     element={<AdminLayout />}>
            <Route index                           element={<AdminDashboard />} />
            <Route path="merchants"               element={<AdminMerchants />} />
            <Route path="consumers"               element={<AdminConsumers />} />
            <Route path="fleet"                   element={<AdminFleet />} />
          </Route>

          {/* Merchant */}
          <Route path="/merchant"                  element={<MerchantLayout />}>
            <Route index                           element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard"               element={<MerchantDashboard />} />
            <Route path="scan"                    element={<MerchantScan />} />
            <Route path="transactions"            element={<MerchantTransactions />} />
            <Route path="transactions/:id"        element={<TransactionDetail />} />
            <Route path="analytics"               element={<MerchantAnalytics />} />
            <Route path="devices"                 element={<MerchantDevices />} />
            <Route path="accounting"              element={<MerchantAccounting />} />
            <Route path="loyalty"                 element={<MerchantLoyalty />} />
            <Route path="settlement"              element={<MerchantSettlement />} />
            <Route path="kyc"                     element={<MerchantKyc />} />
            <Route path="settings"               element={<MerchantSettings />} />
            <Route path="onboarding"              element={<MerchantOnboarding />} />
          </Route>

          {/* Consumer */}
          <Route path="/consumer"                  element={<ConsumerLayout />}>
            <Route index                           element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard"               element={<ConsumerDashboard />} />
            <Route path="pay"                     element={<ConsumerPay />} />
            <Route path="loyalty"                 element={<ConsumerLoyalty />} />
            <Route path="profile"                 element={<ConsumerProfile />} />
          </Route>

          <Route path="*"                          element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </GoogleOAuthProvider>
  )
}
