import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, errorMessage } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { KIND_LABEL } from '../../lib/format'
import type { Enums } from '../../lib/database.types'
import { Badge, Button, Card, ErrorText, Field, Input, Page, PageLoader, Select, Textarea } from '../../components/ui'
import { useCrew } from './CrewContext'

const KINDS = Object.keys(KIND_LABEL) as Enums<'crew_kind'>[]

export default function CrewJoin() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const { crew, crewLoading, crewError, reloadCrew } = useCrew()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Enums<'crew_kind'>>('photographer')
  const [bio, setBio] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Prefill from the existing application, or the profile name for first-timers.
  useEffect(() => {
    if (crew) {
      setName(crew.display_name)
      setKind(crew.kind)
      setBio(crew.bio)
    } else if (profile?.full_name) {
      setName((n) => n || profile.full_name || '')
    }
  }, [crew, profile?.full_name])

  if (crewLoading) return <PageLoader />

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Add the name customers will see')
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('apply_as_crew', { p_display_name: name.trim(), p_kind: kind, p_bio: bio.trim() })
    setBusy(false)
    if (error) return setError(errorMessage(error))
    await reloadCrew()
    setEditing(false)
  }

  if (crew?.approved && !editing) {
    return (
      <Page title="Crew profile">
        <Card>
          <div className="flex items-center justify-between">
            <p className="font-semibold">{crew.display_name}</p>
            <Badge tone="ok">Approved</Badge>
          </div>
          <p className="mt-1 text-sm text-muted">{KIND_LABEL[crew.kind]}</p>
        </Card>
        <p className="mt-4 text-sm text-muted">You're approved. Go online from the dashboard to receive requests.</p>
        <Button block className="mt-4" onClick={() => navigate('/crew')}>
          Open crew dashboard
        </Button>
      </Page>
    )
  }

  if (crew && !editing) {
    return (
      <Page title="Join as crew">
        <Card>
          <div className="flex items-center justify-between">
            <p className="font-semibold">Application received</p>
            <Badge tone="accent">Pending</Badge>
          </div>
          <p className="mt-2 text-sm text-muted">An admin will review it. Once approved, the Crew tab appears and you can go online.</p>
          <dl className="mt-4 space-y-2 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Name</dt>
              <dd>{crew.display_name}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Kind</dt>
              <dd>{KIND_LABEL[crew.kind]}</dd>
            </div>
            {crew.bio && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">About</dt>
                <dd className="whitespace-pre-wrap">{crew.bio}</dd>
              </div>
            )}
          </dl>
        </Card>
        <Button variant="outline" block className="mt-4" onClick={() => setEditing(true)}>
          Edit application
        </Button>
      </Page>
    )
  }

  return (
    <Page title={crew ? 'Edit application' : 'Join as crew'}>
      {!crew && (
        <p className="mb-4 text-sm text-muted">
          Shoot for customers across Bengaluru. Tell us who you are — an admin reviews every application before you can go online.
        </p>
      )}
      <ErrorText>{crewError}</ErrorText>
      <form onSubmit={submit}>
        <Field label="Display name" hint="Customers see this name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Arjun Frames" maxLength={60} required />
        </Field>
        <Field label="What you do">
          <Select value={kind} onChange={(e) => setKind(e.target.value as Enums<'crew_kind'>)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="About you" hint="Gear, experience, portfolio link">
          <Textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={5} maxLength={1000} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" block loading={busy}>
          {crew ? 'Save changes' : 'Send application'}
        </Button>
        {crew && (
          <Button type="button" variant="ghost" block className="mt-2" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
      </form>
    </Page>
  )
}
