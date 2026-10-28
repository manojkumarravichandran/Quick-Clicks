import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Enums, RpcReturn, Tables } from '../../lib/database.types'
import {
  formatDateTime,
  inr,
  KIND_LABEL,
  PAYMENT_LABEL,
  STATUS_LABEL,
  STATUS_STEPS,
  TIER_LABEL,
} from '../../lib/format'
import { Badge, Button, Card, EmptyState, ErrorText, Page, PageLoader } from '../../components/ui'
import { MapView, type MapPin } from '../../components/MapView'
import { BackLink, Callout, friendlyError, loadJobPosition, StatusBadge, type BookingWithPkg } from './shared'

type CrewInfo = RpcReturn<'booking_crew_info'>[number]
type CrewLoc = RpcReturn<'booking_crew_location'>[number]
type Event = Tables<'booking_events'>
type Status = Enums<'booking_status'>

const TRACKABLE: Status[] = ['accepted', 'en_route', 'arrived']
const CANCELLABLE: Status[] = ['requested', 'accepted', 'en_route']
const WAIT_HINT_MS = 3 * 60 * 1000

function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
// Same formula as the server's estimate_eta_minutes: 20 km/h + 5 min.
const etaFor = (km: number) => Math.ceil((km / 20) * 60) + 5

function formatElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function Tracking() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [booking, setBooking] = useState<BookingWithPkg | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [crew, setCrew] = useState<CrewInfo | null>(null)
  const [crewLoc, setCrewLoc] = useState<CrewLoc | null>(null)
  const [events, setEvents] = useState<Event[]>([])
  const [now, setNow] = useState(() => Date.now())
  const [cancelling, setCancelling] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const jobPos = loadJobPosition(id)

  const loadBooking = useCallback(async () => {
    const { data, error } = await supabase.from('bookings').select('*, packages(name)').eq('id', id).maybeSingle()
    if (error) setLoadError(friendlyError(error))
    else if (!data) setNotFound(true)
    else setBooking(data as BookingWithPkg)
  }, [id])

  const loadEvents = useCallback(async () => {
    const { data } = await supabase.from('booking_events').select('*').eq('booking_id', id).order('created_at')
    setEvents(data ?? [])
  }, [id])

  const loadCrew = useCallback(async () => {
    const { data } = await supabase.rpc('booking_crew_info', { p_booking_id: id })
    setCrew(data?.[0] ?? null)
  }, [id])

  useEffect(() => {
    loadBooking()
    loadEvents()
  }, [loadBooking, loadEvents])

  // Realtime status updates.
  useEffect(() => {
    const channel = supabase
      .channel('booking-' + id)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings', filter: 'id=eq.' + id }, (payload) => {
        setBooking((prev) => (prev ? { ...prev, ...(payload.new as Tables<'bookings'>) } : prev))
        loadEvents()
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [id, loadEvents])

  const status = booking?.status
  const crewId = booking?.crew_id

  // Crew info whenever the assigned crew changes.
  useEffect(() => {
    if (crewId) loadCrew()
    else setCrew(null)
  }, [crewId, loadCrew])

  // Live crew location while they're on the way.
  useEffect(() => {
    if (!status || !TRACKABLE.includes(status)) {
      setCrewLoc(null)
      return
    }
    let alive = true
    const poll = async () => {
      const { data } = await supabase.rpc('booking_crew_location', { p_booking_id: id })
      if (alive) setCrewLoc(data?.[0] ?? null)
    }
    poll()
    const t = setInterval(poll, 15000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [id, status])

  // Ticking clock while waiting for a response.
  useEffect(() => {
    if (status !== 'requested') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [status])

  async function cancel() {
    if (!booking) return
    if (!confirm('Cancel this booking?')) return
    setCancelling(true)
    setActionError(null)
    const { data, error } = await supabase.rpc('cancel_booking', {
      p_booking_id: booking.id,
      p_reason: 'Cancelled by customer',
    })
    setCancelling(false)
    if (error || !data) return setActionError(friendlyError(error))
    setBooking((prev) => (prev ? { ...prev, ...data } : prev))
    loadEvents()
  }

  if (notFound)
    return (
      <Page title="Booking">
        <EmptyState title="Booking not found">
          <Link to="/bookings" className="text-accent">
            Back to my shoots
          </Link>
        </EmptyState>
      </Page>
    )
  if (!booking) return loadError ? <Page title="Booking"><ErrorText>{loadError}</ErrorText></Page> : <PageLoader />

  const s = booking.status
  const crewName = crew?.display_name ?? 'the crew'
  const isInstant = booking.mode === 'instant'
  const lastRequested = [...events].reverse().find((e) => e.status === 'requested')
  const waitingSince = new Date(lastRequested?.created_at ?? booking.created_at).getTime()
  const waitedMs = now - waitingSince

  const liveEta =
    crewLoc && jobPos ? etaFor(kmBetween(crewLoc, jobPos)) : s === 'accepted' || s === 'en_route' ? booking.eta_minutes : null

  const pins: MapPin[] = [
    ...(jobPos ? [{ id: 'job', lat: jobPos.lat, lng: jobPos.lng, kind: 'target' as const, label: 'Shoot location' }] : []),
    ...(crewLoc ? [{ id: 'crew', lat: crewLoc.lat, lng: crewLoc.lng, kind: 'crew' as const, label: crewLoc.display_name }] : []),
  ]

  return (
    <Page title={booking.packages?.name ?? 'Booking'} action={<StatusBadge status={s} />}>
      <div className="mb-3">
        <BackLink to="/bookings">My shoots</BackLink>
      </div>

      {/* Headline state */}
      {s === 'declined' ? (
        <Callout tone="bad">
          <p className="font-semibold">{crew ? `${crew.display_name} couldn't take this one` : 'The crew declined'}</p>
          <p className="mt-1 text-sm text-muted">
            {isInstant
              ? "You haven't been charged. Pick someone else who's available nearby."
              : "We'll try to assign someone else and let you know."}
          </p>
          {isInstant && (
            <Button block className="mt-3" onClick={() => navigate('/instant')}>
              Find another crew
            </Button>
          )}
        </Callout>
      ) : s === 'cancelled' ? (
        <Callout tone="bad">
          <p className="font-semibold">This booking was cancelled</p>
          {booking.cancel_reason && <p className="mt-1 text-sm text-muted">{booking.cancel_reason}</p>}
        </Callout>
      ) : s === 'requested' ? (
        <Callout tone="accent">
          {booking.crew_id ? (
            <>
              <p className="font-semibold">Waiting for {crewName} to accept…</p>
              <p className="mt-1 text-sm text-muted">Waiting {formatElapsed(waitedMs)}</p>
              {isInstant && waitedMs > WAIT_HINT_MS && (
                <p className="mt-2 text-sm">
                  No answer yet. You can cancel and pick someone else who's available.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="font-semibold">Booking received</p>
              <p className="mt-1 text-sm text-muted">
                We'll assign a crew member and confirm with you. Our team will contact you for the 50% advance.
              </p>
            </>
          )}
        </Callout>
      ) : s === 'delivered' ? (
        <Callout tone="ok">
          <p className="font-semibold">Your shoot is ready 🎉</p>
          {booking.deliverables_url ? (
            <a
              href={booking.deliverables_url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 flex w-full items-center justify-center rounded-xl bg-ok px-4 py-4 text-base font-bold text-black"
            >
              Open your photos & videos ↗
            </a>
          ) : (
            <p className="mt-1 text-sm text-muted">The download link will appear here.</p>
          )}
        </Callout>
      ) : (
        <Callout tone="accent">
          <p className="font-semibold">{STATUS_LABEL[s]}</p>
          {liveEta != null && (s === 'accepted' || s === 'en_route') && (
            <p className="mt-1 text-sm text-muted">
              About <span className="font-bold text-accent">{liveEta} min</span> away (estimate)
            </p>
          )}
        </Callout>
      )}

      {/* Stepper */}
      {s !== 'declined' && s !== 'cancelled' && <Stepper status={s} />}

      {/* Map */}
      {TRACKABLE.includes(s) && (
        <div className="mb-4">
          {pins.length > 0 ? (
            <MapView pins={pins} height={240} />
          ) : (
            <p className="text-sm text-muted">Waiting for the crew's live location…</p>
          )}
          {crewLoc && (
            <p className="mt-1 text-xs text-muted">Crew location updated {formatDateTime(crewLoc.updated_at)}</p>
          )}
        </div>
      )}

      {/* Crew */}
      {crew && (
        <Card className="mb-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Your crew</p>
          <div className="mt-1 flex items-center justify-between">
            <span className="font-semibold">{crew.display_name}</span>
            <span className="text-sm">★ {Number(crew.rating).toFixed(1)}</span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted">
            {KIND_LABEL[crew.kind]} <Badge tone="accent">{TIER_LABEL[crew.tier]}</Badge>
          </div>
        </Card>
      )}

      {/* Details */}
      <Card className="mb-4 text-sm">
        <Row label="Type">{isInstant ? '⚡ Instant' : '📅 Scheduled'}</Row>
        {booking.scheduled_at && <Row label="When">{formatDateTime(booking.scheduled_at)}</Row>}
        <Row label="Address">{booking.address}</Row>
        {booking.contact_phone && <Row label="Phone">{booking.contact_phone}</Row>}
        <Row label="Price">{inr(booking.price_inr)}</Row>
        <Row label="Payment">{PAYMENT_LABEL[booking.payment_status]}</Row>
        {booking.notes && <Row label="Notes">{booking.notes}</Row>}
      </Card>

      <ErrorText>{actionError}</ErrorText>
      {CANCELLABLE.includes(s) && (
        <Button variant="danger" block onClick={cancel} loading={cancelling} className="mb-6">
          Cancel booking
        </Button>
      )}

      {/* Timeline */}
      {events.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Timeline</h2>
          <ol className="border-l border-line pl-4">
            {events.map((e) => (
              <li key={e.id} className="relative mb-3">
                <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-accent" />
                <p className="text-sm font-semibold">{STATUS_LABEL[e.status]}</p>
                <p className="text-xs text-muted">
                  {formatDateTime(e.created_at)}
                  {e.note ? ` · ${e.note}` : ''}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </Page>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-line/60 py-2 last:border-0">
      <span className="w-20 shrink-0 text-muted">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  )
}

function Stepper({ status }: { status: Status }) {
  const current = STATUS_STEPS.indexOf(status)
  return (
    <div className="mb-4 flex gap-1" aria-label={`Progress: ${STATUS_LABEL[status]}`}>
      {STATUS_STEPS.map((st, i) => (
        <div key={st} className="flex-1">
          <div className={`h-1.5 rounded-full ${i <= current ? 'bg-accent' : 'bg-line'}`} />
          <p className={`mt-1 truncate text-[9px] uppercase ${i === current ? 'text-accent' : 'text-muted'}`}>
            {STEP_SHORT[st]}
          </p>
        </div>
      ))}
    </div>
  )
}

const STEP_SHORT: Partial<Record<Status, string>> = {
  requested: 'Request',
  accepted: 'Confirmed',
  en_route: 'On way',
  arrived: 'Arrived',
  shooting: 'Shoot',
  editing: 'Edit',
  delivered: 'Done',
}
