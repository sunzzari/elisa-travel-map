'use client'

import { useMemo, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import TripMap from './TripMap'
import { groupDays, planDay, formatLongDate, pickOpeningDate, todayInZone, isDone, type DayPlan, type PlannedItem } from '@/lib/day'
import type { Trip, TripItem, ItemType } from '@/lib/types'

// Map-first day view.
//
// This replaced a zero-JavaScript version whose whole point was that the
// Sunzzari webview could cache the HTML and read it offline. That constraint is
// gone: the iOS app now has its own native Today screen with its own map and
// its own disk cache, so it no longer leans on this page for offline. This page
// is the laptop surface, where there is wifi, and it can be a real map.

const TYPE_META: Record<string, { glyph: string; color: string }> = {
  Hotel: { glyph: '🏨', color: '#3B82F6' },
  Restaurant: { glyph: '🍽️', color: '#EF4444' },
  Activity: { glyph: '⚡', color: '#10B981' },
  Flight: { glyph: '✈️', color: '#8B5CF6' },
  Train: { glyph: '🚅', color: '#F59E0B' },
  Ferry: { glyph: '⛴️', color: '#06B6D4' },
  'Car Rental': { glyph: '🚗', color: '#F97316' },
  Other: { glyph: '📍', color: '#6B7280' },
}

const TYPE_ORDER: ItemType[] = ['Hotel', 'Restaurant', 'Activity', 'Flight', 'Train', 'Ferry', 'Car Rental', 'Other']

const STATUS_DOT: Record<string, string> = {
  Confirmed: '#34C759',
  Assigned: '#0A84FF',
  'Reservation Pending': '#FF9F0A',
  Shortlisted: '#FFD60A',
  Researching: '#8E8E93',
}

function mapsHref(item: TripItem): string {
  if (item.address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}`
  if (item.coordinates) return `https://www.google.com/maps/search/?api=1&query=${item.coordinates.lat},${item.coordinates.lng}`
  const q = [item.venue || item.name, item.legCity].filter(Boolean).join(', ')
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}

interface Props {
  trip: Trip
  items: TripItem[]
  apiKey: string
}

export default function ItineraryClient({ trip, items, apiKey }: Props) {
  const days = useMemo(() => groupDays(items), [items])
  const allDates = useMemo(() => days.map(d => d.dateString), [days])
  const plans = useMemo(() => days.map(d => planDay(d, allDates)), [days, allDates])

  // null means "all days".
  // Every "is this today / is this past" question resolves in the TRIP's
  // timezone, not the browser's.
  const today = useMemo(() => todayInZone(trip.timeZone), [trip.timeZone])
  const [selectedDate, setSelectedDate] = useState<string | null>(() => pickOpeningDate(days, trip.timeZone))
  const [activeTypes, setActiveTypes] = useState<Set<ItemType>>(new Set())
  const [selected, setSelected] = useState<TripItem | null>(null)
  const recenterRef = useRef<(() => void) | null>(null)
  const onRecenterReady = useCallback((fn: () => void) => { recenterRef.current = fn }, [])

  const visiblePlans = selectedDate ? plans.filter(p => p.dateString === selectedDate) : plans

  // Everything on the visible day(s): what is scheduled, plus the candidates
  // for that leg. Status colour on the marker already distinguishes them.
  const pool = useMemo(() => {
    const list = visiblePlans.flatMap(p => [...p.timeline.map(x => x.item), ...p.anytime.map(x => x.item), ...p.options])
    return list.filter((item, i, arr) => arr.findIndex(c => c.id === item.id) === i)
  }, [visiblePlans])

  const presentTypes = useMemo(
    () => TYPE_ORDER.filter(t => pool.some(i => (i.type ?? 'Other') === t)),
    [pool]
  )

  const shown = pool.filter(i => activeTypes.size === 0 || activeTypes.has((i.type ?? 'Other') as ItemType))
  const mapped = shown.filter(i => i.coordinates)
  const unmapped = shown.length - mapped.length

  const fitKey = [selectedDate ?? 'all', Array.from(activeTypes).sort().join(',') || 'alltypes'].join('|')

  function toggleType(type: ItemType) {
    setActiveTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
    setSelected(null)
  }

  return (
    <main className="flex h-screen flex-col bg-gray-950 text-white">
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-white/10 bg-gray-900 px-4 py-2.5">
        <Link href="/" className="text-sm text-white/40 transition-colors hover:text-amber-400">← Trips</Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-lg leading-tight">{trip.name}</h1>
          <p className="truncate text-xs text-white/40">{trip.location}</p>
        </div>
        <Link
          href={`/${trip.id.replace(/-/g, '')}`}
          className="flex-shrink-0 rounded-full border border-white/15 px-3 py-1 text-xs text-white/60 transition-colors hover:border-amber-400/40 hover:text-amber-400"
        >
          Full trip map
        </Link>
      </header>

      {/* Date chips. "All days" first so it is reachable without scrolling. */}
      <div className="flex flex-shrink-0 gap-1.5 overflow-x-auto border-b border-white/10 bg-gray-900 px-4 py-2" style={{ scrollbarWidth: 'none' }}>
        <button
          onClick={() => { setSelectedDate(null); setSelected(null) }}
          className={`flex-shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
            selectedDate === null ? 'bg-amber-400 text-gray-950' : 'bg-white/10 text-white/70 hover:bg-white/15'
          }`}
        >
          All days
        </button>
        {plans.map(plan => {
          const active = plan.dateString === selectedDate
          const isToday = plan.dateString === today
          const past = plan.dateString < today
          return (
            <button
              key={plan.dateString}
              onClick={() => { setSelectedDate(plan.dateString); setSelected(null) }}
              className={`flex-shrink-0 rounded-xl px-3 py-1 text-center transition-colors ${
                active ? 'bg-amber-400 text-gray-950' : past ? 'bg-white/5 text-white/35 hover:bg-white/10' : 'bg-white/10 text-white/70 hover:bg-white/15'
              } ${isToday && !active ? 'ring-1 ring-amber-400/50' : ''}`}
            >
              <span className="block text-[10px] uppercase leading-none opacity-70">
                {formatLongDate(plan.dateString, { weekday: 'short' })}
              </span>
              <span className="block text-sm font-semibold leading-tight">
                {formatLongDate(plan.dateString, { month: 'short', day: 'numeric' })}
              </span>
            </button>
          )
        })}
      </div>

      {/* Type chips. Only the types actually present, so a Ferry toggle never
          shows up on a Utah ski weekend. */}
      <div className="flex flex-shrink-0 items-center gap-1.5 overflow-x-auto border-b border-white/10 bg-gray-900 px-4 py-2" style={{ scrollbarWidth: 'none' }}>
        {presentTypes.map(type => {
          const on = activeTypes.has(type)
          const meta = TYPE_META[type] ?? TYPE_META.Other
          return (
            <button
              key={type}
              onClick={() => toggleType(type)}
              className="flex flex-shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all"
              style={{
                background: on ? meta.color : 'transparent',
                borderColor: on ? meta.color : 'rgba(255,255,255,0.15)',
                color: on ? '#0b0b0d' : meta.color,
              }}
            >
              <span>{meta.glyph}</span>
              {type}
            </button>
          )
        })}
        {activeTypes.size > 0 && (
          <button onClick={() => setActiveTypes(new Set())} className="flex-shrink-0 text-xs text-white/40 underline hover:text-white/70">
            Clear
          </button>
        )}
        <span className="flex-shrink-0 pl-2 text-xs text-white/30">
          {mapped.length} on the map{unmapped > 0 ? ` - ${unmapped} without a location` : ''}
        </span>
      </div>

      {/* Map is the page. On a laptop it sits beside the plan; on a phone the
          plan scrolls underneath it. */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative h-[45vh] flex-shrink-0 lg:h-auto lg:flex-1">
          <TripMap
            items={shown}
            apiKey={apiKey}
            selected={selected}
            onSelect={setSelected}
            userLocation={null}
            onRecenterReady={onRecenterReady}
            fitKey={fitKey}
          />
          <button
            onClick={() => { recenterRef.current?.(); setSelected(null) }}
            className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-gray-900/80 text-white/60 backdrop-blur-md transition-colors hover:text-amber-400"
            title="Show all pins"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" />
              <line x1="12" y1="2" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="22" />
              <line x1="2" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="22" y2="12" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto lg:max-w-[420px] lg:border-l lg:border-white/10">
          {visiblePlans.map(plan => (
            <DaySection key={plan.dateString} plan={plan} onSelect={setSelected} selected={selected} today={today} />
          ))}
        </div>
      </div>
    </main>
  )
}

function DaySection({ plan, selected, onSelect, today }: { plan: DayPlan; selected: TripItem | null; onSelect: (i: TripItem) => void; today: string }) {
  return (
    <section className="border-b border-white/10 px-4 py-4 last:border-b-0">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="font-display text-lg text-amber-300">{formatLongDate(plan.dateString)}</h2>
        <span className="text-xs text-white/35">
          Day {plan.dayNumber} of {plan.totalDays}{plan.legCity ? ` - ${plan.legCity}` : ''}
        </span>
      </div>

      {plan.needsBooking.length > 0 && (
        <div className="mb-3 rounded-lg border border-orange-400/30 bg-orange-400/10 px-3 py-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-orange-400">Still needs booking</p>
          {plan.needsBooking.map(item => (
            <p key={item.id} className="text-[13px] leading-relaxed text-white/90">{item.name}</p>
          ))}
        </div>
      )}

      {plan.hotel && (
        <button onClick={() => onSelect(plan.hotel!)} className={`mb-3 block w-full rounded-lg border border-blue-400/30 bg-blue-400/10 px-3 py-2 text-left ${plan.dateString < today ? 'opacity-50' : ''}`}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-400">
            {plan.dateString < today ? 'Stayed here' : 'Sleeping tonight'}
          </p>
          <p className="text-sm font-semibold text-white">{plan.hotel.name}</p>
          {plan.hotel.address && <p className="text-xs text-white/45">{plan.hotel.address}</p>}
          {plan.hotel.confirmationNumber && (
            <p className="text-xs font-semibold text-green-400">{plan.hotel.confirmationNumber}{plan.hotel.bookedVia ? ` - ${plan.hotel.bookedVia}` : ''}</p>
          )}
        </button>
      )}

      {plan.timeline.length === 0 && plan.anytime.length === 0 && (
        <p className="text-sm text-white/40">Nothing scheduled. Anything on the map is fair game.</p>
      )}

      <Rows planned={plan.timeline} showTime selected={selected} onSelect={onSelect} today={today} dayDate={plan.dateString} />
      {plan.anytime.length > 0 && plan.timeline.length > 0 && (
        <p className="pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-white/35">Anytime today</p>
      )}
      <Rows planned={plan.anytime} showTime={plan.timeline.length > 0} selected={selected} onSelect={onSelect} today={today} dayDate={plan.dateString} />

      {plan.options.length > 0 && (
        <p className="mt-3 border-t border-white/10 pt-2 text-xs text-white/35">
          {plan.options.length} more nearby on the map, not scheduled
        </p>
      )}
    </section>
  )
}

function Rows({ planned, showTime, selected, onSelect, today, dayDate }: {
  planned: PlannedItem[]
  showTime: boolean
  selected: TripItem | null
  onSelect: (i: TripItem) => void
  today: string
  dayDate: string
}) {
  return (
    <>
      {planned.map(({ item, time }) => {
        // Dimmed ONLY when it is Confirmed and its day is finished in the
        // trip's timezone. A plan is not evidence that it happened.
        const done = isDone(dayDate, item.status, today)
        return (
        <button
          key={item.id}
          onClick={() => onSelect(item)}
          className={`flex w-full gap-2.5 rounded-md px-1.5 py-2 text-left transition-colors ${
            selected?.id === item.id ? 'bg-amber-400/10' : 'hover:bg-white/5'
          } ${done ? 'opacity-40' : ''}`}
        >
          {showTime && (
            // A rough word renders as the word, dimmer and smaller. It is never
            // shown as the clock time it was anchored to for sorting.
            <span className={`w-14 flex-shrink-0 tabular-nums ${time.exact ? 'text-[13px] text-white' : 'text-[11px] text-white/40'}`}>
              {time.label ?? ''}
            </span>
          )}
          <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full" style={{ background: STATUS_DOT[item.status ?? ''] ?? '#8E8E93' }} />
          <span className="min-w-0 flex-1">
            <span className={`block text-sm font-medium text-white ${done ? 'line-through decoration-white/30' : ''}`}>{item.name}</span>
            <span className="block text-xs text-white/40">
              {[item.type, item.venue && item.venue !== item.name ? item.venue : null].filter(Boolean).join(' - ')}
            </span>
            {item.address && <span className="block text-xs text-white/40">{item.address}</span>}
            {item.notes && <span className="mt-1 block text-xs leading-relaxed text-white/60">{item.notes}</span>}
            {(item.confirmationNumber || item.bookedVia) && (
              <span className="mt-1 block text-xs font-semibold tabular-nums text-green-400">
                {[item.confirmationNumber, item.bookedVia].filter(Boolean).join(' - ')}
              </span>
            )}
            <a
              href={mapsHref(item)}
              target="_blank"
              rel="noreferrer"
              onClick={e => e.stopPropagation()}
              className="mt-1 inline-block text-xs text-amber-400 hover:underline"
            >
              Directions
            </a>
          </span>
        </button>
        )
      })}
    </>
  )
}
