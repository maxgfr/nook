import { lazy, Suspense, useEffect, useState } from 'react'
import { VaultProvider, useVault, useVaultIndex, type BootState } from './VaultProvider'
import { useNavigate, useOpenDocId } from './router'
import { applyTheme, readTheme, type Theme } from './theme'
import { Sidebar } from '../sidebar/Sidebar'
import { Button } from '../design/Button'
import { Icon } from '../design/Icon'

/**
 * L'éditeur pèse à lui seul l'essentiel du poids de l'application. Le sortir
 * du chargement initial fait apparaître la barre latérale immédiatement, et
 * son morceau n'est cherché qu'à l'ouverture d'une page. Le service worker
 * l'ayant précaché, l'application reste utilisable hors connexion.
 */
const DocEditor = lazy(() =>
  import('../editor/DocEditor').then((module) => ({ default: module.DocEditor })),
)

export function App() {
  const [theme, setTheme] = useState<Theme>(readTheme)
  useEffect(() => applyTheme(theme), [theme])

  return (
    <VaultProvider fallback={Boot}>
      <Workspace theme={theme} onThemeChange={setTheme} />
    </VaultProvider>
  )
}

function Workspace({ theme, onThemeChange }: { theme: Theme; onThemeChange: (t: Theme) => void }) {
  const openId = useOpenDocId()
  const navigate = useNavigate()
  const index = useVaultIndex()

  // Une page supprimée dans un autre onglet, ou une adresse partagée qui ne
  // correspond à rien : on retombe sur l'accueil plutôt que d'afficher une
  // erreur pour un identifiant qui n'existe simplement plus.
  const current = openId && index.docs[openId] ? openId : null

  return (
    <div className="flex h-full">
      <Sidebar openId={current} onOpen={navigate} />
      <main className="flex min-w-0 flex-1 flex-col">
        {current ? (
          <Suspense fallback={<div className="flex-1" aria-busy="true" />}>
            <DocEditor docId={current} />
          </Suspense>
        ) : (
          <Welcome />
        )}
      </main>
      <ThemePicker value={theme} onChange={onThemeChange} />
    </div>
  )
}

/**
 * État vide de l'application.
 *
 * Il enseigne l'interface au lieu de constater son vide : la seule action
 * utile est proposée, et la promesse du produit est rappelée là où elle se
 * vérifie — au premier lancement, quand on décide de faire confiance.
 */
function Welcome() {
  const vault = useVault()
  const navigate = useNavigate()

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <Icon name="page" className="size-7 text-ink-faint" />
      <h1 className="mt-4 text-lg font-semibold tracking-tight">Aucune page ouverte</h1>
      <p className="mt-2 max-w-sm text-sm text-ink-muted">
        Vos pages sont chiffrées et rangées sur cet appareil. Rien n'est envoyé nulle part — la page
        s'interdit toute requête sortante.
      </p>
      <Button
        tone="primary"
        className="mt-6"
        onClick={() => void vault.createDoc().then((doc) => navigate(doc.id))}
      >
        Nouvelle page
      </Button>
    </div>
  )
}

function Boot({ state }: { state: BootState }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      {state.status === 'opening' ? (
        // Volontairement muet : ouvrir le coffre prend quelques millisecondes,
        // et un message de chargement qui clignote est pire que rien.
        <span className="sr-only">Ouverture du coffre…</span>
      ) : (
        <div className="max-w-md">
          <h1 className="text-md font-semibold tracking-tight">Le coffre n'a pas pu s'ouvrir</h1>
          <p className="mt-2 text-sm text-ink-muted">{state.error.message}</p>
          <p className="mt-4 text-xs text-ink-faint">
            Si une autre fenêtre de Nook est ouverte, fermez-la puis rechargez.
          </p>
        </div>
      )}
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
      className="fixed right-3 bottom-3 flex items-center gap-0.5 rounded-lg border border-line bg-raised/90 p-0.5 backdrop-blur-sm"
    >
      {THEMES.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={[
              'rounded-sm px-2 py-1 text-2xs transition-colors duration-(--nook-dur-fast) ease-nook',
              selected ? 'bg-hover text-ink' : 'text-ink-faint hover:text-ink',
            ].join(' ')}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
