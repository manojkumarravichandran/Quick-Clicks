import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'outline' | 'ghost' | 'danger'
  loading?: boolean
  block?: boolean
}

export function Button({ variant = 'primary', loading, block, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100',
        variant === 'primary' && 'bg-accent text-black hover:bg-accent-2',
        variant === 'outline' && 'border border-line bg-transparent text-text hover:border-accent',
        variant === 'ghost' && 'bg-transparent text-muted hover:text-text',
        variant === 'danger' && 'border border-bad/40 bg-bad/10 text-bad hover:bg-bad/20',
        block && 'w-full',
        className,
      )}
    >
      {loading && <Spinner small />}
      {children}
    </button>
  )
}

export function Card({ className, children, onClick }: { className?: string; children: ReactNode; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={cx('rounded-2xl border border-line bg-panel p-4', onClick && 'cursor-pointer active:scale-[0.99]', className)}
    >
      {children}
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

const inputCls =
  'w-full rounded-xl border border-line bg-panel-2 px-3.5 py-3 text-[15px] text-text outline-none placeholder:text-muted/60 focus:border-accent'

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, p.className)} />
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(inputCls, p.className)} />
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea rows={3} {...p} className={cx(inputCls, 'resize-none', p.className)} />
)

export function Spinner({ small }: { small?: boolean }) {
  return (
    <span
      className={cx('inline-block animate-spin rounded-full border-2 border-line border-t-accent', small ? 'h-4 w-4' : 'h-6 w-6')}
      aria-label="Loading"
    />
  )
}

export function PageLoader() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner />
    </div>
  )
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null
  return <p className="my-3 rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{children}</p>
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'ok' | 'bad' }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
        tone === 'neutral' && 'bg-panel-2 text-muted',
        tone === 'accent' && 'bg-accent/15 text-accent',
        tone === 'ok' && 'bg-ok/15 text-ok',
        tone === 'bad' && 'bg-bad/15 text-bad',
      )}
    >
      {children}
    </span>
  )
}

/** Standard page wrapper: sticky title bar + padded content. */
export function Page({ title, action, children }: { title?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="pb-6">
      {title && (
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line/60 bg-ink/90 px-4 py-3 backdrop-blur">
          <h1 className="text-lg font-bold">{title}</h1>
          {action}
        </header>
      )}
      <div className="px-4 pt-4">{children}</div>
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-4 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  )
}
