import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, errorMessage } from '../../lib/supabase'
import { KIND_LABEL, TIER_LABEL, formatDateTime, inr } from '../../lib/format'
import { Badge, Button, Card, EmptyState, ErrorText, Page, PageLoader } from '../../components/ui'
import { useCrew, type CrewBooking } from './CrewContext'
import { CREW_STATUS_LABEL, timeAgo, timeHM, useNow } from './util'

const IN_PROGRESS = ['accepted', 'en_route', 'arrived', 'shooting', 'editing'] as const

export default function CrewDashboard() {
  const navigate = useNavigate()
  const { crew, crewLoading, crewError } = useCrew()

  if (crewLoading) return <PageLoader />

  if (!crew) {
    return (
      <Page title="Crew">
        <ErrorText>{crewError}</ErrorText>
        <EmptyState title="You're not on the crew yet">
          <p>Photographers and videographers in Bengaluru can apply to take shoots.</p>
          <Button className="mt-4" onClick={() => navigate('/crew/join')}>
            Apply as crew
          </Button>
        </EmptyState>
      </Page>
    )
  }

  if (!crew.approved) {
    return (
      <Page title="Crew">
        <EmptyState title="Application pending">
          <p>An admin will review your application. You can go online once you're approved.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/crew/join')}>
            View or edit application
          </Button>
        </EmptyState>
      </Page>
    )
  }

  return <ApprovedDashboard />
}

function ApprovedDashboard() {
  const navigate = useNavigate()
  const { crew, bookings, bookingsLoading, bookingsError } = useCrew()
  const now = useNow()
  if (!crew) return null

  const requests = bookings.filter((b) => b.status === 'requested')
  const inProgress = bookings.filter((b) => (IN_PROGRESS as readonly string[]).includes(b.status))
  const isUpcoming = (b: CrewBooking) =>
    b.status === 'accepted' && b.mode === 'scheduled' && !!b.scheduled_at && new Date(b.scheduled_at).getTime() > now + 60 * 60_000
  const upcoming = inProgress
    .filter(isUpcoming)
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime())
  const active = inProgress.filter((b) => !isUpcoming(b))

  const delivered = bookings.filter((b) => b.status === 'delivered')
  const today = new Date(now).toDateString()
  const deliveredToday = delivered.filter((b) => new Date(b.updated_at).toDateString() === today)
  const sum = (list: CrewBooking[]) => list.reduce((s, b) => s + b.price_inr, 0)
  const history = bookings.filter((b) => ['delivered', 'cancelled', 'declined'].includes(b.status)).slice(0, 15)

  return (
    <Page
      title="Crew"
      action={
        <button className="text-xs text-muted hover:text-text" onClick={() => navigate('/crew/join')}>
          Profile
        </button>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">{crew.display_name}</span>
        <Badge>{KIND_LABEL[crew.kind]}</Badge>
        <Badge tone="accent">{TIER_LABEL[crew.tier]}</Badge>
        <span className="text-muted">★ {Number(crew.rating).toFixed(1)}</span>
      </div>

      <OnlineCard />

      <ErrorText>{bookingsError}</ErrorText>

      <Section title="Incoming requests" count={requests.length}>
        {bookingsLoading ? (
          <PageLoader />
        ) : requests.length === 0 ? (
          <EmptyState title="No requests right now">
            {crew.is_online ? 'Keep this screen open — new requests buzz here.' : 'Go online to receive instant requests.'}
          </EmptyState>
        ) : (
          requests.map((b) => <RequestCard key={b.id} b={b} now={now} />)
        )}
      </Section>

      {active.length > 0 && (
        <Section title="Active jobs" count={active.length}>
          {active.map((b) => (
            <JobRow key={b.id} b={b} onOpen={() => navigate(`/crew/jobs/${b.id}`)} />
          ))}
        </Section>
      )}

      {upcoming.length > 0 && (
        <Section title="Upcoming" count={upcoming.length}>
          {upcoming.map((b) => (
            <JobRow key={b.id} b={b} onOpen={() => navigate(`/crew/jobs/${b.id}`)} />
          ))}
        </Section>
      )}

      <Section title="Completed">
        <div className="mb-3 grid grid-cols-2 gap-3">
          <Card>
            <p className="text-xs uppercase tracking-wide text-muted">Today</p>
            <p className="mt-1 text-xl font-bold">{inr(sum(deliveredToday))}</p>
            <p className="text-xs text-muted">
              {deliveredToday.length} job{deliveredToday.length === 1 ? '' : 's'} · job value
            </p>
          </Card>
          <Card>
            <p className="text-xs uppercase tracking-wide text-muted">All delivered</p>
            <p className="mt-1 text-xl font-bold">{inr(sum(delivered))}</p>
            <p className="text-xs text-muted">
              {delivered.length} job{delivered.length === 1 ? '' : 's'} · job value
            </p>
          </Card>
        </div>
        <p className="mb-3 text-xs text-muted">Job value is what the customer was quoted, not your take-home pay.</p>
        {history.length === 0 ? (
          <p className="text-sm text-muted">No finished jobs yet.</p>
        ) : (
          history.map((b) => <JobRow key={b.id} b={b} onOpen={() => navigate(`/crew/jobs/${b.id}`)} />)
        )}
      </Section>
    </Page>
  )
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
        {title}
        {!!count && <span className="rounded-full bg-accent px-2 text-xs text-black">{count}</span>}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function OnlineCard() {
  const { crew, setOnline, togglingOnline, tracking, lastSentAt, locationError, wakeLockActive, wakeLockSupported } = useCrew()
  const online = !!crew?.is_online
  return (
    <Card className={online ? 'border-ok/40' : undefined}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className={`text-lg font-bold ${online ? 'text-ok' : 'text-muted'}`}>{online ? '● Online' : '○ Offline'}</p>
          <p className="text-xs text-muted">{online ? 'Customers nearby can request you.' : 'You are hidden from customers.'}</p>
        </div>
        <Button
          variant={online ? 'outline' : 'primary'}
          loading={togglingOnline}
          onClick={() => setOnline(!online)}
          className="min-w-28"
        >
          {online ? 'Go offline' : 'Go online'}
        </Button>
      </div>
      {tracking && (
        <div className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-muted">
          <p>
            Sharing location{lastSentAt ? ` · last sent ${timeHM(lastSentAt)}` : ' · waiting for GPS…'}
            {!online && ' (active job)'}
          </p>
          <p>
            Keep this screen open — browsers pause location in the background.
            {wakeLockSupported && (wakeLockActive ? ' Screen will stay on.' : ' Could not keep the screen on.')}
          </p>
        </div>
      )}
      <ErrorText>{locationError}</ErrorText>
    </Card>
  )
}

function RequestCard({ b, now }: { b: CrewBooking; now: number }) {
  const { reloadBookings } = useCrew()
  const navigate = useNavigate()
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function respond(accept: boolean) {
    if (!accept && !window.confirm('Decline this request?')) return
    setBusy(accept ? 'accept' : 'decline')
    setError(null)
    const { error } = await supabase.rpc('crew_respond', { p_booking_id: b.id, p_accept: accept })
    setBusy(null)
    if (error) {
      setError(errorMessage(error))
      reloadBookings()
      return
    }
    await reloadBookings()
    if (accept) navigate(`/crew/jobs/${b.id}`)
  }

  return (
    <Card className="border-accent/50">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{b.packages?.name ?? 'Shoot'}</p>
          <p className="text-xs text-muted">
            {b.mode === 'instant' ? 'Instant' : 'Scheduled'}
            {b.packages?.duration_hours ? ` · ${b.packages.duration_hours} h` : ''} · {timeAgo(b.created_at, now)}
          </p>
        </div>
        <p className="text-lg font-bold text-accent">{inr(b.price_inr)}</p>
      </div>
      {b.mode === 'scheduled' && b.scheduled_at && (
        <p className="mt-2 text-sm">
          <span className="text-muted">When:</span> {formatDateTime(b.scheduled_at)}
        </p>
      )}
      <p className="mt-2 text-sm">{b.address}</p>
      {(b.distance_km != null || b.eta_minutes != null) && (
        <p className="mt-1 text-xs text-muted">
          {b.distance_km != null && `${Number(b.distance_km).toFixed(1)} km away`}
          {b.distance_km != null && b.eta_minutes != null && ' · '}
          {b.eta_minutes != null && `~${b.eta_minutes} min drive`}
        </p>
      )}
      {b.notes && <p className="mt-2 rounded-lg bg-panel-2 px-3 py-2 text-sm text-muted">“{b.notes}”</p>}
      <ErrorText>{error}</ErrorText>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="outline" loading={busy === 'decline'} disabled={!!busy} onClick={() => respond(false)}>
          Decline
        </Button>
        <Button loading={busy === 'accept'} disabled={!!busy} onClick={() => respond(true)}>
          Accept
        </Button>
      </div>
    </Card>
  )
}

function JobRow({ b, onOpen }: { b: CrewBooking; onOpen: () => void }) {
  const tone = b.status === 'delivered' ? 'ok' : b.status === 'cancelled' || b.status === 'declined' ? 'bad' : 'accent'
  return (
    <Card onClick={onOpen}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{b.packages?.name ?? 'Shoot'}</p>
          <p className="truncate text-xs text-muted">{b.address}</p>
          <p className="mt-1 text-xs text-muted">
            {b.mode === 'scheduled' && b.scheduled_at ? formatDateTime(b.scheduled_at) : `Instant · ${formatDateTime(b.created_at)}`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <Badge tone={tone}>{CREW_STATUS_LABEL[b.status]}</Badge>
          <p className="mt-1 text-sm font-semibold">{inr(b.price_inr)}</p>
        </div>
      </div>
    </Card>
  )
}
