import { Link, useLocation } from 'react-router-dom'
import type { Enums } from '../../lib/database.types'
import { Badge } from '../../components/ui'
import { STATUS_LABEL } from '../../lib/format'

export type BookingStatus = Enums<'booking_status'>

const TABS = [
  { to: '/admin', label: 'Bookings', match: (p: string) => p === '/admin' || p === '/admin/' || p.startsWith('/admin/bookings') },
  { to: '/admin/crew', label: 'Crew', match: (p: string) => p.startsWith('/admin/crew') },
  { to: '/admin/packages', label: 'Packages', match: (p: string) => p.startsWith('/admin/packages') },
  { to: '/admin/users', label: 'Users', match: (p: string) => p.startsWith('/admin/users') },
]

/** Small top tab bar shared by every admin screen. */
export function AdminTabs() {
  const { pathname } = useLocation()
  return (
    <nav className="sticky top-0 z-30 flex gap-1 border-b border-line bg-ink/95 px-2 py-2 backdrop-blur">
      {TABS.map((t) => {
        const active = t.match(pathname)
        return (
          <Link
            key={t.to}
            to={t.to}
            className={`flex-1 rounded-lg px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide ${
              active ? 'bg-panel-2 text-accent' : 'text-muted'
            }`}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}

export function statusTone(s: BookingStatus): 'neutral' | 'accent' | 'ok' | 'bad' {
  if (s === 'delivered') return 'ok'
  if (s === 'cancelled' || s === 'declined') return 'bad'
  if (s === 'requested') return 'neutral'
  return 'accent'
}

export function StatusBadge({ status }: { status: BookingStatus }) {
  return <Badge tone={statusTone(status)}>{STATUS_LABEL[status] ?? status}</Badge>
}

/**
 * PostgREST returns PostGIS geography as hex EWKB. A point is small enough to
 * decode by hand: byte order, type (with optional SRID flag), SRID, X, Y.
 * Also accepts GeoJSON in case the column is ever selected via a view.
 */
export function parsePoint(v: unknown): { lat: number; lng: number } | null {
  try {
    if (v && typeof v === 'object' && 'coordinates' in v) {
      const c = (v as { coordinates: unknown }).coordinates
      if (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number') return { lng: c[0], lat: c[1] }
      return null
    }
    if (typeof v !== 'string' || v.length < 42 || v.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(v)) return null
    const bytes = new Uint8Array(v.length / 2)
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(v.substr(i * 2, 2), 16)
    const dv = new DataView(bytes.buffer)
    const le = bytes[0] === 1
    const type = dv.getUint32(1, le)
    if ((type & 0xff) !== 1) return null // not a point
    let off = 5
    if (type & 0x20000000) off += 4 // SRID present
    if (bytes.length < off + 16) return null
    const lng = dv.getFloat64(off, le)
    const lat = dv.getFloat64(off + 8, le)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return { lat, lng }
  } catch {
    return null
  }
}

/** Digits-only phone for wa.me links; assumes India (+91) for bare 10-digit numbers. */
export function waNumber(phone: string): string {
  const d = phone.replace(/\D/g, '')
  if (d.length === 10) return '91' + d
  if (d.length === 11 && d.startsWith('0')) return '91' + d.slice(1)
  return d
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (!Number.isFinite(s)) return '—'
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}

export const isSameLocalDay = (iso: string | null | undefined, d = new Date()) =>
  !!iso && new Date(iso).toDateString() === d.toDateString()
