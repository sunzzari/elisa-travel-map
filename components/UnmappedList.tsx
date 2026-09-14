'use client'

import type { TripItem } from '@/lib/types'

/**
 * The places the map cannot place.
 *
 * An item with no coordinate has no pin, so without this list it is counted in
 * "N without a location" and then unreachable. Shared by the itinerary and
 * Around Town: one list, so a fix to it reaches both.
 */
export default function UnmappedList({
  items,
  onSelect,
  dotColor,
  subtitle,
  note,
}: {
  items: TripItem[]
  onSelect: (item: TripItem) => void
  /** Left dot colour. Trip items use status; Around Town uses preference. */
  dotColor: (item: TripItem) => string
  subtitle: (item: TripItem) => string
  note?: string
}) {
  if (items.length === 0) return null

  return (
    <section className="border-t border-white/10 px-4 py-4">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/35">
        Not on the map
      </p>
      {note && <p className="mb-2 text-xs text-white/30">{note}</p>}
      {items.map(item => (
        <button
          key={item.id}
          onClick={() => onSelect(item)}
          className="flex w-full gap-2.5 rounded-md px-1.5 py-2 text-left transition-colors hover:bg-white/5"
        >
          <span
            className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full"
            style={{ background: dotColor(item) }}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-white">{item.name}</span>
            <span className="block text-xs text-white/40">{subtitle(item)}</span>
          </span>
        </button>
      ))}
    </section>
  )
}
