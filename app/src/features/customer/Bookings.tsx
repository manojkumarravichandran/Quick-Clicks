import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { ACTIVE_STATUSES, formatDateTime, inr } from '../../lib/format'
import { EmptyState, ErrorText, Page, PageLoader } from '../../components/ui'
import { friendlyError, StatusBadge, type BookingWithPkg } from './shared'

export default function Bookings() {
  const [rows, setRows] = useState<BookingWithPkg[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('bookings')
      .select('*, packages(name)')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(friendlyError(error))
        setRows((data as BookingWithPkg[] | null) ?? [])
      })
  }, [])

  if (!rows) return <PageLoader />
  const active = rows.filter((b) => ACTIVE_STATUSES.includes(b.status))
  const past = rows.filter((b) => !ACTIVE_STATUSES.includes(b.status))

  return (
    <Page title="My shoots">
      <ErrorText>{error}</ErrorText>
      {rows.length === 0 ? (
        <EmptyState title="No bookings yet">
          <p>
            <Link to="/instant" className="text-accent">
              Book an instant shoot
            </Link>{' '}
            or{' '}
            <Link to="/book" className="text-accent">
              schedule one
            </Link>
            .
          </p>
        </EmptyState>
      ) : (
        <>
          <Section title="Active" rows={active} empty="Nothing in progress." />
          <Section title="Past" rows={past} empty="No past bookings." />
        </>
      )}
    </Page>
  )
}

function Section({ title, rows, empty }: { title: string; rows: BookingWithPkg[]; empty: string }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <div className="grid gap-2">
          {rows.map((b) => (
            <Link
              key={b.id}
              to={`/bookings/${b.id}`}
              className="block rounded-xl border border-line bg-panel px-4 py-3 hover:border-accent"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{b.packages?.name ?? 'Shoot'}</span>
                <StatusBadge status={b.status} />
              </div>
              <div className="mt-1 flex justify-between text-xs text-muted">
                <span>
                  {b.mode === 'instant' ? '⚡ Instant' : '📅 Scheduled'} ·{' '}
                  {formatDateTime(b.scheduled_at ?? b.created_at)}
                </span>
                <span className="font-semibold text-text">{inr(b.price_inr)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
