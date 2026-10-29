import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, errorMessage } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import type { Enums, Tables } from '../../lib/database.types'
import { formatDateTime } from '../../lib/format'
import { Badge, Card, EmptyState, ErrorText, Input, Page, PageLoader, Select } from '../../components/ui'

type Profile = Tables<'profiles'>
type Role = Enums<'user_role'>
const ROLES: Role[] = ['customer', 'crew', 'admin']
const ROLE_FILTERS: (Role | 'all')[] = ['all', ...ROLES]

export default function UsersPage() {
  const { profile: me, refreshProfile } = useAuth()
  const [rows, setRows] = useState<Profile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(1000)
    if (error) setError(errorMessage(error))
    else {
      setError(null)
      setRows(data ?? [])
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase()
    const digits = term.replace(/\D/g, '')
    return (rows ?? []).filter((p) => {
      if (roleFilter !== 'all' && p.role !== roleFilter) return false
      if (!term) return true
      if ((p.full_name ?? '').toLowerCase().includes(term)) return true
      if ((p.phone ?? '').toLowerCase().includes(term)) return true
      return digits.length >= 3 && (p.phone ?? '').replace(/\D/g, '').includes(digits)
    })
  }, [rows, q, roleFilter])

  const changeRole = async (p: Profile, role: Role) => {
    if (role === p.role) return
    const who = p.full_name || p.phone || 'this user'
    if (role === 'admin' && !window.confirm(`Give ${who} full admin access? They will see every booking and customer.`)) return
    if (p.id === me?.id && !window.confirm('You are removing your own admin access. You will lose this console. Continue?')) return
    if (role === 'crew' && !window.confirm(`Set ${who} to crew? Approve their crew application on the Crew tab so they can take jobs.`)) return
    setBusyId(p.id)
    setError(null)
    const { error } = await supabase.rpc('admin_set_role', { p_user_id: p.id, p_role: role })
    setBusyId(null)
    if (error) setError(errorMessage(error))
    else {
      setRows((rs) => (rs ?? []).map((r) => (r.id === p.id ? { ...r, role } : r)))
      if (p.id === me?.id) refreshProfile()
    }
  }

  return (
    <Page title="Users" action={rows && <span className="text-xs text-muted">{rows.length} total</span>}>
      <Input placeholder="Search name or phone…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-2" />
      <div className="mb-3 flex gap-2">
        {ROLE_FILTERS.map((r) => (
          <button
            key={r}
            onClick={() => setRoleFilter(r)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold capitalize ${
              roleFilter === r ? 'border-accent bg-accent/15 text-accent' : 'border-line text-muted'
            }`}
          >
            {r}
          </button>
        ))}
      </div>
      <ErrorText>{error}</ErrorText>
      {!rows && !error && <PageLoader />}
      {rows && visible.length === 0 && <EmptyState title="No users found" />}
      <div className="space-y-2">
        {visible.map((p) => (
          <Card key={p.id} className="!p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">
                  {p.full_name || 'Unnamed'} {p.id === me?.id && <span className="text-xs text-muted">(you)</span>}
                </p>
                <p className="truncate text-sm text-muted">
                  {p.phone ? (
                    <a href={`tel:${p.phone.replace(/[^\d+]/g, '')}`} className="text-accent">
                      {p.phone}
                    </a>
                  ) : (
                    'No phone'
                  )}
                </p>
                <p className="text-xs text-muted">Joined {formatDateTime(p.created_at)}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <Badge tone={p.role === 'admin' ? 'bad' : p.role === 'crew' ? 'accent' : 'neutral'}>{p.role}</Badge>
                <Select
                  value={p.role}
                  disabled={busyId === p.id}
                  onChange={(e) => changeRole(p, e.target.value as Role)}
                  className="!w-32 !py-1.5 !text-sm capitalize"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </Page>
  )
}
