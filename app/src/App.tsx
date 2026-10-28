import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import { Layout } from './components/Layout'
import { PageLoader } from './components/ui'
import SignIn from './pages/SignIn'

// Each feature area owns its own folder and its own nested routes.
const CustomerRoutes = lazy(() => import('./features/customer/CustomerRoutes'))
const CrewRoutes = lazy(() => import('./features/crew/CrewRoutes'))
const AdminRoutes = lazy(() => import('./features/admin/AdminRoutes'))

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/signin" element={<SignIn />} />
              <Route path="/crew/*" element={<CrewRoutes />} />
              <Route path="/admin/*" element={<AdminRoutes />} />
              <Route path="/*" element={<CustomerRoutes />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  )
}
