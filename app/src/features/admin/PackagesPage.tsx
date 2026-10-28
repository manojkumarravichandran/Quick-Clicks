import { useCallback, useEffect, useState } from 'react'
import { supabase, errorMessage } from '../../lib/supabase'
import type { Enums, Tables } from '../../lib/database.types'
import { KIND_LABEL, TIER_LABEL, inr } from '../../lib/format'
import { Badge, Button, Card, EmptyState, ErrorText, Field, Input, Page, PageLoader, Select, Textarea } from '../../components/ui'

type Pkg = Tables<'packages'>
const CATEGORIES: Enums<'package_category'>[] = ['shoot', 'wedding', 'instant']
const TIERS: Enums<'crew_tier'>[] = ['lite', 'pro', 'ultra']
const KINDS: Enums<'crew_kind'>[] = ['photographer', 'videographer', 'full_crew']

type Form = {
  name: string
  price_inr: string
  duration_hours: string
  description: string
  features: string
  is_active: boolean
  sort_order: string
}

const toForm = (p: Pkg): Form => ({
  name: p.name,
  price_inr: String(p.price_inr),
  duration_hours: String(p.duration_hours),
  description: p.description ?? '',
  features: (p.features ?? []).join('\n'),
  is_active: p.is_active,
  sort_order: String(p.sort_order),
})

/** Validates the shared fields; returns an error sentence or the parsed values. */
function parseForm(f: Form) {
  const price = Number(f.price_inr)
  const hours = Number(f.duration_hours)
  const sort = Number(f.sort_order || 0)
  if (!f.name.trim()) return 'Name is required'
  if (!Number.isInteger(price) || price < 0) return 'Price must be a whole number of rupees'
  if (!Number.isFinite(hours) || hours <= 0 || hours >= 1000) return 'Duration must be between 0 and 999.9 hours'
  if (!Number.isInteger(sort)) return 'Sort order must be a whole number'
  return {
    name: f.name.trim(),
    price_inr: price,
    duration_hours: Math.round(hours * 10) / 10,
    description: f.description.trim(),
    features: f.features
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    is_active: f.is_active,
    sort_order: sort,
  }
}

export default function PackagesPage() {
  const [rows, setRows] = useState<Pkg[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('packages').select('*').order('sort_order').order('created_at')
    if (error) setError(errorMessage(error))
    else {
      setError(null)
      setRows(data ?? [])
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  return (
    <Page
      title="Packages"
      action={
        !creating && (
          <Button className="!px-3 !py-1.5" onClick={() => setCreating(true)}>
            + New
          </Button>
        )
      }
    >
      <ErrorText>{error}</ErrorText>
      {creating && (
        <NewPackage
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            load()
          }}
        />
      )}
      {!rows && !error && <PageLoader />}
      {rows && rows.length === 0 && <EmptyState title="No packages" />}
      <div className="space-y-2">
        {rows?.map((p) => (
          <PackageCard key={p.id} pkg={p} onSaved={load} />
        ))}
      </div>
    </Page>
  )
}

function PackageCard({ pkg, onSaved }: { pkg: Pkg; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Form>(() => toForm(pkg))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const open = () => {
    setForm(toForm(pkg))
    setErr(null)
    setEditing(true)
  }

  const save = async () => {
    const parsed = parseForm(form)
    if (typeof parsed === 'string') return setErr(parsed)
    setBusy(true)
    setErr(null)
    const { error } = await supabase.from('packages').update(parsed).eq('id', pkg.id)
    setBusy(false)
    if (error) setErr(errorMessage(error))
    else {
      setEditing(false)
      onSaved()
    }
  }

  const toggleActive = async () => {
    setBusy(true)
    const { error } = await supabase.from('packages').update({ is_active: !pkg.is_active }).eq('id', pkg.id)
    setBusy(false)
    if (error) setErr(errorMessage(error))
    else onSaved()
  }

  return (
    <Card className={`!p-3 ${pkg.is_active ? '' : 'opacity-70'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{pkg.name}</p>
          <p className="text-xs text-muted">
            {pkg.slug} · {pkg.category}
            {pkg.tier ? ` · ${TIER_LABEL[pkg.tier]}` : ''}
            {pkg.crew_kind ? ` · ${KIND_LABEL[pkg.crew_kind]}` : ''} · #{pkg.sort_order}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-semibold">{inr(pkg.price_inr)}</p>
          <p className="text-xs text-muted">{pkg.duration_hours} h</p>
        </div>
      </div>
      {!editing && (
        <>
          {pkg.description && <p className="mt-1 text-sm text-muted">{pkg.description}</p>}
          <div className="mt-2 flex items-center gap-2">
            <Badge tone={pkg.is_active ? 'ok' : 'neutral'}>{pkg.is_active ? 'Active' : 'Hidden'}</Badge>
            <span className="text-xs text-muted">{pkg.features?.length ?? 0} features</span>
            <div className="ml-auto flex gap-1">
              <Button variant="ghost" className="!px-2 !py-1.5" onClick={toggleActive} loading={busy}>
                {pkg.is_active ? 'Hide' : 'Show'}
              </Button>
              <Button variant="outline" className="!px-3 !py-1.5" onClick={open}>
                Edit
              </Button>
            </div>
          </div>
          <ErrorText>{err}</ErrorText>
        </>
      )}
      {editing && (
        <div className="mt-3">
          <CommonFields form={form} setForm={setForm} />
          <ErrorText>{err}</ErrorText>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button onClick={save} loading={busy}>
              Save
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

function CommonFields({ form, setForm }: { form: Form; setForm: (f: Form) => void }) {
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v })
  return (
    <>
      <Field label="Name">
        <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Price ₹">
          <Input inputMode="numeric" value={form.price_inr} onChange={(e) => set('price_inr', e.target.value)} />
        </Field>
        <Field label="Hours">
          <Input inputMode="decimal" value={form.duration_hours} onChange={(e) => set('duration_hours', e.target.value)} />
        </Field>
        <Field label="Sort">
          <Input inputMode="numeric" value={form.sort_order} onChange={(e) => set('sort_order', e.target.value)} />
        </Field>
      </div>
      <Field label="Description">
        <Input value={form.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <Field label="Features" hint="One per line">
        <Textarea rows={5} value={form.features} onChange={(e) => set('features', e.target.value)} />
      </Field>
      <label className="mb-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} className="h-4 w-4 accent-[#f5b72f]" />
        Active (visible to customers)
      </label>
    </>
  )
}

function NewPackage({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [slug, setSlug] = useState('')
  const [category, setCategory] = useState<Enums<'package_category'>>('shoot')
  const [tier, setTier] = useState<Enums<'crew_tier'>>('lite')
  const [kind, setKind] = useState<Enums<'crew_kind'>>('photographer')
  const [form, setForm] = useState<Form>({
    name: '',
    price_inr: '',
    duration_hours: '1',
    description: '',
    features: '',
    is_active: true,
    sort_order: '0',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const create = async () => {
    const cleanSlug = slug.trim().toLowerCase()
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(cleanSlug)) return setErr('Slug must be lowercase letters, numbers and dashes')
    const parsed = parseForm(form)
    if (typeof parsed === 'string') return setErr(parsed)
    setBusy(true)
    setErr(null)
    const instant = category === 'instant'
    const { error } = await supabase.from('packages').insert({
      ...parsed,
      slug: cleanSlug,
      category,
      tier: instant ? tier : null,
      crew_kind: instant ? kind : null,
    })
    setBusy(false)
    if (error) setErr(error.code === '23505' ? 'That slug is already used' : errorMessage(error))
    else onCreated()
  }

  return (
    <Card className="mb-4 border-accent/40">
      <h2 className="mb-3 font-semibold">New package</h2>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Slug">
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="e.g. reel-basic" autoCapitalize="none" />
        </Field>
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value as Enums<'package_category'>)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {category === 'instant' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Crew tier">
            <Select value={tier} onChange={(e) => setTier(e.target.value as Enums<'crew_tier'>)}>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {TIER_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Crew kind">
            <Select value={kind} onChange={(e) => setKind(e.target.value as Enums<'crew_kind'>)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
      <CommonFields form={form} setForm={setForm} />
      <ErrorText>{err}</ErrorText>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={create} loading={busy}>
          Create
        </Button>
      </div>
    </Card>
  )
}
