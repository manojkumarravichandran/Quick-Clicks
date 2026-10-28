import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { QueryData } from '@supabase/supabase-js'
import { supabase, errorMessage } from '../../lib/supabase'
import { formatDateTime, inr } from '../../lib/format'
import { Badge, Card, EmptyState, ErrorText, Input, Page, PageLoader } from '../../components/ui'
import { StatusBadge, isSameLocalDay, type BookingStatus } from './shared'

const bookingsQuery = () =>
  supabase
    .from('bookings')
    .select('*, packages(name), profiles!bookings_customer_id_fkey(full_name, phone), crew_members(display_name)')
    .order('created_at', { ascending: false })
    .limit(500)

export type AdminBooking = QueryData<ReturnType<typeof bookingsQuery>>[number]

type Filter = 'needs' | 'active' | 'upcoming' | 'done' | 'cancelled' | 'all'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'needs', label: 'Needs action' },
  { id: 'active', label: 'Active' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'done', label: 'Done' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'all', label: 'All' },
]

const IN_PROGRESS: BookingStatus[] = ['accepted', 'en_route', 'arrived', 'shooting', 'editing']
const LIVE_NOW: BookingStatus[] = ['en_route', 'arrived', 'shooting']

export const needsAction = (b: Pick<AdminBooking, 'status' | 'mode' | 'crew_id'>) =>
  b.status === 'declined' || (b.mode === 'scheduled' && b.status === 'requested' && !b.crew_id)

function matches(b: AdminBooking, f: Filter, now: number): boolean {
  switch (f) {
    case 'needs':
      return needsAction(b)
    case 'active':
      return IN_PROGRESS.includes(b.status) || (b.mode === 'instant' && b.status === 'requested')
    case 'upcoming':
      return (
        !!b.scheduled_at &&
        new Date(b.scheduled_at).getTime() > now &&
        !['cancelled', 'delivered'].includes(b.status)
      )
    case 'done':
      return b.status === 'delivered'
    case 'cancelled':
      return b.status === 'cancelled'
    default:
      return true
  }
}

export default function BookingsPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<AdminBooking[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('needs')
  const [q, setQ] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await bookingsQuery()
    if (error) setError(errorMessage(error))
    else {
      setError(null)
      setRows(data ?? [])
    }
  }, [])

  useEffect(() => {
    load()
    const channel = supabase
      .channel(`admin-bookings-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
        // Debounce bursts (status change + touch trigger) into one refetch.
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(load, 400)
      })
      .subscribe()
    return () => {
      if (timer.current) clearTimeout(timer.current)
      supabase.removeChannel(channel)
    }
  }, [load])

  const stats = useMemo(() => {
    const list = rows ?? []
    return {
      today: list.filter((b) => isSameLocalDay(b.scheduled_at ?? b.created_at)).length,
      live: list.filter((b) => LIVE_NOW.includes(b.status) || (b.mode === 'instant' && b.status === 'accepted')).length,
      awaiting: list.filter(needsAction).length,
      delivered: list.filter((b) => b.status === 'delivered').reduce((s, b) => s + (b.price_inr ?? 0), 0),
    }
  }, [rows])

  const visible = useMemo(() => {
    const now = Date.now()
    const term = q.trim().toLowerCase()
    return (rows ?? []).filter((b) => {
      if (!matches(b, filter, now)) return false
      if (!term) return true
      return [b.address, b.profiles?.full_name, b.profiles?.phone, b.contact_phone, b.packages?.name, b.crew_members?.display_name, b.id]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(term))
    })
  }, [rows, filter, q])

  const counts = useMemo(() => {
    const now = Date.now()
    const c = {} as Record<Filter, number>
    for (const f of FILTERS) c[f.id] = (rows ?? []).filter((b) => matches(b, f.id, now)).length
    return c
  }, [rows])

  return (
    <Page title="Bookings">
      <div className="mb-4 grid grid-cols-2 gap-2">
        <Stat label="Today" value={String(stats.today)} />
        <Stat label="Live now" value={String(stats.live)} tone="accent" />
        <Stat label="Awaiting crew" value={String(stats.awaiting)} tone={stats.awaiting ? 'bad' : undefined} />
        <Stat label="Delivered value" value={inr(stats.delivered)} tone="ok" />
      </div>

      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${
              filter === f.id ? 'border-accent bg-accent/15 text-accent' : 'border-line text-muted'
            }`}
          >
            {f.label}
            {rows && <span className="ml-1 opacity-70">{counts[f.id]}</span>}
          </button>
        ))}
      </div>

      <Input placeholder="Search customer, phone, address…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" />

      <ErrorText>{error}</ErrorText>
      {!rows && !error && <PageLoader />}
      {rows && visible.length === 0 && <EmptyState title="Nothing here">No bookings match this filter.</EmptyState>}

      <div className="space-y-2">
        {visible.map((b) => (
          <Card key={b.id} onClick={() => navigate(`/admin/bookings/${b.id}`)} className="!p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">{b.packages?.name ?? 'Package'}</p>
                <p className="truncate text-sm text-muted">
                  {b.profiles?.full_name || 'Unnamed customer'}
                  {b.profiles?.phone || b.contact_phone ? ` · ${b.contact_phone || b.profiles?.phone}` : ''}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-semibold">{inr(b.price_inr ?? 0)}</p>
                <StatusBadge status={b.status} />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <Badge tone={b.mode === 'instant' ? 'accent' : 'neutral'}>{b.mode}</Badge>
              {needsAction(b) && <Badge tone="bad">Needs crew</Badge>}
              <span>{b.scheduled_at ? formatDateTime(b.scheduled_at) : `Booked ${formatDateTime(b.created_at)}`}</span>
              <span>· {b.crew_members?.display_name ?? 'No crew'}</span>
            </div>
            <p className="mt-1 truncate text-xs text-muted">{b.address}</p>
          </Card>
        ))}
      </div>
    </Page>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'accent' | 'ok' | 'bad' }) {
  const color = tone === 'accent' ? 'text-accent' : tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-bad' : 'text-text'
  return (
    <div className="rounded-xl border border-line bg-panel px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-0.5 text-xl font-bold ${color}`}>{value}</p>
    </div>
  )
}
