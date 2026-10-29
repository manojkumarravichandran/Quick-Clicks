import { useCallback, useEffect, useRef, useState } from 'react'

export type LatLng = { lat: number; lng: number }

/** One-shot browser location with a readable error. */
export function getCurrentPosition(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('This device does not support location'))
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) =>
        reject(
          new Error(
            e.code === e.PERMISSION_DENIED
              ? 'Location permission was denied. Allow location access in your browser settings.'
              : 'Could not get your location. Try again.',
          ),
        ),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    )
  })
}

/** Hook wrapper around getCurrentPosition. */
export function useCurrentPosition(auto = true) {
  const [pos, setPos] = useState<LatLng | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setPos(await getCurrentPosition())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    if (auto) refresh()
  }, [auto, refresh])
  return { pos, error, loading, refresh }
}

/** Continuous location updates while `active`; calls onUpdate at most every `minIntervalMs`. */
export function useWatchPosition(active: boolean, onUpdate: (p: LatLng) => void, minIntervalMs = 15000) {
  const last = useRef(0)
  const cb = useRef(onUpdate)
  cb.current = onUpdate
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!active || !('geolocation' in navigator)) return
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setError(null)
        const now = Date.now()
        if (now - last.current < minIntervalMs) return
        last.current = now
        cb.current({ lat: p.coords.latitude, lng: p.coords.longitude })
      },
      (e) => setError(e.code === e.PERMISSION_DENIED ? 'Location permission denied' : 'Location unavailable'),
      { enableHighAccuracy: true, maximumAge: 10000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [active, minIntervalMs])
  return { error }
}

/** Free reverse geocoding via OpenStreetMap Nominatim. Returns a short address or null. */
export async function reverseGeocode({ lat, lng }: LatLng): Promise<string | null> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=17`, {
      headers: { 'Accept-Language': 'en' },
    })
    if (!r.ok) return null
    const j = await r.json()
    const a = j.address ?? {}
    const parts = [a.road, a.neighbourhood ?? a.suburb, a.city ?? a.town ?? a.village].filter(Boolean)
    return parts.length ? parts.join(', ') : (j.display_name ?? null)
  } catch {
    return null
  }
}
