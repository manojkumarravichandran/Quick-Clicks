import { Routes, Route } from 'react-router-dom'
import { Page } from '../../components/ui'

// Placeholder: replaced by the admin feature build.
export default function AdminRoutes() {
  return (
    <Routes>
      <Route path="*" element={<Page title="Admin">Coming soon</Page>} />
    </Routes>
  )
}
