import { Routes, Route } from 'react-router-dom'
import { Page } from '../../components/ui'

// Placeholder: replaced by the crew feature build.
export default function CrewRoutes() {
  return (
    <Routes>
      <Route path="*" element={<Page title="Crew">Coming soon</Page>} />
    </Routes>
  )
}
