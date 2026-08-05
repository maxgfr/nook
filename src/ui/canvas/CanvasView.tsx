import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { normalize } from '../../core/model/facets'
import { UNTITLED, type DocId, type Point } from '../../core/model/types'
import { useVault, useVaultIndex } from '../app/VaultProvider'
import { Button } from '../design/Button'

/**
 * The map: every page as a card on a plane you can pan and zoom, with a line
 * for every link between them.
 *
 * This is one surface rather than two. A graph of links and an infinite canvas
 * of notes are the same thing seen from different angles — cards you move,
 * joined by lines, on a plane you travel. Building them separately would have
 * produced two half-features that each did what the other could.
 *
 * Nothing is placed until someone places it. Pages start on a spiral derived
 * from their position in the tree, so the map is useful the first time it is
 * opened; dragging a card is what turns the layout into a decision worth
 * storing.
 */

const CARD_WIDTH = 160
const CARD_HEIGHT = 56

export function CanvasView({
  onOpen,
  onClose,
}: {
  onOpen: (id: DocId) => void
  onClose: () => void
}) {
  const vault = useVault()
  const index = useVaultIndex()
  const surface = useRef<HTMLDivElement>(null)

  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 })
  const [dragging, setDragging] = useState<{ id: DocId; dx: number; dy: number } | null>(null)
  const [panning, setPanning] = useState<{ x: number; y: number } | null>(null)
  /** Positions being dragged, before they are committed to the vault. */
  const [preview, setPreview] = useState<Record<DocId, Point>>({})

  const docs = useMemo(() => Object.values(index.docs), [index])

  const placed = useMemo(() => {
    const map = new Map<DocId, Point>()
    docs.forEach((doc, order) => {
      const stored = preview[doc.id] ?? index.positions[doc.id]
      map.set(doc.id, stored ?? spiral(order))
    })
    return map
  }, [docs, index.positions, preview])

  const edges = useMemo(() => {
    const byTitle = new Map<string, DocId>()
    for (const doc of docs) {
      const title = normalize(doc.title)
      if (title !== '') byTitle.set(title, doc.id)
    }

    const lines: { from: DocId; to: DocId }[] = []
    for (const doc of docs) {
      for (const link of index.facets[doc.id]?.links ?? []) {
        const target = byTitle.get(link)
        if (target && target !== doc.id) lines.push({ from: doc.id, to: target })
      }
    }
    return lines
  }, [docs, index.facets])

  /**
   * The first view frames what is there.
   *
   * Cards sit on a spiral around the origin, so most of them have a negative
   * coordinate in one axis or the other — and a camera at 0,0 puts that origin
   * in the *corner* of the screen. Opening the map on a notebook of two pages
   * showed one of them, cut in half, against an otherwise empty plane: the
   * layout was right and nobody could see it.
   *
   * So the camera opens on the middle of the cards, pulled back far enough to
   * hold them all. Never past 1, because filling the screen with two enormous
   * cards is its own kind of useless, and never below 0.35, past which a title
   * stops being readable and the map stops being a map.
   *
   * Once, at the first frame that has something to frame — the notebook may
   * still be arriving on mount. After that the view is wherever it has been
   * dragged to, which is a decision worth keeping, so the guard is a ref and
   * not a dependency: `placed` changes on every drag.
   */
  const framed = useRef(false)

  useLayoutEffect(() => {
    if (framed.current) return
    const box = surface.current?.getBoundingClientRect()
    if (!box || box.width === 0 || placed.size === 0) return
    framed.current = true

    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    for (const point of placed.values()) {
      left = Math.min(left, point.x)
      top = Math.min(top, point.y)
      right = Math.max(right, point.x + CARD_WIDTH)
      bottom = Math.max(bottom, point.y + CARD_HEIGHT)
    }

    const margin = 56
    const zoom = Math.min(
      1,
      Math.max(
        0.35,
        Math.min(
          (box.width - margin * 2) / Math.max(right - left, 1),
          (box.height - margin * 2) / Math.max(bottom - top, 1),
        ),
      ),
    )

    setCamera({
      zoom,
      // `scale(zoom) translate(x, y)` from the top left, so a world point lands
      // at `zoom × (point + camera)`; this puts the middle of the cards in the
      // middle of the surface.
      x: box.width / (2 * zoom) - (left + right) / 2,
      y: box.height / (2 * zoom) - (top + bottom) / 2,
    })
  }, [placed])

  const toWorld = (clientX: number, clientY: number) => {
    const box = surface.current?.getBoundingClientRect()
    return {
      x: (clientX - (box?.left ?? 0)) / camera.zoom - camera.x,
      y: (clientY - (box?.top ?? 0)) / camera.zoom - camera.y,
    }
  }

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-sunken">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4">
        <span className="text-sm font-medium">Map</span>
        <div className="flex items-center gap-2">
          <span className="text-2xs text-ink-faint">
            Drag to move · scroll to zoom · click a card to open it
          </span>
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </header>

      <div
        ref={surface}
        // `touch-none` so a drag on a trackpad or touchscreen moves a card
        // instead of scrolling the page out from under it.
        className="relative flex-1 touch-none overflow-hidden"
        onWheel={(event) => {
          const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1
          setCamera((current) => ({
            ...current,
            zoom: Math.min(2.5, Math.max(0.2, current.zoom * factor)),
          }))
        }}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            setPanning({ x: event.clientX, y: event.clientY })
            event.currentTarget.setPointerCapture(event.pointerId)
          }
        }}
        onPointerMove={(event) => {
          if (panning) {
            const dx = (event.clientX - panning.x) / camera.zoom
            const dy = (event.clientY - panning.y) / camera.zoom
            setPanning({ x: event.clientX, y: event.clientY })
            setCamera((current) => ({ ...current, x: current.x + dx, y: current.y + dy }))
          } else if (dragging) {
            const world = toWorld(event.clientX, event.clientY)
            setPreview((current) => ({
              ...current,
              [dragging.id]: { x: world.x - dragging.dx, y: world.y - dragging.dy },
            }))
          }
        }}
        onPointerUp={() => {
          setPanning(null)
          if (dragging) {
            const point = preview[dragging.id]
            // Written once, when the drag ends: a save per pointer move would
            // encrypt and store the whole index dozens of times a second.
            if (point) void vault.placeOnCanvas(dragging.id, point)
            setDragging(null)
          }
        }}
      >
        <div
          className="absolute origin-top-left"
          style={{
            transform: `scale(${camera.zoom}) translate(${camera.x}px, ${camera.y}px)`,
          }}
        >
          <svg
            className="pointer-events-none absolute overflow-visible"
            width="1"
            height="1"
            aria-hidden="true"
          >
            {edges.map((edge, position) => {
              const from = placed.get(edge.from)
              const to = placed.get(edge.to)
              if (!from || !to) return null
              return (
                <line
                  key={`${edge.from}-${edge.to}-${position}`}
                  x1={from.x + CARD_WIDTH / 2}
                  y1={from.y + CARD_HEIGHT / 2}
                  x2={to.x + CARD_WIDTH / 2}
                  y2={to.y + CARD_HEIGHT / 2}
                  stroke="var(--nook-border-strong)"
                  strokeWidth="1.5"
                />
              )
            })}
          </svg>

          {docs.map((doc) => {
            const point = placed.get(doc.id) ?? { x: 0, y: 0 }
            return (
              <button
                key={doc.id}
                type="button"
                onPointerDown={(event) => {
                  event.stopPropagation()
                  const world = toWorld(event.clientX, event.clientY)
                  setDragging({ id: doc.id, dx: world.x - point.x, dy: world.y - point.y })
                  event.currentTarget.setPointerCapture(event.pointerId)
                }}
                onPointerMove={(event) => {
                  if (dragging?.id !== doc.id) return
                  const world = toWorld(event.clientX, event.clientY)
                  setPreview((current) => ({
                    ...current,
                    [doc.id]: { x: world.x - dragging.dx, y: world.y - dragging.dy },
                  }))
                }}
                onPointerUp={(event) => {
                  event.stopPropagation()
                  const moved = preview[doc.id]
                  if (moved) void vault.placeOnCanvas(doc.id, moved)
                  else onOpen(doc.id)
                  setDragging(null)
                }}
                style={{ left: point.x, top: point.y, width: CARD_WIDTH, minHeight: CARD_HEIGHT }}
                className="absolute cursor-grab rounded-lg border border-line bg-raised px-3 py-2 text-left text-sm shadow-menu active:cursor-grabbing"
              >
                <span className="line-clamp-2 break-words">{doc.title || UNTITLED}</span>
              </button>
            )
          })}
        </div>

        {docs.length === 0 && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-ink-faint">
            No pages to map yet.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * A starting place for a page nobody has positioned.
 *
 * A spiral rather than a grid: it spreads cards evenly in every direction, so a
 * map opens legible at any zoom instead of as a long column that has to be
 * scrolled before it means anything.
 */
function spiral(order: number): Point {
  const angle = order * 2.399963 // the golden angle, in radians
  const radius = 120 * Math.sqrt(order + 1)
  return { x: Math.round(Math.cos(angle) * radius), y: Math.round(Math.sin(angle) * radius) }
}
