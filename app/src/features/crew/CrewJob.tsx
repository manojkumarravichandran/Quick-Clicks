import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase, errorMessage } from '../../lib/supabase'
import { formatDateTime, inr, PAYMENT_LABEL } from '../../lib/format'
import type { Enums } from '../../lib/database.types'
import { Badge, Button, Card, EmptyState, ErrorText, Field, Input, Page, PageLoader, Textarea } from '../../components/ui'
import { MapView, type MapPin } from '../../components/MapView'
import { useCrew, type CrewBooking } from './CrewContext'
import { CREW_STATUS_LABEL, mapsDirectionsUrl, timeHM, whatsappDigits } from './util'

type CustomerInfo = { full_name: string | null; phone: string | null; lat: number | null; lng: number | null }

const NEXT_STEP: Partial<Record<Enums<'booking_status'>, string>> = {
  accepted: 'Start driving',
  en_route: "I've arrived",
  arrived: 'Start shoot',
  shooting: 'Shoot done — editing',
  editing: 'Mark delivered',
}

const CANCELLABLE: Enums<'booking_status'>[] = ['requested', 'accepted', 'en_route']

export default function CrewJob() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { myPos, reloadBookings, tracking, lastSentAt } = useCrew()

  const [booking, setBooking] = useState<CrewBooking | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [customer, setCustomer] = useState<CustomerInfo | null>(null)

  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [deliverUrl, setDeliverUrl] = useState('')
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    const { data, error } = await supabase.from('bookings').select('*, packages(name, duration_hours)').eq('id', id).maybeSingle()
    if (error) setLoadError(errorMessage(error))
    else {
      setLoadError(null)
      setBooking((data as unknown as CrewBooking | null) ?? null)
    }
    setLoading(false)
  }, [id])

  useEffect(() => {
    load()
    if (!id) return
    const channel = supabase
      .channel(`crew-job-${id}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: 'id=eq.' + id }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [id, load])

  const status = booking?.status
  useEffect(() => {
    if (!id || !status || status === 'declined' || status === 'cancelled') {
      setCustomer(null)
      return
    }
    let stale = false
    supabase.rpc('booking_customer_info', { p_booking_id: id }).then(({ data }) => {
      if (!stale) setCustomer(((data ?? [])[0] as CustomerInfo | undefined) ?? null)
    })
    return () => {
      stale = true
    }
  }, [id, status])

  if (loading) return <PageLoader />

  if (!booking) {
    return (
      <Page title="Job">
        <ErrorText>{loadError}</ErrorText>
        <EmptyState title="Job not found">
          <p>It may have been reassigned, or you don't have access.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/crew')}>
            Back to dashboard
          </Button>
        </EmptyState>
      </Page>
    )
  }

  const b = booking
  const nextLabel = NEXT_STEP[b.status]
  const canCancel = CANCELLABLE.includes(b.status)
  const hasCoords = customer?.lat != null && customer?.lng != null

  const pins: MapPin[] = []
  if (hasCoords) pins.push({ id: 'job', lat: customer!.lat!, lng: customer!.lng!, kind: 'target', label: 'Shoot location' })
  if (myPos) pins.push({ id: 'me', lat: myPos.lat, lng: myPos.lng, kind: 'crew', label: 'You' })

  async function run(fn: () => PromiseLike<{ error: unknown }>, after?: () => void) {
    setBusy(true)
    setActionError(null)
    const { error } = await fn()
    setBusy(false)
    if (error) setActionError(errorMessage(error))
    else after?.()
    await load()
    reloadBookings()
  }

  const advance = () => {
    if (b.status === 'editing') {
      const url = deliverUrl.trim()
      if (!/^https?:\/\/\S+$/i.test(url)) return setActionError('Paste the full share link (starting with https://)')
      return run(() => supabase.rpc('crew_advance', { p_booking_id: b.id, p_deliverables_url: url }), () => setDeliverUrl(''))
    }
    return run(() => supabase.rpc('crew_advance', { p_booking_id: b.id }))
  }

  const respond = (accept: boolean) => {
    if (!accept && !window.confirm('Decline this request?')) return
    return run(() => supabase.rpc('crew_respond', { p_booking_id: b.id, p_accept: accept }))
  }

  const cancel = () => {
    if (!window.confirm('Cancel this job? The customer will be notified in the app.')) return
    return run(
      () => supabase.rpc('cancel_booking', { p_booking_id: b.id, p_reason: cancelReason.trim() || undefined }),
      () => setCancelOpen(false),
    )
  }

  const tone = b.status === 'delivered' ? 'ok' : b.status === 'cancelled' || b.status === 'declined' ? 'bad' : 'accent'

  return (
    <Page
      title={b.packages?.name ?? 'Job'}
      action={
        <button className="text-xs text-muted hover:text-text" onClick={() => navigate('/crew')}>
          ← Dashboard
        </button>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone={tone}>{CREW_STATUS_LABEL[b.status]}</Badge>
        <Badge>{b.mode === 'instant' ? 'Instant' : 'Scheduled'}</Badge>
        <span className="ml-auto text-lg font-bold">{inr(b.price_inr)}</span>
      </div>

      {b.status === 'cancelled' && (
        <Card className="mb-3 border-bad/40">
          <p className="font-semibold text-bad">This job was cancelled</p>
          {b.cancel_reason && <p className="mt-1 text-sm text-muted">Reason: {b.cancel_reason}</p>}
        </Card>
      )}

      {/* Primary action */}
      {b.status === 'requested' && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={busy} onClick={() => respond(false)}>
            Decline
          </Button>
          <Button loading={busy} onClick={() => respond(true)}>
            Accept
          </Button>
        </div>
      )}
      {nextLabel && (
        <div className="mb-3">
          {b.status === 'editing' && (
            <Field label="Deliverables link" hint="Google Drive or WeTransfer share link the customer can open">
              <Input
                type="url"
                inputMode="url"
                placeholder="https://drive.google.com/…"
                value={deliverUrl}
                onChange={(e) => setDeliverUrl(e.target.value)}
              />
            </Field>
          )}
          <Button block loading={busy} onClick={advance} className="py-4 text-base">
            {nextLabel}
          </Button>
        </div>
      )}
      <ErrorText>{actionError}</ErrorText>

      {b.deliverables_url && (
        <Card className="mb-3">
          <p className="text-xs uppercase tracking-wide text-muted">Delivered files</p>
          <a href={b.deliverables_url} target="_blank" rel="noreferrer" className="mt-1 block break-all text-sm text-accent">
            {b.deliverables_url}
          </a>
        </Card>
      )}

      {/* Customer */}
      {customer && (
        <Card className="mb-3">
          <p className="text-xs uppercase tracking-wide text-muted">Customer</p>
          <p className="mt-1 font-semibold">{customer.full_name || 'Customer'}</p>
          {customer.phone ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <a
                href={`tel:${customer.phone.replace(/[^\d+]/g, '')}`}
                className="rounded-xl border border-line px-4 py-3 text-center text-sm font-semibold hover:border-accent"
              >
                📞 Call
              </a>
              <a
                href={`https://wa.me/${whatsappDigits(customer.phone)}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-line px-4 py-3 text-center text-sm font-semibold hover:border-accent"
              >
                💬 WhatsApp
              </a>
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted">No phone number on this booking.</p>
          )}
        </Card>
      )}

      {/* Location */}
      <Card className="mb-3">
        <p className="text-xs uppercase tracking-wide text-muted">Where</p>
        <p className="mt-1 text-sm">{b.address}</p>
        {b.mode === 'scheduled' && b.scheduled_at && (
          <p className="mt-2 text-sm">
            <span className="text-muted">When:</span> {formatDateTime(b.scheduled_at)}
          </p>
        )}
        {(b.distance_km != null || b.eta_minutes != null) && (
          <p className="mt-1 text-xs text-muted">
            {b.distance_km != null && `${Number(b.distance_km).toFixed(1)} km when requested`}
            {b.distance_km != null && b.eta_minutes != null && ' · '}
            {b.eta_minutes != null && `~${b.eta_minutes} min drive`}
          </p>
        )}
        <a
          href={mapsDirectionsUrl(b.address, customer?.lat, customer?.lng)}
          target="_blank"
          rel="noreferrer"
          className="mt-3 block rounded-xl bg-panel-2 px-4 py-3 text-center text-sm font-semibold text-accent"
        >
          Open in Google Maps
        </a>
        {pins.length > 0 && (
          <div className="mt-3">
            <MapView pins={pins} height={220} />
          </div>
        )}
        {tracking && (
          <p className="mt-2 text-xs text-muted">
            Sharing your location with the customer{lastSentAt ? ` · last sent ${timeHM(lastSentAt)}` : ''}. Keep this screen open.
          </p>
        )}
      </Card>

      {/* Details */}
      <Card className="mb-3">
        <dl className="space-y-2 text-sm">
          {b.packages?.duration_hours != null && (
            <Row label="Duration">
              {b.packages.duration_hours} hour{b.packages.duration_hours === 1 ? '' : 's'}
            </Row>
          )}
          <Row label="Payment">{PAYMENT_LABEL[b.payment_status]}</Row>
          <Row label="Requested">{formatDateTime(b.created_at)}</Row>
          {b.notes && <Row label="Notes">{b.notes}</Row>}
        </dl>
      </Card>

      {canCancel && !cancelOpen && (
        <Button variant="ghost" block onClick={() => setCancelOpen(true)}>
          Cancel job
        </Button>
      )}
      {canCancel && cancelOpen && (
        <Card className="border-bad/40">
          <Field label="Why are you cancelling?" hint="The customer and admin can see this">
            <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={300} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={busy}>
              Keep job
            </Button>
            <Button variant="danger" loading={busy} onClick={cancel}>
              Cancel job
            </Button>
          </div>
        </Card>
      )}
    </Page>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words">{children}</dd>
    </div>
  )
}
