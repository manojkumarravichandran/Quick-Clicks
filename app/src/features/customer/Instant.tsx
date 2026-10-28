import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { reverseGeocode, useCurrentPosition } from '../../lib/geo'
import type { RpcReturn } from '../../lib/database.types'
import { inr, KIND_LABEL, TIER_LABEL } from '../../lib/format'
import { Badge, Button, Card, EmptyState, ErrorText, Field, Input, Page, Spinner, Textarea } from '../../components/ui'
import { MapView, type MapPin } from '../../components/MapView'
import { friendlyError, saveJobPosition, TIER_RANK, usePackages } from './shared'

type Crew = RpcReturn<'nearby_crew'>[number]
const RADIUS_KM = 20

export default function Instant() {
  const { session, profile } = useAuth()
  const navigate = useNavigate()
  const { pos, error: posError, loading: posLoading, refresh: refreshPos } = useCurrentPosition()
  const { packages, error: pkgError } = usePackages(['instant'])

  const [address, setAddress] = useState('')
  const [addressTouched, setAddressTouched] = useState(false)
  const [packageId, setPackageId] = useState<string | null>(null)
  const [crew, setCrew] = useState<Crew[] | null>(null)
  const [crewError, setCrewError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (profile?.phone) setPhone((p) => p || profile.phone || '')
  }, [profile?.phone])

  useEffect(() => {
    if (!packageId && packages?.length) setPackageId(packages[0].id)
  }, [packages, packageId])

  // Fill address from GPS unless the user has typed their own.
  useEffect(() => {
    if (!pos || addressTouched) return
    let alive = true
    reverseGeocode(pos).then((a) => {
      if (alive && a) setAddress(a)
    })
    return () => {
      alive = false
    }
  }, [pos, addressTouched])

  const loadCrew = useCallback(async () => {
    if (!pos) return
    const { data, error } = await supabase.rpc('nearby_crew', { p_lat: pos.lat, p_lng: pos.lng, p_radius_km: RADIUS_KM })
    if (error) setCrewError(friendlyError(error))
    else {
      setCrewError(null)
      setCrew(data ?? [])
    }
  }, [pos])

  useEffect(() => {
    if (!pos) return
    loadCrew()
    const t = setInterval(loadCrew, 30000)
    return () => clearInterval(t)
  }, [pos, loadCrew])

  const pkg = packages?.find((p) => p.id === packageId) ?? null
  const matching = useMemo(() => {
    if (!crew || !pkg) return []
    return crew
      .filter((c) => c.kind === pkg.crew_kind && pkg.tier && TIER_RANK[c.tier] >= TIER_RANK[pkg.tier])
      .sort((a, b) => a.eta_minutes - b.eta_minutes)
  }, [crew, pkg])
  const selected = matching.find((c) => c.crew_id === selectedId) ?? null

  // Drop selection if that person disappears or no longer matches.
  useEffect(() => {
    if (selectedId && !matching.some((c) => c.crew_id === selectedId)) setSelectedId(null)
  }, [matching, selectedId])

  const pins: MapPin[] = [
    ...(pos ? [{ id: 'me', lat: pos.lat, lng: pos.lng, kind: 'me' as const, label: 'You' }] : []),
    ...matching.map((c) => ({
      id: c.crew_id,
      lat: c.approx_lat,
      lng: c.approx_lng,
      kind: 'crew' as const,
      label: `${c.display_name} · ~${c.eta_minutes} min`,
      selected: c.crew_id === selectedId,
    })),
  ]

  async function request() {
    if (!session) {
      navigate('/signin?next=/instant')
      return
    }
    if (!pos || !pkg || !selected) return
    if (!address.trim()) return setSubmitError('Enter the address where the crew should come.')
    if (!phone.trim()) return setSubmitError('Enter a phone number the crew can call.')
    setBusy(true)
    setSubmitError(null)
    const { data, error } = await supabase.rpc('request_instant_booking', {
      p_crew_id: selected.crew_id,
      p_package_id: pkg.id,
      p_lat: pos.lat,
      p_lng: pos.lng,
      p_address: address.trim(),
      p_contact_phone: phone.trim(),
      p_notes: notes.trim(),
    })
    setBusy(false)
    if (error || !data) {
      setSubmitError(friendlyError(error))
      loadCrew()
      return
    }
    saveJobPosition(data.id, pos.lat, pos.lng)
    navigate(`/bookings/${data.id}`)
  }

  return (
    <Page title="Instant shoot ⚡">
      {/* Location */}
      {posError ? (
        <Card className="mb-4 border-bad/40">
          <p className="font-semibold">We need your location</p>
          <p className="mt-1 text-sm text-muted">{posError}</p>
          <Button variant="outline" className="mt-3" onClick={refreshPos} loading={posLoading}>
            Try again
          </Button>
        </Card>
      ) : !pos ? (
        <Card className="mb-4 flex items-center gap-3">
          <Spinner small />
          <span className="text-sm text-muted">Finding your location…</span>
        </Card>
      ) : null}

      {/* Package */}
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">What do you need?</h2>
      <ErrorText>{pkgError}</ErrorText>
      {!packages ? (
        <div className="py-4 text-center">
          <Spinner />
        </div>
      ) : packages.length === 0 ? (
        <p className="mb-4 text-sm text-muted">Instant packages aren't available right now.</p>
      ) : (
        <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {packages.map((p) => (
            <button
              key={p.id}
              onClick={() => setPackageId(p.id)}
              className={`w-40 shrink-0 rounded-xl border p-3 text-left ${
                p.id === packageId ? 'border-accent bg-accent/10' : 'border-line bg-panel'
              }`}
            >
              <span className="block text-sm font-semibold">{p.name}</span>
              <span className="block text-xs text-muted">{p.description}</span>
              <span className="mt-1 block font-bold text-accent">{inr(p.price_inr)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Map + crew */}
      {pos && (
        <>
          <MapView pins={pins} radiusKm={RADIUS_KM} onPinClick={(id) => id !== 'me' && setSelectedId(id)} />
          <div className="mt-3 mb-2 flex items-baseline justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Available within {RADIUS_KM} km</h2>
            <button onClick={loadCrew} className="text-xs text-accent">
              Refresh
            </button>
          </div>
          <ErrorText>{crewError}</ErrorText>
          {crew === null ? (
            !crewError && <div className="py-4 text-center">
              <Spinner />
            </div>
          ) : matching.length === 0 ? (
            <EmptyState title="No one is available for this right now">
              <p>
                {crew.length > 0
                  ? 'There are crew online nearby, but none for this package. Try another package, or'
                  : 'No crew are online near you at the moment. We refresh every 30 seconds, or you can'}
              </p>
              <Link to="/book" className="mt-3 inline-block font-semibold text-accent">
                Schedule a shoot instead →
              </Link>
            </EmptyState>
          ) : (
            <div className="grid gap-2">
              {matching.map((c) => (
                <button
                  key={c.crew_id}
                  onClick={() => setSelectedId(c.crew_id)}
                  className={`rounded-xl border px-4 py-3 text-left ${
                    c.crew_id === selectedId ? 'border-accent bg-accent/10' : 'border-line bg-panel'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{c.display_name}</span>
                    <span className="text-sm font-bold text-accent">~{c.eta_minutes} min</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>{KIND_LABEL[c.kind]}</span>
                    <Badge tone="accent">{TIER_LABEL[c.tier]}</Badge>
                    <span>★ {Number(c.rating).toFixed(1)}</span>
                    <span>{c.distance_km} km away</span>
                    <span className="ml-auto">estimate</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* Request form */}
      {selected && pkg && (
        <Card className="mt-5">
          <p className="mb-3 text-sm text-muted">
            Requesting <span className="font-semibold text-text">{selected.display_name}</span> for{' '}
            <span className="font-semibold text-text">{pkg.name}</span> · {inr(pkg.price_inr)}
          </p>
          <Field label="Address" hint="Where should the crew come? Add flat / landmark.">
            <Input
              value={address}
              onChange={(e) => {
                setAddressTouched(true)
                setAddress(e.target.value)
              }}
              placeholder="Street, area"
            />
          </Field>
          <Field label="Contact phone">
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91…" />
          </Field>
          <Field label="Notes (optional)">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What are you shooting?" />
          </Field>
          <ErrorText>{submitError}</ErrorText>
          <Button block onClick={request} loading={busy}>
            {session ? `Request ${selected.display_name}` : 'Sign in to request'}
          </Button>
          <p className="mt-2 text-center text-xs text-muted">They'll have a few minutes to accept. ETA is an estimate.</p>
        </Card>
      )}
      {!selected && matching.length > 0 && (
        <p className="mt-3 text-center text-sm text-muted">Tap someone to request them.</p>
      )}
    </Page>
  )
}
