import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

// The publishable key is safe to ship in the browser; RLS and RPC checks protect the data.
const url = (import.meta.env.VITE_SUPABASE_URL as string) || 'https://zzhvzrcwogvhbpqflwqb.supabase.co'
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) || 'sb_publishable_c-BUH7hUGXjc5pJEzrDDiw_ILtqTUf9'

if (!url || !key) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. Copy app/.env.example to app/.env.')
}

export const supabase = createClient<Database>(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

/** Turns a Supabase/Postgres error into a sentence a customer can read. */
export function errorMessage(err: unknown): string {
  if (!err) return 'Something went wrong'
  if (typeof err === 'string') return err
  if (typeof err === 'object' && err && 'message' in err) return String((err as { message: unknown }).message)
  return 'Something went wrong'
}
