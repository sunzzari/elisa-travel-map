'use client'

import { useMemo, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import TripMap from './TripMap'
import UnmappedList from './UnmappedList'
import { AddPlaceForm, PlaceEditor, UnlockForm, usePasscode } from './PlaceEditing'
import type { TripItem } from '@/lib/types'
// From the shared module, never from `lib/aroundtown` - that one imports the
// geocoder, which reads the coordinate table off disk, and a client component
// importing it drags node:fs into the browser bundle.
import type { AroundTownMeta, AroundTownKind, AroundTownRegion } from '@/lib/aroundtown-shared'
import {
  NOT_RATED_COLOR,
  ACTIVITY_COLOR,
  BEEN_THERE_COLOR,
  regionFromCoords,
  colorFor,
  fitAreaContains,
} from '@/lib/aroundtown-shared'

/**
 * Around Town, on the trips' own map.
 *
 * No days anywhere: an Around Town place is never assigned to a date, so the
 * only axes are where it is, what it is, and whether we have been.
 */

const LEGEND: Array<{ color: string; label: string }> = [
  { color: '#54A0FF', label: 'Top Choice' },
  { color: '#70C17C', label: 'Great' },
  { color: '#FBBF24', label: 'Good' },
  { color: '#FF6B6B', label: 'Bad' },
  { color: NOT_RATED_COLOR, label: 'Not rated' },
  { color: ACTIVITY_COLOR, label: 'Activity' },
  { color: BEEN_THERE_COLOR, label: 'Been there' },
]

const REGION_LABEL: Record<AroundTownRegion, string> = { la: 'LA', sfBay: 'SF Bay' }

function Chip({
  label,
  on,
  onClick,
  tone = 'amber',
}: {
  label: string
  on: boolean
  onClick: () => void
  tone?: 'amber' | 'indigo' | 'green'
}) {
  const palette = {
    amber: on ? 'border-amber-400 bg-amber-400 text-gray-950' : 'border-amber-400/30 text-amber-200 hover:bg-white/5',
    indigo: on ? 'border-indigo-400 bg-indigo-500 text-white' : 'border-indigo-400/30 text-indigo-300 hover:bg-white/5',
    green: on ? 'border-green-400 bg-green-500 text-white' : 'border-green-400/30 text-green-300 hover:bg-white/5',
  }[tone]
  return (
    <button
      onClick={onClick}
      className={`flex-shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${palette}`}
    >
      {label}
    </button>
  )
}

export default function AroundTownClient({
  items,
  meta: initialMeta,
  apiKey,
}: {
  items: TripItem[]
  meta: Record<string, AroundTownMeta>
  apiKey: string
}) {
  // Edits update this copy immediately; the server page catches up on its
  // next revalidation.
  const [meta, setMeta] = useState(initialMeta)
  const { passcode, unlocked, unlock, lock } = usePasscode()
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const onSaved = useCallback((id: string, next: AroundTownMeta) => {
    setMeta(prev => ({ ...prev, [id]: { ...next, color: colorFor(next) } }))
  }, [])

  const [region, setRegion] = useState<AroundTownRegion | null>(null)
  const [kind, setKind] = useState<AroundTownKind | null>(null)
  const [wantToTryOnly, setWantToTryOnly] = useState(false)
  const [hideBeenThere, setHideBeenThere] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<TripItem | null>(null)

  const recenterRef = useRef<(() => void) | null>(null)
  const onRecenterReady = useCallback((fn: () => void) => {
    recenterRef.current = fn
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter(item => {
      const m = meta[item.id]
      if (!m) return false
      if (region && m.region !== region) return false
      if (kind && m.kind !== kind) return false
      if (wantToTryOnly && !m.thinkingAbout) return false
      if (hideBeenThere && m.done) return false
      if (q) {
        const haystack = [item.name, m.neighborhood, m.locationText, m.goodFor.join(' '), m.topDishes, m.comments]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [items, meta, region, kind, wantToTryOnly, hideBeenThere, query])

  const mapped = shown.filter(i => i.coordinates)
  const unmapped = shown.filter(i => !i.coordinates)

  // The ONE area a fit may span. Elisa, 2026-09-14: "id never want to fit all
  // between sf and la. id fit all within one area but not all areas." Her
  // explicit LA / SF Bay choice wins; with no choice made it is whichever area
  // holds more of the places on screen. Pins outside it stay on the map and
  // stay clickable, they just never stretch the frame.
  //
  // The vote uses the WIDE box on purpose - it is choosing LA vs the Bay, not
  // drawing the frame. The frame uses `fitAreaContains`, which is LA County
  // only, so San Diego and Orange County never stretch it.
  const fitRegion: AroundTownRegion = useMemo(() => {
    if (region) return region
    let la = 0
    let sf = 0
    for (const item of mapped) {
      const r = regionFromCoords(item.coordinates!.lat, item.coordinates!.lng)
      if (r === 'la') la += 1
      else if (r === 'sfBay') sf += 1
    }
    return sf > la ? 'sfBay' : 'la'
  }, [region, mapped])

  const fitScopeIds = useMemo(
    () =>
      new Set(
        mapped
          .filter(i => fitAreaContains(fitRegion, i.coordinates!.lat, i.coordinates!.lng))
          .map(i => i.id)
      ),
    [mapped, fitRegion]
  )

  const fitKey = [
    region ?? 'allregions',
    kind ?? 'allkinds',
    wantToTryOnly ? 'want' : 'any',
    hideBeenThere ? 'nottried' : 'all',
    query.trim().toLowerCase(),
    `fit:${fitRegion}`,
  ].join('|')

  const styleFor = useCallback(
    (item: TripItem) => {
      const m = meta[item.id]
      const bg = m?.color ?? NOT_RATED_COLOR
      return { bg, border: bg, glyph: m?.kind === 'activity' ? '⚡' : '🍽️' }
    },
    [meta]
  )

  const hasFilters = region !== null || kind !== null || wantToTryOnly || hideBeenThere || query !== ''

  function clearAll() {
    setRegion(null)
    setKind(null)
    setWantToTryOnly(false)
    setHideBeenThere(false)
    setQuery('')
    setSelected(null)
  }

  return (
    <main className="flex h-screen flex-col bg-gray-950">
      <div
        className="flex-shrink-0 px-4 pb-3 pt-4"
        style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 0px) + 0.5rem)' }}
      >
        <div className="flex items-baseline gap-3">
          <Link href="/" className="text-xs text-white/30 transition-colors hover:text-amber-400">
            Trip Maps
          </Link>
          <h1 className="font-display text-2xl leading-tight text-white">Around Town</h1>
          <span className="text-xs text-white/30">no dates, just places</span>
        </div>
      </div>

      <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 px-4 pb-3">
        {(['la', 'sfBay'] as AroundTownRegion[]).map(r => (
          <Chip
            key={r}
            label={REGION_LABEL[r]}
            on={region === r}
            tone="indigo"
            onClick={() => {
              setRegion(region === r ? null : r)
              setSelected(null)
            }}
          />
        ))}

        <span className="mx-1 h-4 w-px flex-shrink-0 bg-white/15" />

        <Chip
          label="Restaurants"
          on={kind === 'restaurant'}
          onClick={() => {
            setKind(kind === 'restaurant' ? null : 'restaurant')
            setSelected(null)
          }}
        />
        <Chip
          label="Activities"
          on={kind === 'activity'}
          onClick={() => {
            setKind(kind === 'activity' ? null : 'activity')
            setSelected(null)
          }}
        />

        <span className="mx-1 h-4 w-px flex-shrink-0 bg-white/15" />

        <Chip label="Want to Try" on={wantToTryOnly} onClick={() => setWantToTryOnly(!wantToTryOnly)} />
        <Chip
          label="Haven't Tried"
          on={hideBeenThere}
          tone="green"
          onClick={() => setHideBeenThere(!hideBeenThere)}
        />

        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search"
          className="ml-1 w-28 flex-shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white placeholder:text-white/25 focus:border-amber-400/40 focus:outline-none"
        />

        {hasFilters && (
          <button onClick={clearAll} className="flex-shrink-0 px-1.5 text-xs text-white/40 hover:text-amber-400">
            Clear
          </button>
        )}

        <button
          onClick={() => {
            setAdding(!adding)
            setSelected(null)
            setNotice(null)
          }}
          className="flex-shrink-0 rounded-full border border-amber-400/40 px-2.5 py-1 text-xs font-medium text-amber-300 hover:bg-white/5"
        >
          {adding ? 'Close' : '+ Add place'}
        </button>

        <span className="flex-shrink-0 pl-2 text-xs text-white/30">
          {mapped.length} on the map
          {unmapped.length > 0 ? ` - ${unmapped.length} without a location` : ''}
        </span>
      </div>

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
            styleFor={styleFor}
            defaultCenter={{ lat: 34.05, lng: -118.24 }}
            fitScopeIds={fitScopeIds}
          />
          <button
            onClick={() => {
              recenterRef.current?.()
              setSelected(null)
            }}
            className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-gray-900/80 text-white/60 backdrop-blur-md transition-colors hover:text-amber-400"
            title="Show all pins"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" />
              <line x1="12" y1="2" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="22" />
              <line x1="2" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="22" y2="12" />
            </svg>
          </button>

          <div className="absolute bottom-4 left-4 z-10 rounded-xl border border-white/10 bg-gray-950/75 px-3 py-2.5 backdrop-blur-md">
            {LEGEND.map(row => (
              <div key={row.label} className="flex items-center gap-2 py-[2px]">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: row.color }} />
                <span className="text-[11px] font-medium text-white/75">{row.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto lg:max-w-[420px] lg:border-l lg:border-white/10">
          {notice && (
            <p className="border-b border-white/10 px-4 py-2 text-xs text-green-300">{notice}</p>
          )}

          {(adding || selected) && (
            <section className="border-b border-white/10 px-4 py-4">
              {adding ? (
                <h2 className="mb-3 text-sm font-semibold text-white">Add a place</h2>
              ) : (
                <div className="mb-3">
                  <h2 className="text-sm font-semibold text-white">{selected!.name}</h2>
                  <p className="text-xs text-white/40">
                    {[meta[selected!.id]?.address || meta[selected!.id]?.neighborhood || meta[selected!.id]?.locationText]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              )}

              {!unlocked ? (
                <UnlockForm onUnlock={unlock} />
              ) : adding ? (
                <AddPlaceForm
                  passcode={passcode}
                  onDone={message => {
                    setAdding(false)
                    setNotice(message)
                  }}
                />
              ) : selected && meta[selected.id] ? (
                <PlaceEditor
                  item={selected}
                  meta={meta[selected.id]}
                  passcode={passcode}
                  onSaved={next => onSaved(selected.id, next)}
                />
              ) : null}

              {unlocked && (
                <button onClick={lock} className="mt-3 text-[11px] text-white/30 hover:text-white/60">
                  Lock editing on this browser
                </button>
              )}
            </section>
          )}

          <section className="px-4 py-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/35">
              {mapped.length} place{mapped.length === 1 ? '' : 's'} on the map
            </p>
            {mapped.map(item => {
              const m = meta[item.id]
              return (
                <button
                  key={item.id}
                  onClick={() => setSelected(item)}
                  className={`flex w-full gap-2.5 rounded-md px-1.5 py-2 text-left transition-colors hover:bg-white/5 ${
                    selected?.id === item.id ? 'bg-white/5' : ''
                  }`}
                >
                  <span
                    className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full"
                    style={{ background: m?.color ?? NOT_RATED_COLOR }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-white">{item.name}</span>
                    <span className="block text-xs text-white/40">
                      {[m?.preference, m?.neighborhood || m?.locationText, m?.done ? 'Been there' : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </button>
              )
            })}
          </section>

          <UnmappedList
            items={unmapped}
            onSelect={setSelected}
            dotColor={item => meta[item.id]?.color ?? NOT_RATED_COLOR}
            subtitle={item => {
              const m = meta[item.id]
              return [m?.kind === 'activity' ? 'Activity' : 'Restaurant', m?.locationText]
                .filter(Boolean)
                .join(' - ')
            }}
            note="No address Google could place. Search it in Maps, or open its Notion row."
            searchContext={item => {
              const m = meta[item.id]
              return [m?.neighborhood, m?.locationText].filter(Boolean).join(', ')
            }}
          />
        </div>
      </div>
    </main>
  )
}
