import { useCallback, useEffect, useMemo, useState } from 'react'
import type { QueryData } from '@supabase/supabase-js'
import { supabase, errorMessage } from '../../lib/supabase'
import type { Enums } from '../../lib/database.types'
import { KIND_LABEL, TIER_LABEL, formatDateTime } from '../../lib/format'
import { Badge, Button, Card, EmptyState, ErrorText, Page, PageLoader, Select } from '../../components/ui'
import { MapView, type MapPin } from '../../components/MapView'
import { parsePoint, timeAgo, waNumber } from './shared'

const crewQuery = () =>
  supabase
    .from('crew_members')
    .select('*, profiles!crew_members_id_fkey(full_name, phone)')
    .order('created_at', { ascending: false })

type CrewRow = QueryData<ReturnType<typeof crewQuery>>[number]
const TIERS: Enums<'crew_tier'>[] = ['lite', 'pro', 'ultra']
const STALE_MS = 10 * 60 * 1000

export default function CrewPage() {
  const [rows, setRows] = useState<CrewRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showMap, setShowMap] = useState(true)

  const load = useCallback(async () => {
    const { data, error } = await crewQuery()
    if (error) setError(errorMessage(error))
    else {
      setError(null)
      setRows(data ?? [])
    }
  }, [])

  useEffect(() => {
    load()
    // crew_members isn't in the realtime publication, so poll for online state.
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  const sorted = useMemo(() => {
    const list = [...(rows ?? [])]
    // Pending applications first, then online crew, then the rest by name.
    return list.sort((a, b) => {
      if (a.approved !== b.approved) return a.approved ? 1 : -1
      if (a.is_online !== b.is_online) return a.is_online ? -1 : 1
      return a.display_name.localeCompare(b.display_name)
    })
  }, [rows])

  const pins = useMemo(() => {
    const out: MapPin[] = []
    for (const c of rows ?? []) {
      if (!c.approved || !c.is_online) continue
      const p = parsePoint(c.location)
      if (p) out.push({ id: c.id, kind: 'crew', lat: p.lat, lng: p.lng, label: `${c.display_name} · ${TIER_LABEL[c.tier]}` })
    }
    return out
  }, [rows])

  const pending = (rows ?? []).filter((c) => !c.approved).length
  const online = (rows ?? []).filter((c) => c.approved && c.is_online).length

  return (
    <Page
      title="Crew"
      action={
        <span className="text-xs text-muted">
          {online} online · {pending} pending
        </span>
      }
    >
      <ErrorText>{error}</ErrorText>
      {!rows && !error && <PageLoader />}

      {rows && (
        <Card className="mb-3 !p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Online crew map</h2>
            <button className="text-xs text-accent" onClick={() => setShowMap((s) => !s)}>
              {showMap ? 'Hide' : 'Show'}
            </button>
          </div>
          {showMap &&
            (pins.length > 0 ? (
              <div className="mt-2">
                <MapView pins={pins} height={220} />
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted">No online crew with a location right now.</p>
            ))}
        </Card>
      )}

      {rows && sorted.length === 0 && <EmptyState title="No crew yet">Applications from the crew sign-up show up here.</EmptyState>}
      <div className="space-y-2">
        {sorted.map((c) => (
          <CrewCard key={c.id} crew={c} onDone={load} />
        ))}
      </div>
    </Page>
  )
}

function CrewCard({ crew, onDone }: { crew: CrewRow; onDone: () => void }) {
  const [tier, setTier] = useState<Enums<'crew_tier'>>(crew.tier)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => setTier(crew.tier), [crew.tier])

  const fresh = !!crew.location_updated_at && Date.now() - new Date(crew.location_updated_at).getTime() < STALE_MS
  const phone = crew.profiles?.phone ?? null

  const setApproval = async (approved: boolean) => {
    if (!approved && !window.confirm(`Revoke ${crew.display_name}? They will go offline and stop receiving jobs.`)) return
    setBusy(true)
    setErr(null)
    const { error } = await supabase.rpc('admin_set_crew_approval', {
      p_crew_id: crew.id,
      p_approved: approved,
      p_tier: tier,
    })
    setBusy(false)
    if (error) setErr(errorMessage(error))
    else onDone()
  }

  return (
    <Card className={`!p-3 ${!crew.approved ? 'border-accent/40' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{crew.display_name}</p>
          <p className="text-sm text-muted">
            {KIND_LABEL[crew.kind]} · {TIER_LABEL[crew.tier]} · ★ {Number(crew.rating ?? 0).toFixed(1)}
          </p>
          {crew.profiles?.full_name && crew.profiles.full_name !== crew.display_name && (
            <p className="truncate text-xs text-muted">{crew.profiles.full_name}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {crew.approved ? <Badge tone="ok">Approved</Badge> : <Badge tone="accent">Pending</Badge>}
          {crew.approved && (
            <Badge tone={crew.is_online ? (fresh ? 'ok' : 'accent') : 'neutral'}>
              {crew.is_online ? (fresh ? 'Online' : 'Online · stale') : 'Offline'}
            </Badge>
          )}
        </div>
      </div>
      {crew.bio && <p className="mt-2 text-sm">{crew.bio}</p>}
      <p className="mt-2 text-xs text-muted">
        Location {timeAgo(crew.location_updated_at)} · Applied {formatDateTime(crew.created_at)}
      </p>
      {phone && (
        <p className="mt-1 text-xs">
          <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="text-accent">
            {phone}
          </a>
          {' · '}
          <a href={`https://wa.me/${waNumber(phone)}`} target="_blank" rel="noreferrer" className="text-ok">
            WhatsApp
          </a>
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Select value={tier} onChange={(e) => setTier(e.target.value as Enums<'crew_tier'>)} className="!py-2 flex-1">
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {TIER_LABEL[t]}
            </option>
          ))}
        </Select>
        {crew.approved ? (
          <>
            {tier !== crew.tier && (
              <Button onClick={() => setApproval(true)} loading={busy} className="!py-2">
                Set tier
              </Button>
            )}
            <Button variant="danger" onClick={() => setApproval(false)} loading={busy} className="!py-2">
              Revoke
            </Button>
          </>
        ) : (
          <Button onClick={() => setApproval(true)} loading={busy} className="!py-2">
            Approve
          </Button>
        )}
      </div>
      <ErrorText>{err}</ErrorText>
    </Card>
  )
}
