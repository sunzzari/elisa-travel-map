'use client'

import { useMemo, useRef, useState, useCallback } from 'react'
import TripMap from './TripMap'
import { dayIntro, displayItemsForDay, formatLongDate, formatShortDate, groupDays, newsletterMap, newsletterProse, poolDisplayItems } from '@/lib/day'
import type { DayBundle, TripItem, TripNewsletter, ItemType } from '@/lib/types'

const TYPE_META: Record<string, { color: string; glyph: string }> = {
  Hotel: { color: '#3B82F6', glyph: '🏨' },
  Restaurant: { color: '#EF4444', glyph: '🍽️' },
  Activity: { color: '#10B981', glyph: '⚡' },
  Flight: { color: '#8B5CF6', glyph: '✈️' },
  Train: { color: '#F59E0B', glyph: '🚅' },
  Ferry: { color: '#06B6D4', glyph: '⛴️' },
  'Car Rental': { color: '#F97316', glyph: '🚗' },
  Other: { color: '#6B7280', glyph: '📍' },
}

const STATUS_COLORS: Record<string, string> = {
  Confirmed: '#22c55e',
  Assigned: '#3B82F6',
  'Reservation Pending': '#F97316',
  Shortlisted: '#eab308',
  Researching: '#9ca3af',
  Cancelled: '#ef4444',
}

const TYPES: ItemType[] = ['Hotel', 'Restaurant', 'Activity', 'Flight', 'Train', 'Ferry', 'Car Rental', 'Other']

interface Props {
  items: TripItem[]
  newsletters: TripNewsletter[]
  apiKey: string
}

export default function DayDetailView({ items, newsletters, apiKey }: Props) {
  const days = useMemo(() => groupDays(items), [items])
  const newslettersByDate = useMemo(() => newsletterMap(newsletters), [newsletters])
  const initialDate = pickInitialDate(days)
  const [selectedDates, setSelectedDates] = useState<Set<string>>(() => new Set(initialDate ? [initialDate] : []))
  const [activeTypes, setActiveTypes] = useState<Set<ItemType>>(new Set())
  const [selected, setSelected] = useState<TripItem | null>(null)
  const [showMap, setShowMap] = useState(true)
  const [legendOpen, setLegendOpen] = useState(false)
  const recenterRef = useRef<(() => void) | null>(null)
  const handleRecenterReady = useCallback((fn: () => void) => { recenterRef.current = fn }, [])

  const visibleDays = days.filter(day => selectedDates.has(day.dateString))
  const sharedItems = visibleDays.flatMap(day => displayItemsForDay(day, newslettersByDate))
    .filter((item, index, list) => list.findIndex(candidate => candidate.id === item.id) === index)
    .filter(item => activeTypes.size === 0 || (item.type && activeTypes.has(item.type)))

  const fitKey = [
    Array.from(selectedDates).sort().join(',') || 'none',
    Array.from(activeTypes).sort().join(',') || 'all',
  ].join('|')

  function toggleDate(date: string) {
    setSelectedDates(prev => {
      const next = new Set(prev)
      if (next.has(date)) {
        if (next.size > 1) next.delete(date)
      } else {
        next.add(date)
      }
      return next
    })
    setSelected(null)
  }

  function toggleType(type: ItemType) {
    setActiveTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
    setSelected(null)
  }

  function selectItem(item: TripItem) {
    if (selected?.id === item.id) {
      window.open(item.url, '_blank', 'noopener,noreferrer')
      return
    }
    setSelected(item)
  }

  if (days.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-gray-950 text-sm text-white/40">
        No dated travel days found.
      </div>
    )
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col bg-gray-950">
      <div className="flex flex-shrink-0 gap-2 overflow-x-auto bg-gray-800 px-3 py-2 border-b border-white/10" style={{ scrollbarWidth: 'none' }}>
        {days.map(day => {
          const active = selectedDates.has(day.dateString)
          return (
            <button
              key={day.dateString}
              onClick={() => toggleDate(day.dateString)}
              className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs transition-colors ${
                active ? 'bg-amber-400 text-gray-950' : 'bg-white/10 text-white/70 hover:bg-white/15'
              }`}
            >
              <span className="block text-[10px] leading-none opacity-70">{formatLongDate(day.dateString, { weekday: 'short' })}</span>
              <span className="font-semibold">{formatShortDate(day.dateString)}</span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-shrink-0 items-center gap-2 bg-gray-800/70 px-3 py-1.5 border-b border-white/10">
        <button
          onClick={() => setShowMap(value => !value)}
          className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80 hover:bg-white/15"
        >
          {showMap ? 'Hide map' : 'Show map'}
        </button>
        <span className="text-xs text-white/35">{sharedItems.length} shown</span>
      </div>

      {showMap && (
        <div className="relative h-[280px] flex-shrink-0 border-b border-white/10">
          <TripMap
            items={sharedItems}
            apiKey={apiKey}
            selected={selected}
            onSelect={setSelected}
            userLocation={null}
            onRecenterReady={handleRecenterReady}
            fitKey={fitKey}
          />
          <button
            onClick={() => recenterRef.current?.()}
            className="absolute top-3 right-3 z-10 h-9 w-9 rounded-full bg-gray-900/80 border border-white/10 text-white/70 hover:text-amber-300"
            title="Show day pins"
          >
            ⌖
          </button>
          <div className="absolute bottom-3 left-3 z-10">
            {legendOpen && (
              <div className="mb-2 flex max-w-[min(520px,calc(100vw-2rem))] gap-1.5 overflow-x-auto rounded-xl border border-white/10 bg-gray-900/85 p-2 backdrop-blur-xl">
                {TYPES.map(type => {
                  const active = activeTypes.has(type)
                  const meta = TYPE_META[type]
                  return (
                    <button
                      key={type}
                      onClick={() => toggleType(type)}
                      className={`flex flex-shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-xs text-white/80 ${active ? 'border-white/40 bg-white/15' : 'border-transparent'}`}
                    >
                      <span className="flex h-5 w-5 items-center justify-center rounded-full text-[10px]" style={{ background: meta.color }}>{meta.glyph}</span>
                      {active && <span>{type}</span>}
                    </button>
                  )
                })}
                {activeTypes.size > 0 && (
                  <button onClick={() => setActiveTypes(new Set())} className="px-2 text-xs text-amber-300 underline">
                    Clear
                  </button>
                )}
              </div>
            )}
            <button
              onClick={() => setLegendOpen(open => !open)}
              className="rounded-full bg-gray-900/85 px-3 py-1.5 text-xs font-medium text-white/80 border border-white/10 backdrop-blur-xl"
            >
              {activeTypes.size === 0 ? 'Filter' : `Filter (${activeTypes.size})`}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="mx-auto flex max-w-4xl flex-col gap-3">
          {visibleDays.length === 0 ? (
            <p className="py-12 text-center text-sm text-white/40">Select a day above</p>
          ) : (
            visibleDays.map(day => (
              <NewsletterDayCard
                key={day.dateString}
                day={day}
                prose={newsletterProse(day, newslettersByDate)}
                selected={selected}
                onSelect={selectItem}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function pickInitialDate(days: DayBundle[]): string | null {
  const today = new Date().toISOString().slice(0, 10)
  return days.find(day => day.dateString === today)?.dateString ?? days[0]?.dateString ?? null
}

function NewsletterDayCard({
  day,
  prose,
  selected,
  onSelect,
}: {
  day: DayBundle
  prose: string | null
  selected: TripItem | null
  onSelect: (item: TripItem) => void
}) {
  const paragraphs = (prose ? prose.split('\n\n') : [dayIntro(day)])
    .map(paragraph => paragraph.trim())
    .filter(Boolean)
  const poolItems = poolDisplayItems(day, prose)

  return (
    <section className="rounded-xl bg-gray-800/60 p-4 border border-white/8">
      <div className="mb-3 flex items-baseline gap-2">
        <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold tracking-[0.16em] text-gray-950">NEWSLETTER</span>
        <h2 className="font-display text-xl text-white">{formatLongDate(day.dateString)}</h2>
      </div>

      <div className="space-y-3">
        {paragraphs.map((paragraph, index) => (
          <p key={index} className="font-display text-[15px] leading-7 text-white/85">
            {paragraph}
          </p>
        ))}
      </div>

      {(day.confirmed.length > 0 || poolItems.length > 0) && (
        <div className="mt-4 rounded-lg bg-gray-950/50 px-3 py-2">
          {day.confirmed.length > 0 && (
            <ItemSection title="CONFIRMED" items={day.confirmed} selected={selected} onSelect={onSelect} hollow={false} />
          )}
          {poolItems.length > 0 && (
            <ItemSection title="POSSIBILITIES" items={poolItems} selected={selected} onSelect={onSelect} hollow />
          )}
        </div>
      )}
    </section>
  )
}

function ItemSection({
  title,
  items,
  selected,
  onSelect,
  hollow,
}: {
  title: string
  items: TripItem[]
  selected: TripItem | null
  onSelect: (item: TripItem) => void
  hollow: boolean
}) {
  return (
    <div className="py-1">
      <p className="pb-1.5 text-[10px] font-semibold tracking-[0.12em] text-white/35">{title}</p>
      {items.map(item => {
        const color = STATUS_COLORS[item.status ?? ''] ?? '#9ca3af'
        const active = selected?.id === item.id
        return (
          <button
            key={item.id}
            onClick={() => onSelect(item)}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${active ? 'bg-amber-400/15' : 'hover:bg-white/5'}`}
          >
            <span
              className="h-2 w-2 flex-shrink-0 rounded-full"
              style={{ background: hollow ? 'transparent' : color, border: hollow ? `1.5px solid ${color}` : undefined }}
            />
            <span className="truncate text-sm text-white/85">{item.name}</span>
          </button>
        )
      })}
    </div>
  )
}

