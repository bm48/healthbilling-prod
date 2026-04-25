import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import Dashboard from '@/pages/Dashboard'
import BillingTodo from '@/pages/BillingTodo'
import PatientDatabase from '@/pages/PatientDatabase'
import ProviderSheet from '@/pages/ProviderSheet'
import Reports from '@/pages/Reports'
import Timecards from '@/pages/Timecards'
import SuperAdminSettings from '@/pages/SuperAdminSettings'
import ClinicDetail from '@/pages/ClinicDetail'
import ClinicDashboard from '@/pages/ClinicDashboard'

/** Wrapper that remounts ClinicDetail when providerId changes so the page reloads with the selected provider's data. */
function ClinicDetailWithProviderKey() {
  const { clinicId, providerId } = useParams<{ clinicId: string; providerId?: string }>()
  return <ClinicDetail key={`clinic-${clinicId}-provider-${providerId ?? 'all'}`} />
}
import Invoices from '@/pages/Invoices'
import Login from '@/pages/Login'
import Signup from '@/pages/Signup'
import LandingNew from '@/pages/Landing_new'
import Layout from '@/components/Layout'
import ProviderDashboardPage from '@/pages/providers/ProviderDashboardPage'
import ProviderSheetPage from '@/pages/providers/ProviderSheetPage'
import ProviderSchedulePage from '@/pages/providers/ProviderSchedulePage'
import Messages from '@/pages/Messages'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

function ProviderRoute({ children }: { children: React.ReactNode }) {
  const { user, userProfile, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (userProfile?.role !== 'provider') {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      {/* <Route path="/" element={<Landing />} /> */}
      <Route path="/" element={<LandingNew />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Layout>
              <Dashboard />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/todo"
        element={
          <ProtectedRoute>
            <Layout>
              <BillingTodo />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/patients"
        element={
          <ProtectedRoute>
            <Layout>
              <PatientDatabase />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/provider-sheet"
        element={
          <ProtectedRoute>
            <Layout>
              <ProviderSheet />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedRoute>
            <Layout>
              <Reports />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/timecards"
        element={
          <ProtectedRoute>
            <Layout>
              <Timecards />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/messages"
        element={
          <ProtectedRoute>
            <Layout>
              <Messages />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/invoices"
        element={
          <ProtectedRoute>
            <Layout>
              <Invoices />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin-settings"
        element={
          <ProtectedRoute>
            <Layout>
              <SuperAdminSettings />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/super-admin-settings"
        element={
          <ProtectedRoute>
            <Layout>
              <SuperAdminSettings />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/clinic/:clinicId"
        element={
          <ProtectedRoute>
            <Layout>
              <ClinicDashboard />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/clinic/:clinicId/providers/:providerId?"
        element={
          <ProtectedRoute>
            <Layout>
              <ClinicDetailWithProviderKey />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/clinic/:clinicId/:tab?"
        element={
          <ProtectedRoute>
            <Layout>
              <ClinicDetail />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/providers"
        element={
          <ProviderRoute>
            <Layout>
              <ProviderDashboardPage />
            </Layout>
          </ProviderRoute>
        }
      />
      <Route
        path="/providers/sheet"
        element={<Navigate to="/providers" replace />}
      />
      <Route
        path="/providers/schedule"
        element={<Navigate to="/providers" replace />}
      />
      <Route
        path="/providers/clinics/:clinicId/sheet"
        element={
          <ProviderRoute>
            <Layout>
              <ProviderSheetPage />
            </Layout>
          </ProviderRoute>
        }
      />
      <Route
        path="/providers/clinics/:clinicId/schedule"
        element={
          <ProviderRoute>
            <Layout>
              <ProviderSchedulePage />
            </Layout>
          </ProviderRoute>
        }
      />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
