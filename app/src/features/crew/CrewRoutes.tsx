import { Routes, Route, Navigate } from 'react-router-dom'
import { RequireAuth } from '../../components/Layout'
import { CrewProvider } from './CrewContext'
import CrewDashboard from './CrewDashboard'
import CrewJoin from './CrewJoin'
import CrewJob from './CrewJob'

export default function CrewRoutes() {
  return (
    <RequireAuth>
      <CrewProvider>
        <Routes>
          <Route index element={<CrewDashboard />} />
          <Route path="join" element={<CrewJoin />} />
          <Route path="jobs/:id" element={<CrewJob />} />
          <Route path="*" element={<Navigate to="/crew" replace />} />
        </Routes>
      </CrewProvider>
    </RequireAuth>
  )
}
