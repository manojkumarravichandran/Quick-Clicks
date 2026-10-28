import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase, errorMessage } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { getCurrentPosition, useWatchPosition, type LatLng } from '../../lib/geo'
import type { Enums, Tables } from '../../lib/database.types'
import { alertNewRequest, useWakeLock } from './util'

export type CrewBooking = Tables<'bookings'> & {
  packages: { name: string; duration_hours: number } | null
}

/** Statuses where the crew is travelling to / at the customer, so we keep sharing location. */
export const TRACKING_STATUSES: Enums<'booking_status'>[] = ['accepted', 'en_route', 'arrived']

const LOCATION_INTERVAL_MS = 15_000
const HEARTBEAT_MS = 2 * 60_000

type CrewState = {
  uid: string
  crew: Tables<'crew_members'> | null
  crewLoading: boolean
  crewError: string | null
  reloadCrew: () => Promise<void>
  bookings: CrewBooking[]
  bookingsLoading: boolean
  bookingsError: string | null
  reloadBookings: () => Promise<void>
  /** Latest position this device reported (this session only). */
  myPos: LatLng | null
  lastSentAt: Date | null
  locationError: string | null
  tracking: boolean
  wakeLockActive: boolean
  wakeLockSupported: boolean
  setOnline: (online: boolean) => Promise<void>
  togglingOnline: boolean
}

const Ctx = createContext<CrewState | null>(null)

export function useCrew() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useCrew must be used inside CrewProvider')
  return c
}

export function CrewProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const uid = session?.user.id ?? ''

  const [crew, setCrew] = useState<Tables<'crew_members'> | null>(null)
  const [crewLoading, setCrewLoading] = useState(true)
  const [crewError, setCrewError] = useState<string | null>(null)

  const [bookings, setBookings] = useState<CrewBooking[]>([])
  const [bookingsLoading, setBookingsLoading] = useState(true)
  const [bookingsError, setBookingsError] = useState<string | null>(null)

  const [myPos, setMyPos] = useState<LatLng | null>(null)
  const [lastSentAt, setLastSentAt] = useState<Date | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [togglingOnline, setTogglingOnline] = useState(false)

  const reloadCrew = useCallback(async () => {
    if (!uid) return
    const { data, error } = await supabase.from('crew_members').select('*').eq('id', uid).maybeSingle()
    if (error) setCrewError(errorMessage(error))
    else {
      setCrewError(null)
      setCrew(data)
    }
    setCrewLoading(false)
  }, [uid])

  // Track which requests we've already seen so only genuinely new ones buzz.
  const seenRequests = useRef<Set<string> | null>(null)

  const reloadBookings = useCallback(async () => {
    if (!uid) return
    const { data, error } = await supabase
      .from('bookings')
      .select('*, packages(name, duration_hours)')
      .eq('crew_id', uid)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) {
      setBookingsError(errorMessage(error))
    } else {
      const rows = (data ?? []) as unknown as CrewBooking[]
      const requested = rows.filter((b) => b.status === 'requested').map((b) => b.id)
      if (seenRequests.current) {
        const seen = seenRequests.current
        if (requested.some((id) => !seen.has(id))) alertNewRequest()
      }
      seenRequests.current = new Set(requested)
      setBookingsError(null)
      setBookings(rows)
    }
    setBookingsLoading(false)
  }, [uid])

  useEffect(() => {
    reloadCrew()
  }, [reloadCrew])

  const approved = !!crew?.approved

  useEffect(() => {
    if (!uid || !approved) return
    reloadBookings()
    const channel = supabase
      .channel(`crew-${uid}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: 'crew_id=eq.' + uid }, () => {
        reloadBookings()
      })
      .subscribe()
    // Realtime can drop on flaky mobile networks; refetch when the tab comes back.
    const onVisible = () => {
      if (document.visibilityState === 'visible') reloadBookings()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(channel)
    }
  }, [uid, approved, reloadBookings])

  const onTrackingJob = bookings.some((b) => TRACKING_STATUSES.includes(b.status))
  const tracking = approved && (!!crew?.is_online || onTrackingJob)

  const lastPos = useRef<LatLng | null>(null)
  const lastSentMs = useRef(0)

  const send = useCallback(async (p: LatLng) => {
    lastPos.current = p
    setMyPos(p)
    const { error } = await supabase.rpc('crew_update_location', { p_lat: p.lat, p_lng: p.lng })
    if (error) setSendError(errorMessage(error))
    else {
      setSendError(null)
      lastSentMs.current = Date.now()
      setLastSentAt(new Date())
    }
  }, [])

  const { error: watchError } = useWatchPosition(tracking, send, LOCATION_INTERVAL_MS)

  // Heartbeat: watchPosition may stay silent when the phone isn't moving.
  useEffect(() => {
    if (!tracking) return
    const id = window.setInterval(async () => {
      if (Date.now() - lastSentMs.current < HEARTBEAT_MS - 5000) return
      try {
        send(lastPos.current ?? (await getCurrentPosition()))
      } catch (e) {
        setSendError((e as Error).message)
      }
    }, 30_000)
    return () => window.clearInterval(id)
  }, [tracking, send])

  const wake = useWakeLock(tracking)

  const setOnline = useCallback(
    async (online: boolean) => {
      setTogglingOnline(true)
      setSendError(null)
      try {
        if (online) {
          const p = await getCurrentPosition()
          const { error } = await supabase.rpc('crew_set_online', { p_online: true, p_lat: p.lat, p_lng: p.lng })
          if (error) throw error
          lastPos.current = p
          setMyPos(p)
          lastSentMs.current = Date.now()
          setLastSentAt(new Date())
        } else {
          const { error } = await supabase.rpc('crew_set_online', { p_online: false })
          if (error) throw error
        }
        setCrew((c) => (c ? { ...c, is_online: online } : c))
        await reloadCrew()
      } catch (e) {
        setSendError(errorMessage(e))
      } finally {
        setTogglingOnline(false)
      }
    },
    [reloadCrew],
  )

  const value: CrewState = {
    uid,
    crew,
    crewLoading,
    crewError,
    reloadCrew,
    bookings,
    bookingsLoading,
    bookingsError,
    reloadBookings,
    myPos,
    lastSentAt,
    locationError: sendError ?? (tracking ? watchError : null),
    tracking,
    wakeLockActive: wake.active,
    wakeLockSupported: wake.supported,
    setOnline,
    togglingOnline,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
