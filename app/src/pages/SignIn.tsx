import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { supabase, errorMessage } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Button, ErrorText, Field, Input, Page } from '../components/ui'

/**
 * Passwordless email sign-in. Supabase emails a magic link (and a 6-digit code if
 * the email template includes {{ .Token }}). Either one signs the user in.
 */
export default function SignIn() {
  const { session } = useAuth()
  const location = useLocation()
  const next = new URLSearchParams(location.search).get('next') || '/'
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (session) return <Navigate to={next} replace />

  async function sendLink(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: window.location.origin + next,
        data: name.trim() ? { full_name: name.trim() } : undefined,
      },
    })
    setBusy(false)
    if (error) setError(errorMessage(error))
    else setSent(true)
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' })
    setBusy(false)
    if (error) setError(errorMessage(error))
  }

  return (
    <Page title="Sign in">
      {!sent ? (
        <form onSubmit={sendLink}>
          <p className="mb-5 text-sm text-muted">We'll email you a sign-in link. No password needed.</p>
          <Field label="Your name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Asha Rao" autoComplete="name" />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" block loading={busy}>
            Email me a sign-in link
          </Button>
        </form>
      ) : (
        <form onSubmit={verifyCode}>
          <p className="mb-5 text-sm text-muted">
            Check <span className="text-text">{email}</span>. Tap the link in the email, or enter the code from it below.
          </p>
          <Field label="Code from email">
            <Input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" block loading={busy} disabled={code.trim().length < 6}>
            Sign in with code
          </Button>
          <Button type="button" variant="ghost" block className="mt-2" onClick={() => setSent(false)}>
            Use a different email
          </Button>
        </form>
      )}
    </Page>
  )
}
