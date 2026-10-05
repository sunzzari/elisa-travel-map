'use client'

import { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import TripMap from './TripMap'
import UnmappedList from './UnmappedList'
import { AddPlaceForm, PlaceEditor, UnlockForm, usePasscode } from './PlaceEditing'
import type { TripItem } from '@/lib/types'
import { haversineKm, type UserLocation } from '@/lib/geo'
import { searchPlaces, nearest, type SearchablePlace } from '@/lib/place-search'
import { branchId, placeIdOf } from '@/lib/saved-pins'
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

  const router = useRouter()
  const panelRef = useRef<HTMLDivElement | null>(null)

  // Fresh places from the server (after a pin changed) replace the local copy.
  useEffect(() => setMeta(initialMeta), [initialMeta])

  const onSaved = useCallback((id: string, next: AroundTownMeta, locationChanged: boolean) => {
    setMeta(prev => ({ ...prev, [id]: { ...next, color: colorFor(next) } }))
    // The pin lives in the server's copy of the places; pull it so the map moves.
    if (locationChanged) router.refresh()
  }, [router])

  const [region, setRegion] = useState<AroundTownRegion | null>(null)
  const [kind, setKind] = useState<AroundTownKind | null>(null)
  const [wantToTryOnly, setWantToTryOnly] = useState(false)
  const [hideBeenThere, setHideBeenThere] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<TripItem | null>(null)

  // After a refresh the open place must be the fresh copy, or its pin and
  // callout stay where they were before the save.
  useEffect(() => {
    setSelected(sel => (sel ? items.find(i => i.id === placeIdOf(sel.id)) ?? sel : sel))
  }, [items])

  const recenterRef = useRef<(() => void) | null>(null)
  const onRecenterReady = useCallback((fn: () => void) => {
    recenterRef.current = fn
  }, [])

  // Near me: the chip, or the words "near me" typed into the search box.
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null)
  const [nearMe, setNearMe] = useState<'off' | 'locating' | 'on' | 'denied'>('off')

  const locate = useCallback(() => {
    setNearMe('locating')
    navigator.geolocation.getCurrentPosition(
      pos => { setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setNearMe('on') },
      () => setNearMe('denied'),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [])

  // The search box: a name, or a question such as "jian bing in rowland heights".
  // The rule is lib/place-search.ts, the same one the Sunzzari app is answered by.
  const search = useMemo(() => {
    const q = query.trim()
    if (!q) return null
    const searchable: SearchablePlace[] = items.flatMap(item => {
      const m = meta[placeIdOf(item.id)]
      if (!m) return []
      return [{
        id: item.id,
        name: item.name,
        kind: m.kind,
        region: m.region,
        neighborhood: m.neighborhood,
        location: m.locationText,
        goodFor: m.goodFor,
        topDishes: m.topDishes,
        comments: m.comments,
        address: m.address,
        branchAddresses: (item.branches ?? []).map(b => b.address),
        preference: m.preference,
        wantToTry: m.thinkingAbout,
        beenThere: m.done,
      }]
    })
    return searchPlaces(q, searchable)
  }, [items, meta, query])

  const askedNearMe = search?.nearMe ?? false
  useEffect(() => {
    if (askedNearMe && !userLocation && nearMe === 'off') locate()
  }, [askedNearMe, userLocation, nearMe, locate])

  const nearMeOn = !!userLocation && (nearMe === 'on' || askedNearMe)

  /** To the place, or to its nearest branch when it is a chain. */
  const distanceKm = useCallback(
    (item: TripItem): number | null => {
      if (!userLocation || !item.coordinates) return null
      const points = [item.coordinates, ...(item.branches ?? [])]
      return Math.min(...points.map(p => haversineKm(userLocation.lat, userLocation.lng, p.lat, p.lng)))
    },
    [userLocation]
  )

  const { shown, nearMeWidened } = useMemo(() => {
    const rank = search ? new Map(search.ids.map((id, n) => [id, n])) : null
    let list = items.filter(item => {
      const m = meta[placeIdOf(item.id)]
      if (!m) return false
      if (region && m.region !== region) return false
      if (kind && m.kind !== kind) return false
      if (wantToTryOnly && !m.thinkingAbout) return false
      if (hideBeenThere && m.done) return false
      if (rank && !rank.has(item.id)) return false
      return true
    })
    // Best match first: a match on the name outranks one in the notes.
    if (rank) list = [...list].sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
    if (!nearMeOn) return { shown: list, nearMeWidened: false }
    const near = nearest(list, distanceKm)
    return { shown: near.items, nearMeWidened: near.widened }
  }, [items, meta, region, kind, wantToTryOnly, hideBeenThere, search, nearMeOn, distanceKm])

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

  // A chain's branches are framed by the same rule as any pin: inside the fit
  // area they count, outside it (a San Diego branch) they stay on the map and
  // never stretch the frame.
  const fitScopeIds = useMemo(() => {
    const ids = new Set<string>()
    for (const i of mapped) {
      if (fitAreaContains(fitRegion, i.coordinates!.lat, i.coordinates!.lng)) ids.add(i.id)
      ;(i.branches ?? []).forEach((b, n) => {
        if (fitAreaContains(fitRegion, b.lat, b.lng)) ids.add(branchId(i.id, n))
      })
    }
    return ids
  }, [mapped, fitRegion])

  const fitKey = [
    region ?? 'allregions',
    kind ?? 'allkinds',
    wantToTryOnly ? 'want' : 'any',
    hideBeenThere ? 'nottried' : 'all',
    query.trim().toLowerCase(),
    nearMeOn ? 'nearme' : 'anywhere',
    `fit:${fitRegion}`,
  ].join('|')

  const styleFor = useCallback(
    (item: TripItem) => {
      const m = meta[placeIdOf(item.id)]
      const bg = m?.color ?? NOT_RATED_COLOR
      return { bg, border: bg, glyph: m?.kind === 'activity' ? '⚡' : '🍽️' }
    },
    [meta]
  )

  const hasFilters =
    region !== null || kind !== null || wantToTryOnly || hideBeenThere || query !== '' || nearMe !== 'off'

  function clearAll() {
    setRegion(null)
    setKind(null)
    setWantToTryOnly(false)
    setHideBeenThere(false)
    setQuery('')
    setNearMe('off')
    setUserLocation(null)
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

        <button
          onClick={() => {
            if (nearMe === 'off' || nearMe === 'denied') locate()
            else { setNearMe('off'); setUserLocation(null) }
            setSelected(null)
          }}
          className={`flex-shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${
            nearMeOn ? 'border-blue-400 bg-blue-500 text-white'
              : nearMe === 'denied' ? 'border-red-400/40 text-red-300'
              : 'border-blue-400/30 text-blue-300 hover:bg-white/5'
          }`}
        >
          {nearMe === 'locating' ? 'Locating...' : nearMe === 'denied' ? 'Location off' : 'Near me'}
        </button>

        <input
          type="search"
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            setSelected(null)
          }}
          placeholder="Search: a name, or chinese food near me"
          aria-label="Search places"
          className="ml-1 w-72 max-w-full flex-shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white placeholder:text-white/25 focus:border-amber-400/40 focus:outline-none"
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

      {(search?.understood || nearMeOn || (askedNearMe && nearMe === 'denied')) && (
        <p className="flex-shrink-0 px-4 pb-2 text-xs text-white/45">
          {search?.understood && <>Searching for: <span className="text-amber-200">{search.understood}</span></>}
          {search?.understood && (nearMeOn || nearMe === 'denied') ? ' - ' : ''}
          {nearMeOn && (nearMeWidened
            ? 'Nothing within 5 miles, so these are the nearest.'
            : shown.length === 0 ? 'Nothing within 5 miles.' : 'Within 5 miles, nearest first.')}
          {!nearMeOn && askedNearMe && nearMe === 'denied' && 'Location is off for this site, so this is every match.'}
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative h-[45vh] flex-shrink-0 lg:h-auto lg:flex-1">
          <TripMap
            items={shown}
            apiKey={apiKey}
            selected={selected}
            onSelect={setSelected}
            userLocation={nearMeOn ? userLocation : null}
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

          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
            className="absolute left-2 top-2 z-10 rounded bg-gray-950/70 px-1.5 py-0.5 text-[10px] text-white/70 backdrop-blur-sm hover:text-white"
          >
            Pins: © OpenStreetMap contributors, US Census
          </a>

          <div className="absolute bottom-4 left-4 z-10 rounded-xl border border-white/10 bg-gray-950/75 px-3 py-2.5 backdrop-blur-md">
            {LEGEND.map(row => (
              <div key={row.label} className="flex items-center gap-2 py-[2px]">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: row.color }} />
                <span className="text-[11px] font-medium text-white/75">{row.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div ref={panelRef} className="min-h-0 flex-1 overflow-y-auto lg:max-w-[420px] lg:border-l lg:border-white/10">
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
                    {[meta[placeIdOf(selected!.id)]?.address || meta[placeIdOf(selected!.id)]?.neighborhood || meta[placeIdOf(selected!.id)]?.locationText]
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
              ) : selected && meta[placeIdOf(selected.id)] ? (
                <PlaceEditor
                  item={selected}
                  meta={meta[placeIdOf(selected.id)]}
                  passcode={passcode}
                  onSaved={(next, locationChanged) => onSaved(placeIdOf(selected.id), next, locationChanged)}
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
              const m = meta[placeIdOf(item.id)]
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
                      {[
                        nearMeOn && distanceKm(item) !== null ? `${(distanceKm(item)! / 1.609).toFixed(1)} mi` : null,
                        m?.preference,
                        m?.neighborhood || m?.locationText,
                        m?.done ? 'Been there' : null,
                      ]
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
            dotColor={item => meta[placeIdOf(item.id)]?.color ?? NOT_RATED_COLOR}
            subtitle={item => {
              const m = meta[placeIdOf(item.id)]
              return [m?.kind === 'activity' ? 'Activity' : 'Restaurant', m?.locationText]
                .filter(Boolean)
                .join(' - ')
            }}
            note="No pin yet. Find it gives it one; or search it in Maps, or open its Notion row."
            onFind={item => {
              setAdding(false)
              setSelected(item)
              panelRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
            }}
            searchContext={item => {
              const m = meta[placeIdOf(item.id)]
              return [m?.neighborhood, m?.locationText].filter(Boolean).join(', ')
            }}
          />
        </div>
      </div>
    </main>
  )
}
