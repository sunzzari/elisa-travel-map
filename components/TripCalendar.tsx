'use client'

import { formatLongDate } from '@/lib/day'
import { ALL_DAY } from '@/lib/time'
import type { PlannedItem } from '@/lib/day'
import type { TripPlan } from '@/lib/plan'
import type { TripItem } from '@/lib/types'
import { STATUS_DOT } from './PlanPanel'

// The trip as a calendar: one column per day, one row per block of the day.
// Elisa, 2026-10-18: "a trip calendar that is by day, by block, and the things
// that are confirmed. then you should be able to click on the day or each event
// to see things on the travel map."
//
// It shows her plans (Booked, Planned, To book), each in its status colour;
// tapping the Booked tile or the Confirmed chip narrows it to booked only. A
// rough time ("lunch", "evening") lands in its block by the same anchors the
// day view sorts by (lib/time.ts), and is shown as the word, never a clock.

interface Block {
  id: string
  label: string
  holds: (p: PlannedItem) => boolean
}

const BLOCKS: Block[] = [
  { id: 'allday', label: 'All day', holds: p => !p.time.anytime && p.time.sortKey === ALL_DAY },
  { id: 'morning', label: 'Morning', holds: p => !p.time.anytime && p.time.sortKey >= 0 && p.time.sortKey < 11 * 60 },
  { id: 'midday', label: 'Midday', holds: p => !p.time.anytime && p.time.sortKey >= 11 * 60 && p.time.sortKey < 14 * 60 },
  { id: 'afternoon', label: 'Afternoon', holds: p => !p.time.anytime && p.time.sortKey >= 14 * 60 && p.time.sortKey < 17 * 60 },
  { id: 'evening', label: 'Evening', holds: p => !p.time.anytime && p.time.sortKey >= 17 * 60 && p.time.sortKey < 21 * 60 },
  { id: 'night', label: 'Night', holds: p => !p.time.anytime && p.time.sortKey >= 21 * 60 },
  { id: 'anytime', label: 'Any time', holds: p => p.time.anytime },
]

interface Props {
  plan: TripPlan
  matches: (i: TripItem) => boolean
  selectedDate: string | null
  onSelectDate: (date: string | null) => void
  selected: TripItem | null
  onSelectItem: (item: TripItem, date: string) => void
  today: string
  /** Days holding a search match, lit up while searching. */
  highlightDates?: Set<string>
}

export default function TripCalendar({ plan, matches, selectedDate, onSelectDate, selected, onSelectItem, today, highlightDates }: Props) {
  if (plan.days.length === 0) {
    return <p className="px-4 py-6 text-sm text-white/40">This trip has no dates yet, so there is no calendar to draw.</p>
  }

  // Events per day, hotels pulled into their own Sleeping row.
  const events = plan.days.map(d => d.committed.filter(p => p.item.type !== 'Hotel' && matches(p.item)))
  const rows = BLOCKS.filter(b => events.some(list => list.some(b.holds)))
  const anyHotel = plan.days.some(d => d.isNight && d.hotel && matches(d.hotel))

  const cols = `5.5rem repeat(${plan.days.length}, minmax(8.5rem, 11rem))`

  return (
    <div className="px-3 py-3">
      <div className="grid gap-px overflow-hidden rounded-lg bg-white/10" style={{ gridTemplateColumns: cols }}>
        {/* Day headers: tap to put that day on the map, tap again for all. */}
        <div className="sticky left-0 z-10 bg-gray-950" />
        {plan.days.map(d => {
          const on = selectedDate === d.date
          return (
            <button
              key={d.date}
              onClick={() => onSelectDate(on ? null : d.date)}
              className={`px-2 py-1.5 text-left transition-colors ${on ? 'bg-amber-400 text-gray-950' : highlightDates?.has(d.date) ? 'bg-amber-400/25 ring-2 ring-inset ring-amber-300' : 'bg-gray-900 hover:bg-gray-800'} ${d.date < today && !on && !highlightDates?.has(d.date) ? 'opacity-50' : ''}`}
            >
              <span className={`block text-[10px] uppercase ${on ? 'text-gray-950/70' : 'text-white/40'}`}>
                {formatLongDate(d.date, { weekday: 'short' })} - Day {d.dayNumber}
              </span>
              <span className={`block text-sm font-semibold ${on ? '' : 'text-white'}`}>{formatLongDate(d.date, { month: 'short', day: 'numeric' })}</span>
              <span className={`block truncate text-[10px] ${on ? 'text-gray-950/70' : 'text-white/35'}`}>{d.leg || ' '}</span>
            </button>
          )
        })}

        {rows.map(block => (
          <Row key={block.id} label={block.label}>
            {plan.days.map((d, i) => (
              <Cell key={d.date} highlighted={selectedDate === d.date}>
                {events[i].filter(block.holds).map(p => (
                  <EventChip key={p.item.id} planned={p} active={selected?.id === p.item.id} onClick={() => onSelectItem(p.item, d.date)} />
                ))}
              </Cell>
            ))}
          </Row>
        ))}

        {anyHotel && (
          <Row label="Sleeping">
            {plan.days.map(d => (
              <Cell key={d.date} highlighted={selectedDate === d.date}>
                {d.isNight && d.hotel && matches(d.hotel) && (
                  <EventChip planned={{ item: d.hotel, time: { sortKey: 0, label: null, exact: false, anytime: true } }} active={selected?.id === d.hotel.id} onClick={() => onSelectItem(d.hotel!, d.date)} />
                )}
              </Cell>
            ))}
          </Row>
        )}

        {rows.length === 0 && !anyHotel && (
          <div className="col-span-full bg-gray-900 px-3 py-4 text-sm text-white/40">Nothing planned matches the filters.</div>
        )}
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div className="sticky left-0 z-10 bg-gray-950 px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-white/40">{label}</div>
      {children}
    </>
  )
}

function Cell({ highlighted, children }: { highlighted: boolean; children: React.ReactNode }) {
  return <div className={`min-h-[2.75rem] space-y-1 p-1 ${highlighted ? 'bg-amber-400/10' : 'bg-gray-900'}`}>{children}</div>
}

function EventChip({ planned, active, onClick }: { planned: PlannedItem; active: boolean; onClick: () => void }) {
  const { item, time } = planned
  const color = STATUS_DOT[item.status ?? ''] ?? '#8E8E93'
  return (
    <button
      onClick={onClick}
      title={`${item.name} - ${item.status ?? ''}`}
      className={`block w-full rounded-md border-l-[3px] px-1.5 py-1 text-left transition-colors ${active ? 'bg-white/20' : 'bg-white/5 hover:bg-white/10'}`}
      style={{ borderLeftColor: color }}
    >
      {time.label && <span className={`block text-[10px] ${time.exact ? 'text-white/70' : 'text-white/40'}`}>{time.label}</span>}
      <span className="line-clamp-2 block text-[12px] leading-tight text-white/90">{item.name}</span>
    </button>
  )
}
