import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { supabase, errorMessage } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import type { Enums, Tables } from '../../lib/database.types'
import { ACTIVE_STATUSES, STATUS_LABEL } from '../../lib/format'
import { Badge } from '../../components/ui'

export type Pkg = Tables<'packages'>
export type Booking = Tables<'bookings'>
export type BookingWithPkg = Booking & { packages: { name: string } | null }

export const TIER_RANK: Record<Enums<'crew_tier'>, number> = { lite: 0, pro: 1, ultra: 2 }

/** Loads active packages in the given categories, sorted by sort_order. */
export function usePackages(categories: Enums<'package_category'>[]) {
  const [packages, setPackages] = useState<Pkg[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const key = categories.join(',')
  useEffect(() => {
    let alive = true
    supabase
      .from('packages')
      .select('*')
      .in('category', key.split(',') as Enums<'package_category'>[])
      .order('sort_order')
      .then(({ data, error }) => {
        if (!alive) return
        if (error) setError(friendlyError(error))
        setPackages(data ?? [])
      })
    return () => {
      alive = false
    }
  }, [key])
  return { packages, error }
}

/** Most recent active booking for the signed-in user (null if none / guest). */
export function useActiveBooking() {
  const { session } = useAuth()
  const [booking, setBooking] = useState<BookingWithPkg | null>(null)
  const uid = session?.user.id
  useEffect(() => {
    if (!uid) {
      setBooking(null)
      return
    }
    let alive = true
    supabase
      .from('bookings')
      .select('*, packages(name)')
      .eq('customer_id', uid)
      .in('status', ACTIVE_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (alive) setBooking((data?.[0] as BookingWithPkg | undefined) ?? null)
      })
    return () => {
      alive = false
    }
  }, [uid])
  return booking
}

export function statusTone(s: Enums<'booking_status'>): 'neutral' | 'accent' | 'ok' | 'bad' {
  if (s === 'declined' || s === 'cancelled') return 'bad'
  if (s === 'delivered') return 'ok'
  return 'accent'
}

export function StatusBadge({ status }: { status: Enums<'booking_status'> }) {
  return <Badge tone={statusTone(status)}>{STATUS_LABEL[status]}</Badge>
}

export function BackLink({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="text-sm text-muted hover:text-text">
      ← {children}
    </Link>
  )
}

/** Value for a datetime-local input, in the browser's local time. */
export function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Remember where an instant job is, since bookings.location (PostGIS) isn't readable client-side. */
const JOB_POS_KEY = (id: string) => `qc-job-pos-${id}`
export function saveJobPosition(id: string, lat: number, lng: number) {
  try {
    localStorage.setItem(JOB_POS_KEY(id), JSON.stringify({ lat, lng }))
  } catch {
    /* storage unavailable */
  }
}
export function loadJobPosition(id: string): { lat: number; lng: number } | null {
  try {
    const v = localStorage.getItem(JOB_POS_KEY(id))
    if (!v) return null
    const p = JSON.parse(v)
    return typeof p?.lat === 'number' && typeof p?.lng === 'number' ? p : null
  } catch {
    return null
  }
}

/** errorMessage(), but network failures read as a sentence instead of "TypeError: Failed to fetch". */
export function friendlyError(err: unknown) {
  const m = errorMessage(err)
  return /failed to fetch|network|load failed/i.test(m) ? "Couldn't reach Quick Clicks. Check your connection and try again." : m
}

const CALLOUT_TONE = {
  accent: 'border-accent/50 bg-accent/10',
  ok: 'border-ok/50 bg-ok/10',
  bad: 'border-bad/50 bg-bad/10',
}
/** Highlighted card (ui Card's border/bg can't be overridden by className). */
export function Callout({ tone, children }: { tone: keyof typeof CALLOUT_TONE; children: ReactNode }) {
  return <div className={`mb-4 rounded-2xl border p-4 ${CALLOUT_TONE[tone]}`}>{children}</div>
}
