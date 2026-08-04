import { DEFAULT_SNAPSHOT_INTERVAL_MINUTES } from '../../core/model/types'

/**
 * How often the automatic rule files a snapshot, and whether it does at all.
 *
 * Read at the moment of each save rather than once at startup, so changing it
 * in Settings takes effect on the next keystroke instead of on the next reload.
 * A `localStorage` read costs nothing next to encrypting and writing a
 * document, which is what the same call is about to do.
 *
 * Per device, like the theme. It describes how this browser should behave, not
 * anything about the notes, and it is deliberately outside the vault so that
 * nothing here can make a notebook unreadable.
 */

export type SnapshotPolicy = {
  readonly automatic: boolean
  readonly everyMinutes: number
}

export const DEFAULT_SNAPSHOT_POLICY: SnapshotPolicy = {
  automatic: true,
  everyMinutes: DEFAULT_SNAPSHOT_INTERVAL_MINUTES,
}

/**
 * Below a minute the automatic rule stops coalescing anything and the twenty
 * slots are spent in twenty saves; above a week it has stopped being automatic
 * in any useful sense. Both ends are clamped rather than refused, because a
 * stored value out of range must still produce sane behaviour.
 */
const MIN_MINUTES = 1
const MAX_MINUTES = 7 * 24 * 60

const STORAGE_KEY = 'nook.snapshots'

function clamp(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_SNAPSHOT_INTERVAL_MINUTES
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(minutes)))
}

export function readSnapshotPolicy(): SnapshotPolicy {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (typeof stored !== 'object' || stored === null) return DEFAULT_SNAPSHOT_POLICY

    const candidate = stored as Partial<SnapshotPolicy>
    return {
      automatic: typeof candidate.automatic === 'boolean' ? candidate.automatic : true,
      everyMinutes: clamp(
        typeof candidate.everyMinutes === 'number'
          ? candidate.everyMinutes
          : DEFAULT_SNAPSHOT_INTERVAL_MINUTES,
      ),
    }
  } catch {
    // Storage blocked, or a hand-edited value: the default keeps history
    // working rather than switching it off behind the reader's back.
    return DEFAULT_SNAPSHOT_POLICY
  }
}

export function writeSnapshotPolicy(policy: SnapshotPolicy): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ automatic: policy.automatic, everyMinutes: clamp(policy.everyMinutes) }),
    )
  } catch {
    // The choice holds for this session and is simply not remembered.
  }
}
