import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { getCurrentPosition, reverseGeocode, type LatLng } from '../../lib/geo'
import { inr } from '../../lib/format'
import { Button, Card, ErrorText, Field, Input, Page, PageLoader, Select, Textarea } from '../../components/ui'
import { friendlyError, saveJobPosition, toLocalInput, usePackages } from './shared'

const MIN_LEAD_MS = 2 * 60 * 60 * 1000

export default function Book() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { packages, error: pkgError } = usePackages(['shoot', 'wedding'])

  const [packageId, setPackageId] = useState('')
  const [when, setWhen] = useState('')
  const [address, setAddress] = useState('')
  const [coords, setCoords] = useState<LatLng | null>(null)
  const [locBusy, setLocBusy] = useState(false)
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!packages?.length || packageId) return
    const slug = params.get('package')
    setPackageId((packages.find((p) => p.slug === slug) ?? packages[0]).id)
  }, [packages, packageId, params])

  useEffect(() => {
    if (profile?.phone) setPhone((p) => p || profile.phone || '')
  }, [profile?.phone])

  const pkg = packages?.find((p) => p.id === packageId)
  // Recomputed per render; the 5-min slack keeps the min valid while the form is open.
  const minWhen = toLocalInput(new Date(Date.now() + MIN_LEAD_MS + 5 * 60 * 1000))

  async function useLocation() {
    setLocBusy(true)
    setError(null)
    try {
      const p = await getCurrentPosition()
      setCoords(p)
      if (!address.trim()) {
        const a = await reverseGeocode(p)
        if (a) setAddress(a)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLocBusy(false)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!pkg) return setError('Pick a package.')
    if (!when) return setError('Pick a date and time.')
    const at = new Date(when)
    if (isNaN(at.getTime()) || at.getTime() < Date.now() + MIN_LEAD_MS)
      return setError('Pick a time at least 2 hours from now.')
    if (!address.trim()) return setError('Enter the shoot address.')
    if (!phone.trim()) return setError('Enter a contact phone number.')
    setBusy(true)
    const { data, error } = await supabase.rpc('create_scheduled_booking', {
      p_package_id: pkg.id,
      p_scheduled_at: at.toISOString(),
      p_address: address.trim(),
      p_contact_phone: phone.trim(),
      p_notes: notes.trim(),
      ...(coords ? { p_lat: coords.lat, p_lng: coords.lng } : {}),
    })
    setBusy(false)
    if (error || !data) return setError(friendlyError(error))
    if (coords) saveJobPosition(data.id, coords.lat, coords.lng)
    navigate(`/bookings/${data.id}`)
  }

  if (!packages) return <PageLoader />

  return (
    <Page title="Schedule a shoot">
      <form onSubmit={submit}>
        <ErrorText>{pkgError}</ErrorText>
        <Field label="Package">
          <Select value={packageId} onChange={(e) => setPackageId(e.target.value)}>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.category === 'wedding' ? 'Wedding · ' : ''}
                {p.name} — {inr(p.price_inr)}
              </option>
            ))}
          </Select>
        </Field>
        {pkg && (
          <Card className="-mt-2 mb-4 bg-panel-2">
            <p className="text-sm text-muted">{pkg.description}</p>
            {pkg.features.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-sm">
                {pkg.features.map((f) => (
                  <li key={f}>
                    <span className="text-accent">✓</span> {f}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        <Field label="Date & time" hint="At least 2 hours from now.">
          <Input type="datetime-local" value={when} min={minWhen} onChange={(e) => setWhen(e.target.value)} required />
        </Field>
        <Field label="Address">
          <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Venue, street, area" />
        </Field>
        <div className="-mt-2 mb-4 flex items-center gap-3">
          <Button type="button" variant="outline" onClick={useLocation} loading={locBusy}>
            📍 Use my current location
          </Button>
          {coords && <span className="text-xs text-ok">Location attached</span>}
        </div>
        <Field label="Contact phone">
          <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91…" />
        </Field>
        <Field label="Notes (optional)">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Occasion, style, anything we should know" />
        </Field>

        <Card className="mb-4 bg-panel-2 text-sm text-muted">
          We'll assign a crew member and confirm with you. Payment is 50% advance once confirmed — our team will
          contact you for the advance.
        </Card>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" block loading={busy}>
          Request booking{pkg ? ` · ${inr(pkg.price_inr)}` : ''}
        </Button>
      </form>
    </Page>
  )
}
