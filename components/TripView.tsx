'use client'

import { useState, useRef, useCallback } from 'react'
import TripMap from './TripMap'
import Sidebar from './Sidebar'
import Legend from './Legend'
import BottomSheet from './BottomSheet'
import DayTimeline from './DayTimeline'
import DayDetailView from './DayDetailView'
import { haversineKm } from '@/lib/geo'
import type { TripItem, ItemStatus, ItemType } from '@/lib/types'
import type { UserLocation } from '@/lib/geo'

const STATUSES: { value: ItemStatus; label: string; color: string; active: string }[] = [
  { value: 'Confirmed',          label: 'Confirmed',    color: 'border-green-500/30 text-green-400',   active: 'bg-green-500 border-green-500 text-white shadow-[0_0_8px_rgba(34,197,94,0.4)]' },
  { value: 'Assigned',           label: 'Assigned',     color: 'border-blue-500/30 text-blue-400',     active: 'bg-blue-500 border-blue-500 text-white shadow-[0_0_8px_rgba(59,130,246,0.4)]' },
  { value: 'Reservation Pending', label: 'Res. Pending', color: 'border-orange-500/30 text-orange-400', active: 'bg-orange-500 border-orange-500 text-white shadow-[0_0_8px_rgba(249,115,22,0.4)]' },
  { value: 'Shortlisted',        label: 'Shortlisted',  color: 'border-yellow-500/30 text-yellow-400', active: 'bg-yellow-500 border-yellow-500 text-white shadow-[0_0_8px_rgba(234,179,8,0.4)]' },
  { value: 'Researching',        label: 'Researching',  color: 'border-white/15 text-white/50',        active: 'bg-white/20 border-white/30 text-white' },
  { value: 'Cancelled',          label: 'Cancelled',    color: 'border-red-500/30 text-red-400',       active: 'bg-red-500 border-red-500 text-white shadow-[0_0_8px_rgba(239,68,68,0.4)]' },
]

type SortMode = 'type' | 'date' | 'priority'

const PRIORITY_ORDER: Record<string, number> = { Must: 0, High: 1, Optional: 2 }
const TYPE_ORDER: Record<string, number> = {
  Hotel: 0,
  Restaurant: 1,
  Activity: 2,
  Flight: 3,
  Train: 4,
  Ferry: 5,
  'Car Rental': 6,
  Other: 7,
}

type NearMeState = 'idle' | 'loading' | 'active' | 'error'

interface Props {
  items: TripItem[]
  apiKey: string
  legLabel?: string
  onFullscreenChange?: (fs: boolean) => void
}

export default function TripView({ items, apiKey, legLabel = 'Leg', onFullscreenChange }: Props) {
  const [viewMode, setViewMode] = useState<'map' | 'day'>('map')
  const [selected, setSelected] = useState<TripItem | null>(null)
  const [activeFilters, setActiveFilters] = useState<Set<ItemStatus>>(new Set())
  const [activeLegs, setActiveLegs] = useState<Set<string>>(new Set())
  const [activeTypes, setActiveTypes] = useState<Set<ItemType>>(new Set())
  const [reservationOnly, setReservationOnly] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('type')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null)
  const [nearMeState, setNearMeState] = useState<NearMeState>('idle')
  const [fullscreen, setFullscreen] = useState(false)
  const recenterRef = useRef<(() => void) | null>(null)
  const handleRecenterReady = useCallback((fn: () => void) => { recenterRef.current = fn }, [])

  function toggleFullscreen() {
    setFullscreen(f => {
      const next = !f
      onFullscreenChange?.(next)
      return next
    })
  }

  const legs = Array.from(new Set(items.map(i => i.legCity).filter(Boolean))).sort()
  const allDates = Array.from(new Set(items.map(i => i.assignedToDate ?? i.date).filter((d): d is string => !!d))).sort()

  function toggleFilter(status: ItemStatus) {
    setActiveFilters(prev => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
    setSelected(null)
  }

  function toggleLeg(city: string) {
    setActiveLegs(prev => {
      const next = new Set(prev)
      if (next.has(city)) next.delete(city)
      else next.add(city)
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

  function clearTypes() {
    setActiveTypes(new Set())
    setSelected(null)
  }

  function requestNearMe() {
    if (nearMeState === 'active') {
      setUserLocation(null)
      setNearMeState('idle')
      return
    }
    setNearMeState('loading')
    navigator.geolocation.getCurrentPosition(
      pos => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setNearMeState('active')
      },
      () => setNearMeState('error'),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const q = searchQuery.trim().toLowerCase()

  const filtered = items
    .filter(i => activeFilters.size === 0 || (i.status && activeFilters.has(i.status)))
    .filter(i => activeLegs.size === 0 || activeLegs.has(i.legCity))
    .filter(i => activeTypes.size === 0 || (i.type && activeTypes.has(i.type)))
    .filter(i => !selectedDate || (i.assignedToDate ?? i.date) === selectedDate)
    .filter(i => !reservationOnly || i.reservationRequired)
    .filter(i => !q || i.name.toLowerCase().includes(q) || i.venue.toLowerCase().includes(q))

  const NEAR_ME_RADIUS_KM = 5

  const sorted = (() => {
    if (nearMeState === 'active' && userLocation) {
      return [...filtered]
        .filter(i => i.coordinates && haversineKm(userLocation.lat, userLocation.lng, i.coordinates.lat, i.coordinates.lng) <= NEAR_ME_RADIUS_KM)
        .sort((a, b) => {
          const da = a.coordinates ? haversineKm(userLocation.lat, userLocation.lng, a.coordinates.lat, a.coordinates.lng) : Infinity
          const db = b.coordinates ? haversineKm(userLocation.lat, userLocation.lng, b.coordinates.lat, b.coordinates.lng) : Infinity
          return da - db
        })
    }
    switch (sortMode) {
      case 'date':
        return [...filtered].sort((a, b) => {
          const da = a.assignedToDate ?? a.date
          const db = b.assignedToDate ?? b.date
          if (!da && !db) return 0
          if (!da) return 1
          if (!db) return -1
          return da.localeCompare(db)
        })
      case 'priority':
        return [...filtered].sort((a, b) => {
          const pa = PRIORITY_ORDER[a.priority ?? ''] ?? 3
          const pb = PRIORITY_ORDER[b.priority ?? ''] ?? 3
          return pa - pb
        })
      case 'type':
      default:
        return [...filtered].sort((a, b) => (TYPE_ORDER[a.type ?? ''] ?? 99) - (TYPE_ORDER[b.type ?? ''] ?? 99))
    }
  })()

  const displayItems = sorted
  const fitKey = [
    activeFilters.size > 0 ? Array.from(activeFilters).sort().join(',') : 'all-status',
    activeTypes.size > 0 ? Array.from(activeTypes).sort().join(',') : 'all-types',
    activeLegs.size > 0 ? Array.from(activeLegs).sort().join(',') : 'all',
    selectedDate ?? 'nodate',
    q || 'noquery',
    nearMeState,
    reservationOnly ? 'reservations' : 'all-reservations',
  ].join('|')

  const nearMeLabel =
    nearMeState === 'loading' ? '…' :
    nearMeState === 'active'  ? '📍 Near me' :
    nearMeState === 'error'   ? 'Location off' :
    '📍 Near me'

  return (
    <div className="flex flex-1 overflow-hidden flex-col">
      {!fullscreen && (
        <div className="flex justify-center bg-gray-800 px-4 py-2 border-b border-white/10">
          <div className="grid w-full max-w-60 grid-cols-2 rounded-lg bg-white/10 p-0.5">
            <button
              onClick={() => setViewMode('map')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${viewMode === 'map' ? 'bg-amber-400 text-gray-950' : 'text-white/60 hover:text-white'}`}
            >
              Map
            </button>
            <button
              onClick={() => { setViewMode('day'); setSelected(null) }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${viewMode === 'day' ? 'bg-amber-400 text-gray-950' : 'text-white/60 hover:text-white'}`}
            >
              Day
            </button>
          </div>
        </div>
      )}

      {viewMode === 'day' ? (
        <DayDetailView items={items} apiKey={apiKey} />
      ) : (
        <>

      {/* Unified toolbar */}
      <div className={`bg-gray-800 border-b border-white/10 ${fullscreen ? 'hidden' : ''}`}>
        {/* Top row: search + sort */}
        <div className="flex items-center gap-2 px-4 py-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 text-sm pointer-events-none">🔍</span>
            <input
              type="search"
              placeholder="Search items..."
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setSelected(null) }}
              className="w-full text-sm pl-8 pr-3 py-1.5 rounded-full border border-white/15 bg-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-amber-400/30 focus:bg-white/15 transition-colors"
            />
          </div>
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-xs text-white/40 hover:text-white/70">
              Clear
            </button>
          )}
        </div>

        {/* Bottom row: filter chips */}
        <div
          className="flex items-center gap-2 px-4 py-2 overflow-x-auto flex-nowrap border-t border-white/5"
          style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
        >
          <button
            onClick={requestNearMe}
            disabled={nearMeState === 'loading'}
            className={`flex-shrink-0 text-xs font-medium px-3 py-1 rounded-full border transition-all ${
              nearMeState === 'active'
                ? 'bg-blue-500 border-blue-500 text-white shadow-[0_0_8px_rgba(59,130,246,0.4)]'
                : nearMeState === 'error'
                ? 'border-red-500/30 text-red-400 bg-transparent'
                : 'border-white/15 text-white/50 bg-transparent hover:bg-white/5 disabled:opacity-50'
            }`}
          >
            {nearMeLabel}
          </button>

          <span className="flex-shrink-0 text-xs text-white/30 font-medium">Status:</span>
          {STATUSES.map(s => {
            const isActive = activeFilters.has(s.value)
            return (
              <button
                key={s.value}
                onClick={() => toggleFilter(s.value)}
                className={`flex-shrink-0 text-xs font-medium px-3 py-1 rounded-full border transition-all ${
                  isActive ? s.active : s.color + ' bg-transparent hover:bg-white/5'
                }`}
              >
                {s.label}
              </button>
            )
          })}
          {activeFilters.size > 0 && (
            <button
              onClick={() => { setActiveFilters(new Set()); setSelected(null) }}
              className="flex-shrink-0 text-xs text-white/40 hover:text-white/70 underline"
            >
              Clear
            </button>
          )}

          <button
            onClick={() => { setReservationOnly(value => !value); setSelected(null) }}
            className={`flex-shrink-0 text-xs font-medium px-3 py-1 rounded-full border transition-all ${
              reservationOnly
                ? 'bg-orange-500 border-orange-500 text-white shadow-[0_0_8px_rgba(249,115,22,0.4)]'
                : 'border-orange-400/30 text-orange-300 bg-transparent hover:bg-white/5'
            }`}
          >
            Reservation
          </button>

          {legs.length > 1 && (
            <>
              <span className="flex-shrink-0 text-white/10 mx-1">|</span>
              <span className="flex-shrink-0 text-xs text-white/30 font-medium">{legLabel}:</span>
              {legs.map(city => {
                const isActive = activeLegs.has(city)
                return (
                  <button
                    key={city}
                    onClick={() => toggleLeg(city)}
                    className={`flex-shrink-0 text-xs font-medium px-3 py-1 rounded-full border transition-all ${
                      isActive
                        ? 'bg-indigo-500 border-indigo-500 text-white shadow-[0_0_8px_rgba(99,102,241,0.4)]'
                        : 'border-indigo-400/30 text-indigo-300 bg-transparent hover:bg-white/5'
                    }`}
                  >
                    {city}
                  </button>
                )
              })}
              {activeLegs.size > 0 && (
                <button
                  onClick={() => { setActiveLegs(new Set()); setSelected(null) }}
                  className="flex-shrink-0 text-xs text-white/40 hover:text-white/70 underline"
                >
                  Clear
                </button>
              )}
            </>
          )}

          <span className="flex-shrink-0 text-xs text-white/30 pl-3">{displayItems.length} items</span>
        </div>
      </div>

      {allDates.length > 0 && (
        <DayTimeline
          dates={allDates}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          className={`border-b border-white/10 bg-gray-800 ${fullscreen ? 'hidden' : 'hidden md:flex'}`}
        />
      )}

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          items={displayItems}
          selected={selected}
          onSelect={setSelected}
          userLocation={userLocation}
          className={fullscreen ? 'hidden' : 'hidden md:flex'}
          sortMode={sortMode}
        />
        <div className="relative flex-1">
          <TripMap
            items={displayItems}
            apiKey={apiKey}
            selected={selected}
            onSelect={setSelected}
            userLocation={userLocation}
            onRecenterReady={handleRecenterReady}
            fitKey={fitKey}
          />
          <Legend activeTypes={activeTypes} onToggle={toggleType} onClear={clearTypes} />
          <button
            onClick={() => { recenterRef.current?.(); setSelected(null) }}
            className="absolute top-4 right-16 z-10 bg-gray-900/80 backdrop-blur-md rounded-lg shadow-lg w-10 h-10 flex items-center justify-center text-white/60 hover:text-amber-400 transition-colors border border-white/10 hover:border-amber-400/20"
            title="Show all pins"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" />
              <line x1="12" y1="2" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="22" />
              <line x1="2" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="22" y2="12" />
            </svg>
          </button>
          <button
            onClick={toggleFullscreen}
            className="absolute top-4 right-4 z-10 bg-gray-900/80 backdrop-blur-md rounded-lg shadow-lg w-10 h-10 flex items-center justify-center text-white/60 hover:text-amber-400 transition-colors border border-white/10 hover:border-amber-400/20"
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen map'}
          >
            {fullscreen ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {!fullscreen && <BottomSheet
        items={displayItems}
        selected={selected}
        onSelect={setSelected}
        userLocation={userLocation}
        searchActive={!!q}
        dates={allDates}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
      />}
        </>
      )}
    </div>
  )
}
