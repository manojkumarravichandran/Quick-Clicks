import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { inr, STATUS_LABEL } from '../../lib/format'
import { ErrorText, Spinner } from '../../components/ui'
import { useActiveBooking, usePackages } from './shared'

export default function Home() {
  const { session, signOut } = useAuth()
  const active = useActiveBooking()
  const { packages, error } = usePackages(['shoot', 'wedding'])

  return (
    <div className="px-4 pb-6">
      <header className="flex items-center justify-between py-4">
        <span className="text-lg font-extrabold tracking-tight">
          Quick<span className="text-accent">Clicks</span>
        </span>
        {session ? (
          <button onClick={() => signOut()} className="text-sm text-muted hover:text-text">
            Sign out
          </button>
        ) : (
          <Link to="/signin" className="text-sm font-semibold text-accent">
            Sign in
          </Link>
        )}
      </header>

      <section className="pt-4 pb-6">
        <h1 className="text-3xl font-extrabold leading-tight">
          Photographers on demand, <span className="text-accent">across Bengaluru.</span>
        </h1>
        <p className="mt-2 text-sm text-muted">
          Book someone nearby right now, or schedule a shoot or wedding in advance.
        </p>
      </section>

      {active && (
        <Link to={`/bookings/${active.id}`} className="mb-5 block rounded-2xl border border-accent/50 bg-accent/10 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-accent">Your active booking</p>
          <p className="mt-1 font-semibold">{active.packages?.name ?? 'Shoot'}</p>
          <p className="text-sm text-muted">{STATUS_LABEL[active.status]} · Tap to track →</p>
        </Link>
      )}

      <div className="grid gap-3">
        <Link
          to="/instant"
          className="block rounded-2xl bg-accent p-5 text-black transition active:scale-[0.99]"
        >
          <p className="text-xl font-extrabold">Instant shoot ⚡</p>
          <p className="text-sm opacity-80">See who's online near you and request them</p>
        </Link>
        <Link
          to="/book"
          className="block rounded-2xl border border-line bg-panel p-5 transition hover:border-accent active:scale-[0.99]"
        >
          <p className="text-xl font-extrabold">Schedule a shoot</p>
          <p className="text-sm text-muted">Pick a package, date and place</p>
        </Link>
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-base font-bold">Packages</h2>
          <Link to="/packages" className="text-sm text-accent">
            See all →
          </Link>
        </div>
        <ErrorText>{error}</ErrorText>
        {!packages ? (
          <div className="py-6 text-center">
            <Spinner />
          </div>
        ) : packages.length === 0 ? (
          <p className="text-sm text-muted">No packages available right now.</p>
        ) : (
          <div className="grid gap-2">
            {packages.map((p) => (
              <Link
                key={p.id}
                to={`/book?package=${p.slug}`}
                className="flex items-center justify-between rounded-xl border border-line bg-panel px-4 py-3 hover:border-accent"
              >
                <span>
                  <span className="block font-semibold">{p.name}</span>
                  <span className="block text-xs text-muted">{p.description}</span>
                </span>
                <span className="shrink-0 pl-3 font-bold text-accent">{inr(p.price_inr)}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
