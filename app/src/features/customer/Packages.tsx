import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { inr } from '../../lib/format'
import { Button, Card, EmptyState, ErrorText, Page, PageLoader } from '../../components/ui'
import { usePackages } from './shared'

export default function Packages() {
  const navigate = useNavigate()
  const { packages, error } = usePackages(['shoot', 'wedding'])
  const [tab, setTab] = useState<'shoot' | 'wedding'>('shoot')
  const list = packages?.filter((p) => p.category === tab) ?? []

  return (
    <Page title="Packages">
      <div className="mb-4 grid grid-cols-2 rounded-xl border border-line bg-panel p-1">
        {(['shoot', 'wedding'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg py-2 text-sm font-semibold ${tab === t ? 'bg-accent text-black' : 'text-muted'}`}
          >
            {t === 'shoot' ? 'Shoots' : 'Weddings'}
          </button>
        ))}
      </div>
      <ErrorText>{error}</ErrorText>
      {!packages ? (
        <PageLoader />
      ) : list.length === 0 ? (
        <EmptyState title="No packages here yet" />
      ) : (
        <div className="grid gap-3">
          {list.map((p) => (
            <Card key={p.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-bold">{p.name}</p>
                  <p className="text-sm text-muted">{p.description}</p>
                </div>
                <p className="shrink-0 text-lg font-extrabold text-accent">{inr(p.price_inr)}</p>
              </div>
              {p.features.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <span className="text-accent">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
              )}
              <Button block className="mt-4" onClick={() => navigate(`/book?package=${p.slug}`)}>
                Book {p.name}
              </Button>
            </Card>
          ))}
        </div>
      )}
    </Page>
  )
}
