import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from '../../components/Layout'
import { AdminTabs } from './shared'
import BookingsPage from './BookingsPage'
import BookingDetailPage from './BookingDetailPage'
import CrewPage from './CrewPage'
import PackagesPage from './PackagesPage'
import UsersPage from './UsersPage'

export default function AdminRoutes() {
  return (
    <RequireAuth role={['admin']}>
      <AdminTabs />
      <Routes>
        <Route index element={<BookingsPage />} />
        <Route path="bookings/:id" element={<BookingDetailPage />} />
        <Route path="crew" element={<CrewPage />} />
        <Route path="packages" element={<PackagesPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </RequireAuth>
  )
}
