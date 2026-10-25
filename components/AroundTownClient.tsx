'use client'

import { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import TripMap from './TripMap'
import UnmappedList from './UnmappedList'
import { AddPlaceForm, PlaceEditor, UnlockForm, usePasscode } from './PlaceEditing'
import type { TripItem } from '@/lib/types'
import { haversineKm, type UserLocation } from '@/lib/geo'
import { searchPlaces, nearest, NEAR_ME_KM, type SearchablePlace } from '@/lib/place-search'
import { branchId, placeIdOf } from '@/lib/saved-pins'
// From the shared module, never from `lib/aroundtown` - that one imports the
// geocoder, which reads the coordinate table off disk, and a client component
// importing it drags node:fs into the browser bundle.
import type { AroundTownMeta, AroundTownKind, MapArea } from '@/lib/aroundtown-shared'
import {
  WANT_TO_TRY_COLOR,
  HAVENT_TRIED_COLOR,
  TRIED_COLOR,
  colorFor,
  areaFromCoords,
  areaFitContains,
  areaLabel,
  areaAtCenter,
  isHomeArea,
  mapAreas,
} from '@/lib/aroundtown-shared'

/**
 * Elisa's Map (was Around Town), on the trips' own map.
 *
 * No days anywhere: a place here is never assigned to a date, so the only axes
 * are where it is, what it is, and whether we have been.
 *
 * Elisa, 2026-10-25: "maybe around town should be changed to "Elisa's Map" but
 * default filter to LA. then i can pan to wherever. but hong kong restaurants
 * should not come up for if im in LA. it should be harder to expalnd my search
 * but it should be possible". So it opens on LA; the area menu, "Search
 * everywhere" and "Show places here" are the only ways out of the area.
 */

const LEGEND: Array<{ color: string; label: string }> = [
  { color: WANT_TO_TRY_COLOR, label: 'Bookmarked' },
  { color: HAVENT_TRIED_COLOR, label: "Haven't Tried" },
  { color: TRIED_COLOR, label: 'Tried' },
]

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

  // The area on show. Opens on LA, every time; null is Everywhere, reached only
  // from the area menu or "Search everywhere".
  const [region, setRegion] = useState<MapArea | null>('la')
  // The area the map is looking at after a pan, for "Show places here".
  const [viewArea, setViewArea] = useState<MapArea | null>(null)
  const onIdle = useCallback((c: { lat: number; lng: number }) => setViewArea(areaAtCenter(c.lat, c.lng)), [])
  const areas = useMemo(() => mapAreas(Object.values(initialMeta)), [initialMeta])
  const [kind, setKind] = useState<AroundTownKind | null>(null)
  const [wantToTryOnly, setWantToTryOnly] = useState(false)
  const [hideBeenThere, setHideBeenThere] = useState(false)
  // "Been There" is the opposite of "Haven't Tried"; the two are never on together.
  const [beenThereOnly, setBeenThereOnly] = useState(false)
  // On unless she turns it off (Elisa, 2026-10-11).
  const [hideBad, setHideBad] = useState(true)
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

  const { shown, unmapped, nearMeWidened, elsewhere } = useMemo(() => {
    const rank = search ? new Map(search.ids.map((id, n) => [id, n])) : null
    // Near me goes by distance from where she is, whatever the area: in Vienna
    // with near me on, Vienna is what shows.
    const area = nearMeOn ? null : region
    // An area choice cannot judge a place with no pin and no area: its region is
    // unknown, which is not the same as being somewhere else. It stays on the
    // page, in the unmapped list, so picking an area never buries it. Those
    // rows are home rows (a blank Location), so they stay with LA and the Bay
    // and do not crowd a travel area's list.
    const inArea = (item: TripItem, m: AroundTownMeta) =>
      !area || m.region === area || (m.region === null && !item.coordinates && isHomeArea(area))
    let outside = 0
    let list = items.filter(item => {
      const m = meta[placeIdOf(item.id)]
      if (!m) return false
      if (kind && m.kind !== kind) return false
      if (wantToTryOnly && !m.thinkingAbout) return false
      if (hideBeenThere && m.done) return false
      if (beenThereOnly && !m.done) return false
      if (hideBad && m.preference === 'Bad') return false
      if (rank && !rank.has(item.id)) return false
      if (!inArea(item, m)) { outside += 1; return false }
      return true
    })
    // Best match first: a match on the name outranks one in the notes.
    if (rank) list = [...list].sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
    // The unmapped list is taken BEFORE near me. Near me ranks by a distance a
    // place with no pin does not have, so `nearest` drops every one of them,
    // and the section used to vanish with the filter on. Elisa, 2026-10-19:
    // "make sure to always include an unmapped section so i dont lose out".
    // Near me narrows the map, never this list.
    const noPin = list.filter(i => !i.coordinates)
    // Matches the area is hiding: what "Search everywhere" would add.
    const elsewhere = rank ? outside : 0
    if (!nearMeOn) return { shown: list, unmapped: noPin, nearMeWidened: false, elsewhere }
    const near = nearest(list, distanceKm)
    return { shown: near.items, unmapped: noPin, nearMeWidened: near.widened, elsewhere }
  }, [items, meta, region, kind, wantToTryOnly, hideBeenThere, beenThereOnly, hideBad, search, nearMeOn, distanceKm])

  const mapped = shown.filter(i => i.coordinates)

  // With near me on, only the pins that are actually near are drawn: a chain
  // with one branch close by does not also show its branch across town. When
  // nothing is within 5 miles the radius grows to reach the nearest few.
  //
  // And with an area asked for ("cafe in san gabriel valley"), a matching
  // chain's branches outside that area are left off: the search names them.
  const pinFilter = useMemo(() => {
    const hidden = new Set(search?.hiddenPins ?? [])
    const near = nearMeOn && userLocation
      ? {
          from: userLocation,
          reach: nearMeWidened ? Math.max(0, ...shown.map(i => distanceKm(i) ?? 0)) : NEAR_ME_KM,
        }
      : null
    if (!near && hidden.size === 0) return undefined
    return (pin: { id: string; lat: number; lng: number }) =>
      !hidden.has(pin.id) &&
      (!near || haversineKm(near.from.lat, near.from.lng, pin.lat, pin.lng) <= near.reach + 0.01)
  }, [search, nearMeOn, userLocation, nearMeWidened, shown, distanceKm])

  // The ONE area a fit may span. Elisa, 2026-09-14: "id never want to fit all
  // between sf and la. id fit all within one area but not all areas." Her
  // explicit LA / SF Bay choice wins; with no choice made it is whichever area
  // holds more of the places on screen. Pins outside it stay on the map and
  // stay clickable, they just never stretch the frame.
  //
  // The vote uses the WIDE box on purpose - it is choosing LA vs the Bay, not
  // drawing the frame. The frame uses `fitAreaContains`, which is LA County
  // only, so San Diego and Orange County never stretch it.
  //
  // Everywhere is the same rule across the world: the frame is the one area
  // holding the most pins on show, never Hong Kong to LA.
  const fitRegion: MapArea = useMemo(() => {
    if (region && !nearMeOn) return region
    const votes = new Map<MapArea, number>()
    for (const item of mapped) {
      const r = areaFromCoords(item.coordinates!.lat, item.coordinates!.lng)
      if (r) votes.set(r, (votes.get(r) ?? 0) + 1)
    }
    let best: MapArea = 'la'
    let most = 0
    for (const [r, n] of votes) if (n > most || (n === most && r === 'la')) { best = r; most = n }
    return best
  }, [region, nearMeOn, mapped])

  // A chain's branches are framed by the same rule as any pin: inside the fit
  // area they count, outside it (a San Diego branch) they stay on the map and
  // never stretch the frame.
  const fitScopeIds = useMemo(() => {
    const ids = new Set<string>()
    //
    // A search frames wider: every match in the region, Orange County and San
    // Diego included, so a chain's branches are all in view (Mian's main branch
    // is in Costa Mesa). Her LA-proper frame is for browsing, not for answers.
    const searching = search !== null
    const inFrame = (lat: number, lng: number) =>
      searching ? areaFromCoords(lat, lng) === fitRegion : areaFitContains(fitRegion, lat, lng)
    const drawn = (id: string, pin: { lat: number; lng: number }) => !pinFilter || pinFilter({ id, ...pin })
    for (const i of mapped) {
      if (drawn(i.id, i.coordinates!) && inFrame(i.coordinates!.lat, i.coordinates!.lng)) ids.add(i.id)
      ;(i.branches ?? []).forEach((b, n) => {
        if (drawn(branchId(i.id, n), b) && inFrame(b.lat, b.lng)) ids.add(branchId(i.id, n))
      })
    }
    return ids
  }, [mapped, fitRegion, pinFilter, search])

  const fitKey = [
    region ?? 'allregions',
    kind ?? 'allkinds',
    wantToTryOnly ? 'want' : 'any',
    hideBeenThere ? 'nottried' : beenThereOnly ? 'been' : 'all',
    hideBad ? 'nobad' : 'bad',
    query.trim().toLowerCase(),
    nearMeOn ? 'nearme' : 'anywhere',
    `fit:${fitRegion}`,
  ].join('|')

  const styleFor = useCallback(
    (item: TripItem) => {
      const m = meta[placeIdOf(item.id)]
      const bg = m?.color ?? HAVENT_TRIED_COLOR
      return { bg, border: bg, glyph: m?.kind === 'activity' ? '⚡' : '🍽️' }
    },
    [meta]
  )

  const hasFilters =
    region !== 'la' || kind !== null || wantToTryOnly || hideBeenThere || beenThereOnly || !hideBad || query !== '' || nearMe !== 'off'

  function clearAll() {
    setRegion('la')
    setKind(null)
    setWantToTryOnly(false)
    setHideBeenThere(false)
    setBeenThereOnly(false)
    setHideBad(true)
    setQuery('')
    setNearMe('off')
    setUserLocation(null)
    setSelected(null)
  }

  const mappedList = (
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
              style={{ background: m?.color ?? HAVENT_TRIED_COLOR }}
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
  )

  // Says why the list can hold more than the filters above would suggest: with
  // near me or an area on, the places with no pin are kept rather than dropped.
  const unmappedNote = [
    'No pin yet.',
    nearMeOn ? 'Near me cannot place these.' : null,
    region ? 'Ones with no area yet are kept here too.' : null,
    'Find it gives it a pin; or search it in Maps, or open its Notion row.',
  ]
    .filter(Boolean)
    .join(' ')

  const unmappedList = (
    <UnmappedList
      items={unmapped}
      onSelect={setSelected}
      dotColor={item => meta[placeIdOf(item.id)]?.color ?? HAVENT_TRIED_COLOR}
      subtitle={item => {
        const m = meta[placeIdOf(item.id)]
        return [m?.kind === 'activity' ? 'Activity' : 'Restaurant', m?.locationText]
          .filter(Boolean)
          .join(' - ')
      }}
      title={search ? `${unmapped.length} with no pin yet` : undefined}
      note={unmappedNote}
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
  )

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
          <h1 className="font-display text-2xl leading-tight text-white">Elisa&apos;s Map</h1>
          <span className="text-xs text-white/30">no dates, just places</span>
        </div>
      </div>

      <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 px-4 pb-3">
        {/* One menu, not a chip per area: leaving LA is a deliberate step. */}
        <label className="flex-shrink-0">
          <span className="sr-only">Area</span>
          <select
            id="map-area"
            value={region ?? 'everywhere'}
            onChange={e => {
              setRegion(e.target.value === 'everywhere' ? null : e.target.value)
              setSelected(null)
            }}
            className="rounded-full border border-indigo-400 bg-indigo-500 px-2.5 py-1 text-xs font-medium text-white focus:outline-none"
          >
            {areas.map(a => (
              <option key={a.id} value={a.id}>{a.label} ({a.count})</option>
            ))}
            <option value="everywhere">Everywhere</option>
          </select>
        </label>

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

        <Chip
          label="Been There"
          on={beenThereOnly}
          onClick={() => {
            setBeenThereOnly(!beenThereOnly)
            setHideBeenThere(false)
          }}
        />
        <Chip
          label="Haven't Tried"
          on={hideBeenThere}
          tone="green"
          onClick={() => {
            setHideBeenThere(!hideBeenThere)
            setBeenThereOnly(false)
          }}
        />
        <Chip label="Hide Bad" on={hideBad} onClick={() => setHideBad(!hideBad)} />
        <Chip label="Bookmarked" on={wantToTryOnly} onClick={() => setWantToTryOnly(!wantToTryOnly)} />

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
          {region !== null && !nearMeOn && viewArea && viewArea !== region && areas.some(a => a.id === viewArea) && (
            <button
              onClick={() => {
                setRegion(viewArea)
                setSelected(null)
              }}
              className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full border border-indigo-400 bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white shadow-lg"
            >
              Show places in {areaLabel(viewArea)}
            </button>
          )}
          <TripMap
            onIdle={onIdle}
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
            pinFilter={pinFilter}
            bubblesTakePinColour
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
                  Sign out of the travel map on this browser
                </button>
              )}
            </section>
          )}

          {search && (
            <p className="border-b border-white/10 px-4 py-3 text-sm text-white">
              {shown.length === 0
                ? (elsewhere > 0 && region ? `None in ${areaLabel(region)}` : 'No saved place matches.')
                : `${shown.length} match${shown.length === 1 ? '' : 'es'}${region && !nearMeOn ? ` in ${areaLabel(region)}` : ''}`}
              <span className="text-white/40"> for "{query.trim()}"</span>
              {elsewhere > 0 && (
                <>
                  <span className="text-white/40"> · {elsewhere} elsewhere </span>
                  <button
                    onClick={() => {
                      setRegion(null)
                      setSelected(null)
                    }}
                    className="ml-1 rounded-full border border-amber-400/40 px-2 py-0.5 text-xs font-medium text-amber-300 hover:bg-white/5"
                  >
                    Search everywhere
                  </button>
                </>
              )}
            </p>
          )}

          {/* While searching, a match with no pin is listed first: it is not on
              the map, so the list is the only place she can see it. */}
          {search && unmappedList}

          {(!search || mapped.length > 0) && mappedList}

          {!search && unmappedList}
        </div>
      </div>
    </main>
  )
}
