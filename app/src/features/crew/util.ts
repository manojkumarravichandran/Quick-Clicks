import { useEffect, useState } from 'react'
import type { Enums } from '../../lib/database.types'

/** "just now", "4 min ago", "2 h ago", "3 d ago". */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

export const timeHM = (d: Date) => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

/** Re-render every `ms` so relative times stay fresh. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(id)
  }, [ms])
  return now
}

/** Digits for wa.me. Assumes India (+91) when a bare 10-digit number is given. */
export function whatsappDigits(phone: string): string {
  let d = phone.replace(/\D/g, '')
  if (d.startsWith('0')) d = d.replace(/^0+/, '')
  if (d.length === 10) d = '91' + d
  return d
}

export function mapsDirectionsUrl(address: string, lat?: number | null, lng?: number | null): string {
  if (lat != null && lng != null) return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

let audioCtx: AudioContext | null = null

/** Short double beep + vibration for a new request. Silently does nothing where unsupported. */
export function alertNewRequest() {
  try {
    navigator.vibrate?.([200, 100, 200])
  } catch {
    /* unsupported */
  }
  try {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    audioCtx ??= new AC()
    const ctx = audioCtx
    if (ctx.state === 'suspended') void ctx.resume()
    ;[0, 0.25].forEach((offset) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880
      const t = ctx.currentTime + offset
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.2)
    })
  } catch {
    /* audio blocked until the user interacts with the page */
  }
}

type WakeLockSentinelLike = { released: boolean; release: () => Promise<void>; addEventListener: (t: 'release', f: () => void) => void }
type WakeLockLike = { request: (type: 'screen') => Promise<WakeLockSentinelLike> }

/** Keep the screen on while `active` (Screen Wake Lock API, where supported). */
export function useWakeLock(active: boolean) {
  const wl = (navigator as unknown as { wakeLock?: WakeLockLike }).wakeLock
  const supported = !!wl
  const [isActive, setIsActive] = useState(false)
  useEffect(() => {
    if (!active || !wl) return
    let sentinel: WakeLockSentinelLike | null = null
    let cancelled = false
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return
      try {
        const s = await wl.request('screen')
        if (cancelled) {
          void s.release()
          return
        }
        sentinel = s
        setIsActive(true)
        s.addEventListener('release', () => setIsActive(false))
      } catch {
        setIsActive(false)
      }
    }
    void acquire()
    // The browser drops the lock when the tab is hidden; take it back on return.
    const onVisible = () => void acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      if (sentinel && !sentinel.released) void sentinel.release()
      setIsActive(false)
    }
  }, [active, wl])
  return { supported, active: isActive }
}

/** Status wording from the crew's point of view. */
export const CREW_STATUS_LABEL: Record<Enums<'booking_status'>, string> = {
  requested: 'New request',
  accepted: 'Accepted',
  declined: 'Declined',
  en_route: 'Driving',
  arrived: 'Arrived',
  shooting: 'Shooting',
  editing: 'Editing',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}
