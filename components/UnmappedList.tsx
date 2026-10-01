'use client'

import type { TripItem } from '@/lib/types'

/**
 * The places the map cannot place.
 *
 * An item with no coordinate has no pin, so without this list it is counted in
 * "N without a location" and then unreachable. Shared by the itinerary and
 * Around Town: one list, so a fix to it reaches both.
 *
 * Every row carries its own actions, because selecting an item with no
 * coordinate opens no InfoWindow - there is nowhere on the map to open it. On
 * Around Town with the coordinate table unfilled that is EVERY row, so without
 * these two links the whole list is inert: she can read 410 names and do
 * nothing with any of them. Look it up in Maps, or open the Notion row.
 */
export default function UnmappedList({
  items,
  onSelect,
  dotColor,
  subtitle,
  note,
  /** Extra context for the Maps search, e.g. the city or neighborhood. */
  searchContext,
  onFind,
}: {
  items: TripItem[]
  onSelect: (item: TripItem) => void
  /** Left dot colour. Trip items use status; Around Town uses preference. */
  dotColor: (item: TripItem) => string
  subtitle: (item: TripItem) => string
  note?: string
  searchContext?: (item: TripItem) => string
  /** When given, each row gets a "Find it" button that opens the pin lookup for it. */
  onFind?: (item: TripItem) => void
}) {
  if (items.length === 0) return null

  function mapsHref(item: TripItem): string {
    const extra = searchContext?.(item) ?? item.legCity
    const query = [item.venue || item.name, extra].filter(Boolean).join(', ')
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
  }

  return (
    <section className="border-t border-white/10 px-4 py-4">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/35">
        Not on the map
      </p>
      {note && <p className="mb-2 text-xs text-white/30">{note}</p>}
      {items.map(item => (
        <div
          key={item.id}
          className="flex items-start gap-2.5 rounded-md px-1.5 py-2 transition-colors hover:bg-white/5"
        >
          <span
            className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full"
            style={{ background: dotColor(item) }}
          />
          <button onClick={() => onSelect(item)} className="min-w-0 flex-1 text-left">
            <span className="block text-sm font-medium text-white">{item.name}</span>
            <span className="block text-xs text-white/40">{subtitle(item)}</span>
          </button>
          <span className="flex flex-shrink-0 items-center gap-2 pt-0.5">
            {onFind && (
              <button
                onClick={() => onFind(item)}
                className="text-[11px] font-semibold text-amber-300 transition-colors hover:text-amber-200"
                title="Look this place up and give it a pin"
              >
                Find it
              </button>
            )}
            <a
              href={mapsHref(item)}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] font-medium text-white/40 transition-colors hover:text-amber-400"
              title="Search this place in Google Maps"
            >
              Maps
            </a>
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] font-medium text-white/40 transition-colors hover:text-amber-400"
              title="Open the Notion row"
            >
              Notion
            </a>
          </span>
        </div>
      ))}
    </section>
  )
}
