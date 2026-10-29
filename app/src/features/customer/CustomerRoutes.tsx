import { Routes, Route } from 'react-router-dom'
import { RequireAuth } from '../../components/Layout'
import { EmptyState, Page } from '../../components/ui'
import Home from './Home'
import Packages from './Packages'
import Instant from './Instant'
import Book from './Book'
import Bookings from './Bookings'
import Tracking from './Tracking'

export default function CustomerRoutes() {
  return (
    <Routes>
      <Route index element={<Home />} />
      <Route path="packages" element={<Packages />} />
      <Route path="instant" element={<Instant />} />
      <Route
        path="book"
        element={
          <RequireAuth>
            <Book />
          </RequireAuth>
        }
      />
      <Route
        path="bookings"
        element={
          <RequireAuth>
            <Bookings />
          </RequireAuth>
        }
      />
      <Route
        path="bookings/:id"
        element={
          <RequireAuth>
            <Tracking />
          </RequireAuth>
        }
      />
      <Route
        path="*"
        element={
          <Page title="Not found">
            <EmptyState title="This page doesn't exist" />
          </Page>
        }
      />
    </Routes>
  )
}
