import { useEffect, useState } from 'react'
import { applyTheme, readTheme, type Theme } from './theme'

/**
 * Coquille de la phase 0.
 *
 * Elle ne prétend pas être l'application : elle vérifie que les fondations
 * tiennent — les jetons de design s'appliquent, le thème bascule, et le
 * navigateur nous accorde bien un stockage persistant. L'éditeur et la
 * sidebar arrivent en phase 2 et remplaceront ce fichier.
 */
export function App() {
  const [theme, setTheme] = useState<Theme>(readTheme)
  const [persistence, setPersistence] = useState<'inconnu' | 'accordé' | 'refusé'>('inconnu')

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    let cancelled = false
    // Demandé une seule fois au démarrage : sans stockage persistant, Safari
    // peut évincer les notes après quelques semaines sans visite.
    navigator.storage
      ?.persist?.()
      .then((granted) => {
        if (!cancelled) setPersistence(granted ? 'accordé' : 'refusé')
      })
      .catch(() => {
        if (!cancelled) setPersistence('refusé')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex min-h-full flex-col bg-surface text-ink">
      <header className="flex items-center justify-between border-b border-line px-5 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-md font-semibold tracking-tight">Nook</span>
          <span className="text-xs text-ink-faint">phase 0 — fondations</span>
        </div>
        <ThemePicker value={theme} onChange={setTheme} />
      </header>

      <main className="mx-auto w-full max-w-(--nook-measure) flex-1 px-5 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Vos notes, sur votre machine.</h1>
        <p className="mt-3 text-base text-ink-muted">
          Nook est une application entièrement locale. Aucune donnée ne sort du navigateur, et la
          politique de sécurité de la page interdit purement et simplement toute requête sortante.
        </p>

        <dl className="mt-10 grid gap-px overflow-hidden rounded-lg border border-line bg-line">
          <Row label="Stockage" value="IndexedDB, sur cet appareil" />
          <Row label="Réseau" value="Aucune requête sortante autorisée" />
          <Row
            label="Persistance accordée"
            value={
              persistence === 'inconnu'
                ? 'vérification…'
                : persistence === 'accordé'
                  ? 'oui — le navigateur ne videra pas vos notes'
                  : 'non — pensez à exporter régulièrement'
            }
          />
        </dl>
      </main>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 bg-surface px-4 py-3">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  )
}

const THEMES: readonly { value: Theme; label: string }[] = [
  { value: 'system', label: 'Système' },
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' },
]

function ThemePicker({ value, onChange }: { value: Theme; onChange: (theme: Theme) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Thème"
      className="flex items-center gap-0.5 rounded-lg border border-line bg-sunken p-0.5"
    >
      {THEMES.map((theme) => {
        const selected = theme.value === value
        return (
          <button
            key={theme.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(theme.value)}
            className={[
              'rounded-sm px-2.5 py-1 text-xs transition-colors duration-(--nook-dur-fast) ease-nook',
              selected
                ? 'bg-raised text-ink shadow-menu'
                : 'text-ink-muted hover:bg-hover hover:text-ink',
            ].join(' ')}
          >
            {theme.label}
          </button>
        )
      })}
    </div>
  )
}
