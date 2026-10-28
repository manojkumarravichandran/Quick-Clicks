import { NavLink, Outlet, Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../lib/auth'
import { PageLoader } from './ui'
import type { Enums } from '../lib/database.types'

type Tab = { to: string; label: string; icon: string; end?: boolean }

function tabsFor(role: Enums<'user_role'> | undefined): Tab[] {
  const customer: Tab[] = [
    { to: '/', label: 'Home', icon: '🏠', end: true },
    { to: '/instant', label: 'Instant', icon: '⚡' },
    { to: '/book', label: 'Book', icon: '📅' },
    { to: '/bookings', label: 'My shoots', icon: '🎞' },
  ]
  if (role === 'crew') return [...customer.slice(0, 1), { to: '/crew', label: 'Crew', icon: '🎥' }, ...customer.slice(1)]
  if (role === 'admin')
    return [...customer, { to: '/crew', label: 'Crew', icon: '🎥' }, { to: '/admin', label: 'Admin', icon: '🛠' }]
  return customer
}

export function Layout() {
  const { profile } = useAuth()
  const tabs = tabsFor(profile?.role)
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-ink">
      <main className="flex-1 pb-[calc(76px+env(safe-area-inset-bottom))]">
        <Outlet />
      </main>
      <nav className="fixed bottom-0 left-1/2 z-50 flex w-full max-w-md -translate-x-1/2 border-t border-line bg-ink/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium uppercase tracking-wide ${
                isActive ? 'text-accent' : 'text-muted'
              }`
            }
          >
            <span className="text-lg leading-none">{t.icon}</span>
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

/** Gate a route on sign-in (and optionally a role). Sends guests to /signin?next=… */
export function RequireAuth({ role, children }: { role?: Enums<'user_role'>[]; children: ReactNode }) {
  const { session, profile, loading, profileReady } = useAuth()
  const location = useLocation()
  if (loading || !profileReady) return <PageLoader />
  if (!session) return <Navigate to={`/signin?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (role && !(profile && role.includes(profile.role))) return <Navigate to="/" replace />
  return <>{children}</>
}
