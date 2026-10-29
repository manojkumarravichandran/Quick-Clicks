import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { QueryData } from '@supabase/supabase-js'
import { supabase, errorMessage } from '../../lib/supabase'
import type { Enums, Tables } from '../../lib/database.types'
import { KIND_LABEL, PAYMENT_LABEL, STATUS_LABEL, TIER_LABEL, formatDateTime, inr } from '../../lib/format'
import { Badge, Button, Card, EmptyState, ErrorText, Field, Page, PageLoader, Select, Textarea } from '../../components/ui'
import { MapView, type MapPin } from '../../components/MapView'
import { StatusBadge, parsePoint, timeAgo, waNumber, type BookingStatus } from './shared'

const detailQuery = (id: string) =>
  supabase
    .from('bookings')
    .select('*, packages(*), profiles!bookings_customer_id_fkey(full_name, phone), crew_members(display_name, kind, tier, rating, is_online)')
    .eq('id', id)
    .maybeSingle()

type Detail = NonNullable<QueryData<ReturnType<typeof detailQuery>>>
type CrewOption = Pick<Tables<'crew_members'>, 'id' | 'display_name' | 'kind' | 'tier' | 'is_online' | 'rating'>
type CustomerInfo = { full_name: string | null; phone: string | null; lat: number | null; lng: number | null }
type CrewLoc = { lat: number; lng: number; updated_at: string | null; display_name: string | null }

const ASSIGNABLE: BookingStatus[] = ['requested', 'declined']
const CANCELLABLE: BookingStatus[] = ['requested', 'accepted', 'en_route']
const TRACKABLE: BookingStatus[] = ['accepted', 'en_route', 'arrived']
const PAYMENTS: Enums<'payment_status'>[] = ['unpaid', 'advance_paid', 'paid', 'refunded']

export default function BookingDetailPage() {
  const { id = '' } = useParams()
  const [b, setB] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<Tables<'booking_events'>[]>([])
  const [customer, setCustomer] = useState<CustomerInfo | null>(null)
  const [crewList, setCrewList] = useState<CrewOption[]>([])
  const [crewLoc, setCrewLoc] = useState<CrewLoc | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    const [{ data, error }, ev] = await Promise.all([
      detailQuery(id),
      supabase.from('booking_events').select('*').eq('booking_id', id).order('created_at', { ascending: true }),
    ])
    if (error) setError(errorMessage(error))
    else setError(null)
    setB(data ?? null)
    setEvents(ev.data ?? [])
    setLoading(false)
    if (data && data.status !== 'declined' && data.status !== 'cancelled') {
      const { data: ci } = await supabase.rpc('booking_customer_info', { p_booking_id: id })
      setCustomer(ci?.[0] ?? null)
    } else setCustomer(null)
  }, [id])

  useEffect(() => {
    load()
    supabase
      .from('crew_members')
      .select('id, display_name, kind, tier, is_online, rating')
      .eq('approved', true)
      .order('is_online', { ascending: false })
      .order('display_name')
      .then(({ data }) => setCrewList(data ?? []))
    const channel = supabase
      .channel(`admin-booking-${id}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `id=eq.${id}` }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [id, load])

  const tracking = !!b && TRACKABLE.includes(b.status)
  useEffect(() => {
    if (!tracking) {
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
  }, [tracking, id])

  const pins = useMemo(() => {
    const out: MapPin[] = []
    const target = customer?.lat != null && customer?.lng != null ? { lat: customer.lat, lng: customer.lng } : parsePoint(b?.location)
    if (target) out.push({ id: 'target', kind: 'target', lat: target.lat, lng: target.lng, label: 'Shoot location' })
    if (crewLoc && crewLoc.lat != null && crewLoc.lng != null)
      out.push({ id: 'crew', kind: 'crew', lat: crewLoc.lat, lng: crewLoc.lng, label: crewLoc.display_name ?? 'Crew' })
    return out
  }, [customer, crewLoc, b?.location])

  if (loading) return <PageLoader />
  if (!b)
    return (
      <Page title="Booking">
        <ErrorText>{error}</ErrorText>
        <EmptyState title="Booking not found">
          <Link to="/admin" className="text-accent">
            Back to bookings
          </Link>
        </EmptyState>
      </Page>
    )

  const phone = customer?.phone || b.contact_phone || b.profiles?.phone || null
  const name = customer?.full_name || b.profiles?.full_name || 'Unnamed customer'

  return (
    <Page
      title={b.packages?.name ?? 'Booking'}
      action={
        <Link to="/admin" className="text-sm text-muted">
          ← All
        </Link>
      }
    >
      <ErrorText>{error}</ErrorText>

      <Card className="mb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <StatusBadge status={b.status} />
            <p className="mt-2 text-2xl font-bold">{inr(b.price_inr ?? 0)}</p>
            <p className="text-sm text-muted">
              {b.mode === 'instant' ? 'Instant' : 'Scheduled'} · {b.packages?.category ?? ''}
              {b.packages?.duration_hours != null ? ` · ${b.packages.duration_hours} h` : ''}
            </p>
          </div>
          <Badge tone={b.payment_status === 'paid' ? 'ok' : b.payment_status === 'refunded' ? 'bad' : 'neutral'}>
            {PAYMENT_LABEL[b.payment_status]}
          </Badge>
        </div>
        <dl className="mt-3 space-y-1.5 text-sm">
          <Row k="When">{b.scheduled_at ? formatDateTime(b.scheduled_at) : `ASAP (booked ${formatDateTime(b.created_at)})`}</Row>
          <Row k="Address">{b.address}</Row>
          {b.distance_km != null && <Row k="Distance">{b.distance_km} km{b.eta_minutes != null ? ` · ETA ${b.eta_minutes} min` : ''}</Row>}
          {b.notes && <Row k="Notes">{b.notes}</Row>}
          {b.cancel_reason && <Row k="Reason">{b.cancel_reason}</Row>}
          {b.deliverables_url && (
            <Row k="Delivery">
              <a href={b.deliverables_url} target="_blank" rel="noreferrer" className="break-all text-accent">
                {b.deliverables_url}
              </a>
            </Row>
          )}
          <Row k="ID">
            <span className="break-all font-mono text-xs">{b.id}</span>
          </Row>
        </dl>
      </Card>

      <Card className="mb-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Customer</h2>
        <p className="font-semibold">{name}</p>
        <p className="text-sm text-muted">{phone ?? 'No phone on file'}</p>
        {phone && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="rounded-xl border border-line py-2.5 text-center text-sm font-semibold">
              📞 Call
            </a>
            <a
              href={`https://wa.me/${waNumber(phone)}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-ok/40 bg-ok/10 py-2.5 text-center text-sm font-semibold text-ok"
            >
              WhatsApp
            </a>
          </div>
        )}
      </Card>

      <CrewSection booking={b} crewList={crewList} onDone={load} />

      {tracking && (
        <Card className="mb-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Live location</h2>
          {pins.length > 0 ? <MapView pins={pins} height={240} /> : <p className="text-sm text-muted">No location yet.</p>}
          <p className="mt-2 text-xs text-muted">
            {crewLoc ? `Crew updated ${timeAgo(crewLoc.updated_at)}` : 'Crew has not shared a location yet'} · refreshes every 15 s
          </p>
        </Card>
      )}

      <PaymentSection booking={b} onDone={load} />
      {CANCELLABLE.includes(b.status) && <CancelSection bookingId={b.id} onDone={load} />}

      <Card className="mb-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Timeline</h2>
        {events.length === 0 && <p className="text-sm text-muted">No events.</p>}
        <ol className="space-y-2">
          {events.map((e) => (
            <li key={e.id} className="flex gap-3 text-sm">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
              <div>
                <p className="font-medium">{STATUS_LABEL[e.status] ?? e.status}</p>
                <p className="text-xs text-muted">
                  {formatDateTime(e.created_at)}
                  {e.note ? ` · ${e.note}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </Page>
  )
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-muted">{k}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  )
}

function CrewSection({ booking, crewList, onDone }: { booking: Detail; crewList: CrewOption[]; onDone: () => void }) {
  const [crewId, setCrewId] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const canAssign = ASSIGNABLE.includes(booking.status)
  const c = booking.crew_members

  const assign = async () => {
    if (!crewId) return
    setBusy(true)
    setErr(null)
    const { error } = await supabase.rpc('admin_assign_crew', { p_booking_id: booking.id, p_crew_id: crewId })
    setBusy(false)
    if (error) setErr(errorMessage(error))
    else {
      setCrewId('')
      onDone()
    }
  }

  return (
    <Card className="mb-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Crew</h2>
      {c ? (
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold">{c.display_name}</p>
            <p className="text-sm text-muted">
              {KIND_LABEL[c.kind]} · {TIER_LABEL[c.tier]} · ★ {Number(c.rating ?? 0).toFixed(1)}
            </p>
          </div>
          <Badge tone={c.is_online ? 'ok' : 'neutral'}>{c.is_online ? 'Online' : 'Offline'}</Badge>
        </div>
      ) : (
        <p className="text-sm text-muted">No crew assigned.</p>
      )}
      {canAssign ? (
        <div className="mt-3">
          <Field label={c ? 'Reassign to' : 'Assign to'}>
            <Select value={crewId} onChange={(e) => setCrewId(e.target.value)}>
              <option value="">Choose approved crew…</option>
              {crewList.map((o) => (
                <option key={o.id} value={o.id} disabled={o.id === booking.crew_id}>
                  {o.is_online ? '🟢' : '⚪'} {o.display_name} — {KIND_LABEL[o.kind]}, {TIER_LABEL[o.tier]}
                  {o.id === booking.crew_id ? ' (current)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          {crewList.length === 0 && <p className="mb-2 text-xs text-muted">No approved crew yet.</p>}
          <ErrorText>{err}</ErrorText>
          <Button block onClick={assign} loading={busy} disabled={!crewId}>
            {c ? 'Reassign crew' : 'Assign crew'}
          </Button>
          <p className="mt-2 text-xs text-muted">The crew member gets a new request and must accept it.</p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">Crew can only be (re)assigned while the booking is waiting or declined.</p>
      )}
    </Card>
  )
}

function PaymentSection({ booking, onDone }: { booking: Detail; onDone: () => void }) {
  const [value, setValue] = useState<Enums<'payment_status'>>(booking.payment_status)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => setValue(booking.payment_status), [booking.payment_status])

  const save = async () => {
    setBusy(true)
    setErr(null)
    const { error } = await supabase.from('bookings').update({ payment_status: value }).eq('id', booking.id)
    setBusy(false)
    if (error) setErr(errorMessage(error))
    else onDone()
  }

  return (
    <Card className="mb-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Payment</h2>
      <div className="flex gap-2">
        <Select value={value} onChange={(e) => setValue(e.target.value as Enums<'payment_status'>)} className="flex-1">
          {PAYMENTS.map((p) => (
            <option key={p} value={p}>
              {PAYMENT_LABEL[p]}
            </option>
          ))}
        </Select>
        <Button onClick={save} loading={busy} disabled={value === booking.payment_status}>
          Save
        </Button>
      </div>
      <ErrorText>{err}</ErrorText>
    </Card>
  )
}

function CancelSection({ bookingId, onDone }: { bookingId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const cancel = async () => {
    if (!window.confirm('Cancel this booking? The customer and crew will see it as cancelled.')) return
    setBusy(true)
    setErr(null)
    const { error } = await supabase.rpc('cancel_booking', { p_booking_id: bookingId, p_reason: reason.trim() || 'Cancelled by Quick Clicks' })
    setBusy(false)
    if (error) setErr(errorMessage(error))
    else {
      setOpen(false)
      onDone()
    }
  }

  if (!open)
    return (
      <Button variant="danger" block className="mb-3" onClick={() => setOpen(true)}>
        Cancel booking
      </Button>
    )
  return (
    <Card className="mb-3 border-bad/40">
      <Field label="Reason for cancelling">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. No crew available at that time" />
      </Field>
      <ErrorText>{err}</ErrorText>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => setOpen(false)}>
          Keep
        </Button>
        <Button variant="danger" onClick={cancel} loading={busy}>
          Cancel booking
        </Button>
      </div>
    </Card>
  )
}
