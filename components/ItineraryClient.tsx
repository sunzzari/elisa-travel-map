'use client'

import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import Link from 'next/link'
import TripMap, { markerStyle, type MarkerStyle } from './TripMap'
import UnmappedList from './UnmappedList'
import PlanPanel, { StatusEditor, StatusControl, STATUS_DOT, type Section } from './PlanPanel'
import TripCalendar from './TripCalendar'
import { usePasscode } from './PlaceEditing'
import { groupDays, groupLegs, planDay, formatLongDate, todayInZone, isDone, type DayPlan, type PlannedItem } from '@/lib/day'
import { buildPlan, groupOf, stopNumbers, GROUPS, ALL_GROUPS, type Group } from '@/lib/plan'
import { haversineKm } from '@/lib/geo'
import type { Trip, TripItem, ItemType, TripLeg, TripTask, Loaded } from '@/lib/types'
import type { UserLocation } from '@/lib/geo'

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

type View = 'plan' | 'trip'

/** English search words and the local forms they appear as in place names. */
const LOCAL_FORMS: Record<string, string[]> = {
  market: ['markt', 'marché', 'mercato', 'mercado'],
  markets: ['markt', 'marché', 'mercato', 'mercado'],
  christmas: ['christkind', 'weihnacht', 'noël', 'natale'],
  palace: ['schloss', 'palais', 'palazzo', 'palacio'],
  castle: ['schloss', 'burg', 'château', 'castello'],
  church: ['kirche', 'dom', 'église', 'chiesa'],
  station: ['bahnhof', 'gare', 'stazione', 'estación'],
  garden: ['garten', 'jardin', 'giardino'],
  coffee: ['kaffee', 'café', 'caffè'],
  bakery: ['bäckerei', 'boulangerie', 'panificio'],
}
// Every group is on by default, Considering included. Elisa, 2026-10-18: "all
// of the 'considering' should display on the map with easy toggle on/off".
const SECTIONS: Section[] = ['summary', 'todo', 'coverage', 'days']

// Every setting the views are made of lives in the URL, so any view can be
// bookmarked and reopens the same. Elisa, 2026-10-18: "i want this map to be
// highly modular in terms of the views i can make".
function readList<T extends string>(params: URLSearchParams, key: string, allowed?: readonly T[]): T[] | null {
  const raw = params.get(key)
  if (raw === null) return null
  const list = raw.split(',').map(decodeURIComponent).filter(Boolean) as T[]
  return allowed ? list.filter(v => allowed.includes(v)) : list
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
  legs: Loaded<TripLeg[]>
  tasks: Loaded<TripTask[]>
  apiKey: string
}

export default function ItineraryClient({ trip, items: loadedItems, legs: legRows, tasks, apiKey }: Props) {
  // A status saved from the Plan tab shows at once; the page itself catches up
  // on its next 60s refresh. The saved row keeps the pin the page already had.
  const [saved, setSaved] = useState<Record<string, TripItem>>({})
  const items = useMemo(
    () => loadedItems.map(i => (saved[i.id] ? { ...i, ...saved[i.id], coordinates: saved[i.id].coordinates ?? i.coordinates } : i)),
    [loadedItems, saved]
  )
  const days = useMemo(() => groupDays(items), [items])
  const allDates = useMemo(() => days.map(d => d.dateString), [days])
  const datedPlans = useMemo(() => days.map(d => planDay(d, allDates)), [days, allDates])

  // A trip with nothing scheduled yet has no dated items, which is the normal
  // state now that nothing gets a date without her approval. Fall back to
  // grouping by leg so the map and the list still have something to show.
  const byLeg = datedPlans.length === 0
  const plans = useMemo(() => (byLeg ? groupLegs(items) : datedPlans), [byLeg, items, datedPlans])

  // null means "all days".
  // Every "is this today / is this past" question resolves in the TRIP's
  // timezone, not the browser's.
  const today = useMemo(() => todayInZone(trip.timeZone), [trip.timeZone])
  // Opens on ALL, never pre-filtered to a day. Elisa, 2026-09-08: "open the app
  // to a very functional map 100% of the time... and then ALSO to toggle today
  // view which filters the map". Today is one tap away in the chip row.
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  // Plan tab: opens on Plan until the trip starts (in the trip's own zone),
  // on the day view once it has.
  const planningStage = !trip.departureDate || today < trip.departureDate
  const [view, setView] = useState<View>(planningStage ? 'plan' : 'trip')
  // Booked / Planned / To book / Considering: the one filter the chip row, the
  // summary tiles and the map switch all share (lib/plan.ts GROUPS).
  const [groups, setGroups] = useState<Set<Group>>(new Set(ALL_GROUPS))
  // The calendar is a switch on the Plan tab. While it is on, its day headers
  // pick the day, so the date bar steps aside for room. Elisa, 2026-10-18:
  // "when you display the calendar (toggleable on and off) you get rid of the
  // date bar up top to make more room".
  const [calendarOn, setCalendarOn] = useState(false)
  const showCalendar = view === 'plan' && calendarOn
  const [hidden, setHidden] = useState<Set<Section>>(new Set())
  const { passcode, lock } = usePasscode()
  const plan = useMemo(() => buildPlan(trip, legRows.ok ? legRows.value : [], items), [trip, legRows, items])
  const planDayNow = view !== 'trip' && selectedDate ? plan.days.find(d => d.date === selectedDate) ?? null : null

  // In leg mode there is no "today", so default to showing everything.
  const effectiveSelected = view !== 'trip' ? (planDayNow ? selectedDate : null) : byLeg ? null : selectedDate
  // Types and legs start ALL ON, like the group chips: a chip that looks off
  // is hidden, a chip that looks on is shown. Elisa, 2026-10-18: "the default
  // should be select all. and there should be select all buttons." Before, an
  // empty selection meant "all", so every chip looked off while all showed.
  const [hiddenTypes, setHiddenTypes] = useState<Set<ItemType>>(new Set())
  const [selected, setSelected] = useState<TripItem | null>(null)

  // Ask-about-this-trip. Answers come from her own items only.
  const [askOpen, setAskOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)
  const [askError, setAskError] = useState<string | null>(null)
  const [matchedIds, setMatchedIds] = useState<string[]>([])

  // Ported from the trip map before it was retired: this is the one map now,
  // so everything that was only available there has to live here.
  const [query, setQuery] = useState('')
  const [hiddenLegs, setHiddenLegs] = useState<Set<string>>(new Set())
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null)
  const [nearMe, setNearMe] = useState<'off' | 'locating' | 'on' | 'denied'>('off')
  const recenterRef = useRef<(() => void) | null>(null)
  const onRecenterReady = useCallback((fn: () => void) => { recenterRef.current = fn }, [])

  const visiblePlans = effectiveSelected ? plans.filter(p => p.dateString === effectiveSelected) : plans

  const liveItems = useMemo(
    () => items.filter(i => i.status && i.status !== 'Cancelled'),
    [items]
  )

  // Everything on the visible day(s): what is scheduled, plus the candidates
  // for that leg. Status colour on the marker already distinguishes them.
  //
  // On ALL the pool is every item still in play rather than the union of the
  // day plans: an item with no date AND no leg belongs to no plan, so it would
  // never reach the map. Elisa, 2026-09-08: "the whole map should be visible no
  // matter if things are or not assigned."
  const pool = useMemo(() => {
    // A search looks across the whole trip, whatever day is picked.
    if (query.trim()) return liveItems
    // Plan and Calendar draw the map the same way; only their side differs.
    if (view !== 'trip') {
      // A day shows its own plans plus EVERY Considering item on the trip, not
      // only that leg's: her words, "all of the 'considering' should display on
      // the map". The map stays framed on the day's plans, so other-city ideas
      // sit off-frame. Which groups show is decided by `matches`.
      if (planDayNow) {
        const list = [...planDayNow.committed.map(c => c.item), ...liveItems.filter(i => groupOf(i) === 'considering')]
        return list.filter((item, i, arr) => arr.findIndex(c => c.id === item.id) === i)
      }
      return liveItems
    }
    if (!effectiveSelected) return liveItems
    const list = visiblePlans.flatMap(p => [...p.timeline.map(x => x.item), ...p.anytime.map(x => x.item), ...p.options])
    return list.filter((item, i, arr) => arr.findIndex(c => c.id === item.id) === i)
  }, [query, view, planDayNow, effectiveSelected, liveItems, visiblePlans])

  const presentTypes = useMemo(
    () => TYPE_ORDER.filter(t => pool.some(i => (i.type ?? 'Other') === t)),
    [pool]
  )

  // ONE predicate for the map and the day panel. They were separate, so
  // toggling Restaurant filtered the pins and left the list showing everything.
  const q = query.trim().toLowerCase()
  const NEAR_KM = 5

  // Every filter but the group, so each group chip can count what it would add.
  const matchesExceptGroup = useCallback((i: TripItem) => (
    !hiddenTypes.has((i.type ?? 'Other') as ItemType) &&
    !hiddenLegs.has(i.legCity) &&
    (!q || [i.name, i.venue, i.address, i.type ?? '', i.legCity, i.notes].some(f => f.toLowerCase().includes(q))) &&
    (nearMe !== 'on' || !userLocation || (
      !!i.coordinates && haversineKm(userLocation.lat, userLocation.lng, i.coordinates.lat, i.coordinates.lng) <= NEAR_KM
    ))
  ), [hiddenTypes, hiddenLegs, q, nearMe, userLocation])

  // A search overrides every filter: all items, all days. Elisa, 2026-10-18:
  // "a search should always search ALL TRIP ITEMS ON ALL DAYS. i dont want the
  // filters to be applied. it should override the filters." Clearing the
  // search brings the filters back as they were.
  // Notes count: "Salzburg Christkindlmarkt" says "market" only in its notes.
  // Elisa, 2026-10-19: "the name is 'markt' but when i search 'market' it
  // should come up because that word is in the notes". Name matches list
  // first; notes-only matches follow, marked "in notes".
  // An English word also finds its local form in names, so the Salzburg
  // Christkindlmarkt ranks with the markets, not after passing mentions.
  const nameMatch = useCallback((i: TripItem) => {
    const words = [q, ...(LOCAL_FORMS[q] ?? [])]
    return [i.name, i.venue, i.address, i.type ?? '', i.legCity].some(f => words.some(w => f.toLowerCase().includes(w)))
  }, [q])
  const textMatch = useCallback((i: TripItem) =>
    nameMatch(i) || i.notes.toLowerCase().includes(q), [q, nameMatch])

  const matches = useCallback((i: TripItem) => {
    if (q) return textMatch(i)
    const g = groupOf(i)
    return g !== null && groups.has(g) && matchesExceptGroup(i)
  }, [q, textMatch, groups, matchesExceptGroup])

  // Search results: the list under the search bar, the dates to highlight and
  // the cards on the map. Elisa, 2026-10-18: "as im searching, matching items
  // should come up below the search bar. and if the thing is assigned to a
  // date that date should be highlighted. and the white cards on the map for
  // the results should come up."
  const searchResults = useMemo(() => {
    if (!q) return []
    const when = (i: TripItem) => i.assignedToDate ?? i.date ?? '9999'
    const rank = (i: TripItem) => (nameMatch(i) ? 0 : 1)
    return liveItems.filter(matches).sort((a, b) => rank(a) - rank(b) || when(a).localeCompare(when(b)) || a.name.localeCompare(b.name))
  }, [q, liveItems, matches, nameMatch])
  const matchDates = useMemo(() => {
    const out = new Set<string>()
    for (const i of searchResults) {
      const start = i.assignedToDate ?? i.date
      if (!start) continue
      const end = i.assignedToDateEnd ?? i.dateEnd
      if (i.type === 'Hotel' && end && end > start) {
        for (let d = start; d < end; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)) out.add(d)
      } else out.add(start)
    }
    return out
  }, [searchResults])
  const [searchOpen, setSearchOpen] = useState(false)

  const legs = useMemo(
    () => Array.from(new Set(items.map(i => i.legCity).filter(Boolean))).sort(),
    [items]
  )

  // Restore a bookmarked view, then keep the URL in step with every toggle.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const v = params.get('view')
    if (v === 'plan' || v === 'trip') setView(v)
    if (v === 'calendar') { setView('plan'); setCalendarOn(true) } // an earlier bookmark
    if (params.get('cal') === '1') setCalendarOn(true)
    const day = params.get('day')
    if (day) setSelectedDate(day)
    const g = readList(params, 'show', ALL_GROUPS)
    if (g) setGroups(new Set(g))
    const h = readList(params, 'hide', SECTIONS)
    if (h) setHidden(new Set(h))
    const t = readList<ItemType>(params, 'hideTypes')
    if (t) setHiddenTypes(new Set(t))
    const lg = readList(params, 'hideLegs')
    if (lg) setHiddenLegs(new Set(lg))
    const sq = params.get('q')
    if (sq) setQuery(sq)
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    const params = new URLSearchParams()
    const join = (set: Set<string>) => Array.from(set).map(encodeURIComponent).join(',')
    params.set('view', view)
    if (showCalendar) params.set('cal', '1')
    if (selectedDate) params.set('day', selectedDate)
    if (groups.size !== ALL_GROUPS.length) params.set('show', join(groups))
    if (hidden.size) params.set('hide', join(hidden))
    if (hiddenTypes.size) params.set('hideTypes', join(hiddenTypes))
    if (hiddenLegs.size) params.set('hideLegs', join(hiddenLegs))
    if (query.trim()) params.set('q', query.trim())
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`)
  }, [hydrated, view, showCalendar, selectedDate, groups, hidden, hiddenTypes, hiddenLegs, query])

  const numbers = useMemo(() => (planDayNow ? stopNumbers(planDayNow) : new Map<string, number>()), [planDayNow])
  // On a planned day the map frames her plans; a candidate across the region
  // must not zoom it out to the whole country. A day with no plans frames all.
  //
  // With a filter on (Restaurant, a status, a leg, a search), or fewer than two
  // plans left to frame, the frame widens to this leg's matching ideas too.
  // Elisa, 2026-10-18: "when i toggle 'restaurant' it does not filter for the
  // 'considering'" - it did, but the map zoomed onto her two planned cafes and
  // every Considering restaurant sat off-screen.
  // All days: frame the trip, not the flights. With a pin at both ends, the
  // flight home would zoom the whole trip out to San Francisco. Flights stay
  // drawn; a selected day still frames its own flight.
  const allDaysFitIds = useMemo(() => {
    const ids = items.filter(i => i.coordinates && i.type !== 'Flight' && matches(i)).map(i => i.id)
    return ids.length ? new Set(ids) : undefined
  }, [items, matches])

  const planFitIds = useMemo(() => {
    if (!planDayNow) return allDaysFitIds
    const onMap = (i: TripItem) => !!i.coordinates && matches(i)
    const plans = planDayNow.committed.map(c => c.item).filter(onMap)
    // Elisa, 2026-10-18: "the zoom should keep the considering on screen".
    // So with Considering on, this leg's ideas are in the frame - those within
    // FRAME_KM of the day. One Wachau day-trip idea 70km out would otherwise
    // zoom a Vienna day out to the whole region.
    const FRAME_KM = 15
    const legIdeas = groups.has('considering') ? planDayNow.considering.filter(onMap) : []
    const anchor = plans.length ? plans : legIdeas
    const mid = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
    const centre = anchor.length
      ? { lat: mid(anchor.map(i => i.coordinates!.lat)), lng: mid(anchor.map(i => i.coordinates!.lng)) }
      : null
    const ideas = centre
      ? legIdeas.filter(i => haversineKm(centre.lat, centre.lng, i.coordinates!.lat, i.coordinates!.lng) <= FRAME_KM)
      : []
    const ids = [...plans, ...ideas].map(i => i.id)
    return ids.length ? new Set(ids) : undefined
  }, [planDayNow, matches, groups, allDaysFitIds])
  // Plan tab pins: the day's stops numbered 1, 2, 3 in order; candidates small
  // and faded so they never read as plans.
  const planStyle = useCallback((item: TripItem): MarkerStyle => {
    const base = markerStyle(item)
    if (groupOf(item) === 'considering') return { ...base, size: 24, opacity: 0.6 }
    const n = numbers.get(item.id)
    return n ? { ...base, glyph: String(n) } : base
  }, [numbers])

  function toggleGroup(group: Group) {
    setGroups(prev => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group); else next.add(group)
      return next
    })
    setSelected(null)
  }

  // A summary tile shows only its group; tapping the same tile again shows all.
  function soloGroup(group: Group) {
    setGroups(prev => (prev.size === 1 && prev.has(group) ? new Set(ALL_GROUPS) : new Set([group])))
    setSelected(null)
  }

  function toggleSection(section: Section) {
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section); else next.add(section)
      return next
    })
  }

  function requestNearMe() {
    if (nearMe === 'on') { setNearMe('off'); setUserLocation(null); return }
    setNearMe('locating')
    navigator.geolocation.getCurrentPosition(
      pos => { setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setNearMe('on') },
      () => setNearMe('denied'),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const todayIsInTrip = view !== 'trip' ? plan.days.some(d => d.date === today) : plans.some(p => p.dateString === today)
  const chipPlans = view !== 'trip' ? plan.days.map(d => ({ dateString: d.date })) : plans
  const chipByLeg = view !== 'trip' ? false : byLeg

  const shown = matchedIds.length > 0
    ? pool.filter(i => matchedIds.includes(i.id))
    : pool.filter(matches)
  const mapped = shown.filter(i => i.coordinates)
  const unmapped = shown.length - mapped.length

  const fitKey = [
    view,
    Array.from(groups).sort().join(','),
    selectedDate ?? 'all',
    // Every filter is in the key, so the map re-frames on what is left.
    // Search was missing: it filtered the pins but left the map zoomed out on
    // the whole country, so it looked like it did nothing.
    Array.from(hiddenTypes).sort().join(',') || 'alltypes',
    Array.from(hiddenLegs).sort().join(',') || 'alllegs',
    q || 'nosearch',
    matchedIds.join(',') || 'noask',
  ].join('|')

  async function ask(e: React.FormEvent) {
    e.preventDefault()
    const q = question.trim()
    if (!q || asking) return
    setAsking(true); setAskError(null); setAnswer(null); setMatchedIds([])
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q, tripId: trip.id }),
      })
      const data = await res.json()
      if (!res.ok) { setAskError(data.error ?? 'Something went wrong.'); return }
      setAnswer(data.answer ?? '')
      setMatchedIds(data.matchedItemIds ?? [])
    } catch {
      setAskError('No connection. This one needs signal.')
    } finally {
      setAsking(false)
    }
  }

  function toggleType(type: ItemType) {
    setHiddenTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type); else next.add(type)
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
        <div className="flex flex-shrink-0 rounded-full border border-white/15 p-0.5 text-xs font-semibold">
          {(['plan', 'trip'] as View[]).map(v => (
            <button
              key={v}
              onClick={() => {
                setView(v); setSelected(null)
                // Its button is hidden on Plan, so a filter left on there could not be seen or undone.
                if (v !== 'trip') { setNearMe('off'); setUserLocation(null) }
              }}
              className={`rounded-full px-2.5 py-1 transition-colors sm:px-3 ${view === v ? 'bg-amber-400 text-gray-950' : 'text-white/60 hover:text-white'}`}
            >
              {v === 'plan' ? 'Plan' : 'Trip'}
            </button>
          ))}
        </div>
        {view === 'plan' && (
          <button
            onClick={() => setCalendarOn(on => !on)}
            aria-pressed={calendarOn}
            className={`flex-shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
              calendarOn ? 'border-amber-400 bg-amber-400/15 text-amber-300' : 'border-white/15 text-white/60 hover:text-white'
            }`}
          >
            Calendar
          </button>
        )}
        <div className="relative hidden flex-shrink-0 sm:block">
          <input
            value={query}
            // Typing closes any open popup so the results show (Elisa, 2026-10-18:
            // "the search does not work at all when something is clicked").
            onChange={e => { setQuery(e.target.value); setSelected(null); setSearchOpen(true) }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); setSearchOpen(false) } }}
            placeholder="Search"
            className="w-48 rounded-full border border-white/15 bg-white/10 py-1 pl-3 pr-7 text-xs text-white placeholder:text-white/35 focus:border-amber-400/40 focus:outline-none"
          />
          {query && (
            // One tap clears the search and brings the filters back.
            <button
              onMouseDown={e => e.preventDefault()}
              onClick={() => { setQuery(''); setSearchOpen(false); setSelected(null) }}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-[11px] text-white/80 hover:bg-white/25"
            >
              ✕
            </button>
          )}
          {searchOpen && q && (
            <div className="absolute right-0 top-full z-30 mt-1.5 max-h-[60vh] w-80 overflow-y-auto rounded-xl border border-white/10 bg-gray-900 py-1 shadow-2xl">
              <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-white/35">
                {searchResults.length} match{searchResults.length === 1 ? '' : 'es'}
              </p>
              {searchResults.length === 0 && <p className="px-3 pb-2 text-xs text-white/45">Nothing on this trip matches.</p>}
              {searchResults.map(item => {
                const day = item.assignedToDate ?? item.date
                return (
                  <button
                    key={item.id}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { setSelected(item); setSearchOpen(false) }}
                    className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-white/5"
                  >
                    <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full" style={{ background: STATUS_DOT[item.status ?? ''] ?? '#8E8E93' }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-white">{item.name}</span>
                      <span className="block truncate text-[11px] text-white/45">
                        {[item.type, day ? formatLongDate(day, { weekday: 'short', month: 'short', day: 'numeric' }) : 'No day yet', item.legCity, nameMatch(item) ? null : 'in notes', item.coordinates ? null : 'not on the map'].filter(Boolean).join(' - ')}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
        {/* Near me is for standing in the city; the Plan tab gives its room to the trip name. */}
        {view === 'trip' && <button
          onClick={requestNearMe}
          className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            nearMe === 'on' ? 'bg-blue-500 text-white'
              : nearMe === 'denied' ? 'border border-red-400/40 text-red-300'
              : 'border border-white/15 text-white/60 hover:text-white'
          }`}
        >
          {nearMe === 'locating' ? '...' : nearMe === 'denied' ? 'Location off' : 'Near me'}
        </button>}
        <button
          onClick={() => setAskOpen(v => !v)}
          className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
            askOpen ? 'bg-amber-400 text-gray-950' : 'bg-amber-400/15 text-amber-300 hover:bg-amber-400/25'
          }`}
        >
          Ask
        </button>
      </header>

      {askOpen && (
        <div className="flex-shrink-0 border-b border-white/10 bg-gray-900 px-4 py-3">
          <form onSubmit={ask} className="flex gap-2">
            <input
              autoFocus
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder="Where should I eat that's close to Main Street?"
              className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-white placeholder:text-white/35 focus:border-amber-400/40 focus:outline-none"
            />
            <button
              type="submit"
              disabled={asking || !question.trim()}
              className="flex-shrink-0 rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-gray-950 disabled:opacity-40"
            >
              {asking ? '...' : 'Ask'}
            </button>
          </form>

          <p className="mt-2 text-[11px] text-white/30">
            Answers come from the places already on this trip, not from the internet.
          </p>

          {askError && (
            <p className="mt-2 rounded-lg border border-orange-400/30 bg-orange-400/10 px-3 py-2 text-xs text-orange-300">
              {askError}
            </p>
          )}

          {answer && (
            <div className="mt-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/90">{answer}</p>
              {matchedIds.length > 0 && (
                <button
                  onClick={() => { setMatchedIds([]); setAnswer(null) }}
                  className="mt-2 text-xs text-amber-400 underline"
                >
                  Showing {matchedIds.length} on the map - clear
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Date chips. "All days" first so it is reachable without scrolling.
          Hidden while the calendar is on: its day headers do the same job. */}
      {!showCalendar && <div className="flex flex-shrink-0 gap-1.5 overflow-x-auto border-b border-white/10 bg-gray-900 px-4 py-2" style={{ scrollbarWidth: 'none' }}>
        <button
          onClick={() => { setSelectedDate(null); setSelected(null) }}
          className={`flex-shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
            selectedDate === null ? 'bg-amber-400 text-gray-950' : 'bg-white/10 text-white/70 hover:bg-white/15'
          }`}
        >
          {chipByLeg ? 'Everywhere' : 'All days'}
        </button>
        {todayIsInTrip && (
          <button
            onClick={() => { setSelectedDate(today); setSelected(null) }}
            className={`flex-shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
              effectiveSelected === today ? 'bg-amber-400 text-gray-950' : 'bg-amber-400/20 text-amber-300 hover:bg-amber-400/30'
            }`}
          >
            Today
          </button>
        )}
        {chipPlans.map(plan => {
          const active = plan.dateString === (view !== 'trip' ? selectedDate : effectiveSelected)
          const isToday = !chipByLeg && plan.dateString === today
          const past = !chipByLeg && plan.dateString < today
          return (
            <button
              key={plan.dateString}
              onClick={() => { setSelectedDate(plan.dateString); setSelected(null) }}
              className={`flex-shrink-0 rounded-xl px-3 py-1 text-center transition-colors ${
                active ? 'bg-amber-400 text-gray-950' : past ? 'bg-white/5 text-white/35 hover:bg-white/10' : 'bg-white/10 text-white/70 hover:bg-white/15'
              } ${matchDates.has(plan.dateString) && !active ? 'bg-amber-400/25 text-amber-100 ring-2 ring-amber-300' : isToday && !active ? 'ring-1 ring-amber-400/50' : ''}`}
            >
              {chipByLeg ? (
                <span className="block px-1 text-sm font-semibold leading-tight">{plan.dateString}</span>
              ) : (
                <>
                  <span className="block text-[10px] uppercase leading-none opacity-70">
                    {formatLongDate(plan.dateString, { weekday: 'short' })}
                  </span>
                  <span className="block text-sm font-semibold leading-tight">
                    {formatLongDate(plan.dateString, { month: 'short', day: 'numeric' })}
                  </span>
                </>
              )}
            </button>
          )
        })}
      </div>}

      {/* One row for what is shown: Booked / Planned / To book / Considering.
          Each chip switches its group on or off; the summary tiles change the
          same four. The map's own Considering switch was removed as a second
          control for the same thing (Elisa, 2026-10-18: "that is redundant"). Replaced a layer row and a status row
          (audit H1, 2026-10-18). Same row on both tabs. */}
      {q && (
        <div className="flex-shrink-0 border-b border-amber-400/20 bg-amber-400/10 px-4 py-1.5 text-xs text-amber-200">
          Searching every item on every day; filters are paused.{' '}
          <button onClick={() => setQuery('')} className="underline">Clear search</button>
        </div>
      )}
      <div className={`flex flex-shrink-0 items-center gap-1.5 overflow-x-auto border-b border-white/10 bg-gray-900 px-4 py-2 ${q ? 'pointer-events-none opacity-35' : ''}`} style={{ scrollbarWidth: 'none' }}>
        {GROUPS.map(({ id, label, statuses }) => {
          const on = groups.has(id)
          const color = STATUS_DOT[statuses[0]] ?? '#8E8E93'
          const count = pool.filter(i => groupOf(i) === id && matchesExceptGroup(i)).length
          return (
            <button
              key={id}
              onClick={() => toggleGroup(id)}
              aria-pressed={on}
              className={`flex flex-shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${on ? '' : 'border-dashed'}`}
              style={{
                background: on ? color : 'transparent',
                borderColor: on ? color : 'rgba(255,255,255,0.2)',
                color: on ? '#0b0b0d' : 'rgba(255,255,255,0.55)',
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: on ? '#0b0b0d' : color }} />
              {label} <span className="opacity-60">{count}</span>
            </button>
          )
        })}
        <SelectAll
          active={groups.size !== ALL_GROUPS.length}
          onClick={() => { setGroups(new Set(ALL_GROUPS)); setSelected(null) }}
        />
      </div>

      {/* Type chips. Only the types actually present, so a Ferry toggle never
          shows up on a Utah ski weekend. */}
      <div className={`flex flex-shrink-0 items-center gap-1.5 overflow-x-auto border-b border-white/10 bg-gray-900 px-4 py-2 ${q ? '[&>button]:pointer-events-none [&>button]:opacity-35' : ''}`} style={{ scrollbarWidth: 'none' }}>
        {presentTypes.map(type => {
          const on = !hiddenTypes.has(type)
          const meta = TYPE_META[type] ?? TYPE_META.Other
          return (
            <button
              key={type}
              onClick={() => toggleType(type)}
              className="flex flex-shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all"
              style={{
                background: on ? meta.color : 'transparent',
                borderColor: on ? meta.color : 'rgba(255,255,255,0.15)',
                color: on ? '#0b0b0d' : 'rgba(255,255,255,0.45)',
                borderStyle: on ? 'solid' : 'dashed',
              }}
            >
              <span>{meta.glyph}</span>
              {type}
            </button>
          )
        })}
        <SelectAll active={hiddenTypes.size > 0} onClick={() => { setHiddenTypes(new Set()); setSelected(null) }} />
        {legs.length > 1 && !byLeg && legs.map(leg => {
          const on = !hiddenLegs.has(leg)
          return (
            <button
              key={leg}
              onClick={() => {
                setHiddenLegs(prev => {
                  const next = new Set(prev)
                  if (next.has(leg)) next.delete(leg); else next.add(leg)
                  return next
                })
                setSelected(null)
              }}
              className={`flex-shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${
                on ? 'border-indigo-400 bg-indigo-500 text-white' : 'border-dashed border-white/20 text-white/45 hover:bg-white/5'
              }`}
            >
              {leg}
            </button>
          )
        })}
        {legs.length > 1 && !byLeg && (
          <SelectAll active={hiddenLegs.size > 0} onClick={() => { setHiddenLegs(new Set()); setSelected(null) }} />
        )}
        <span className="flex-shrink-0 pl-2 text-xs text-white/30">
          {mapped.length} on the map{unmapped > 0 ? ` - ${unmapped} without a location` : ''}
        </span>
      </div>

      {/* Map is the page. On a laptop it sits beside the plan; on a phone the
          plan scrolls underneath it. */}
      {/* Phone: the calendar sits above the map. Laptop: it takes the right
          column and the map keeps the full height, so a pin's popup is never
          cut off. Elisa, 2026-10-18: "its still very clunky when i have the
          calendar open and the map. i cant read the card on the map." */}
      {showCalendar && (
        <div className="max-h-[45vh] flex-shrink-0 overflow-auto border-b border-white/10 bg-gray-950 lg:hidden">
          <TripCalendar
            plan={plan}
            matches={matches}
            selectedDate={selectedDate}
            onSelectDate={date => { setSelectedDate(date); setSelected(null) }}
            selected={selected}
            onSelectItem={(item, date) => { setSelectedDate(date); setSelected(item) }}
            highlightDates={matchDates}
            today={today}
          />
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className={showCalendar ? 'relative min-h-[260px] flex-1' : 'relative h-[45vh] flex-shrink-0 lg:h-auto lg:flex-1'}>
          <TripMap
            items={shown}
            apiKey={apiKey}
            selected={selected}
            onSelect={setSelected}
            userLocation={null}
            onRecenterReady={onRecenterReady}
            fitKey={fitKey}
            styleFor={view !== 'trip' ? planStyle : undefined}
            cards={q ? searchResults : undefined}
            fitScopeIds={q ? undefined : view !== 'trip' ? planFitIds : effectiveSelected ? undefined : allDaysFitIds}
            popupExtra={view !== 'trip' ? item => (
              // Plan, book or drop right from the pin. Elisa, 2026-10-18:
              // "theres no way for me to toggle, confirm, or assign to date in
              // the map". It was only in the side panel.
              <StatusControl
                key={item.id}
                item={items.find(i => i.id === item.id) ?? item}
                dates={plan.days.map(d => d.date)}
                defaultDate={selectedDate}
                passcode={passcode}
                onSaved={saved => {
                  setSaved(prev => ({ ...prev, [saved.id]: saved }))
                  setSelected(null)
                }}
              />
            ) : undefined}
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

        {showCalendar && (
          <div className="hidden min-h-0 overflow-auto border-l border-white/10 bg-gray-950 lg:block lg:w-[58%] lg:flex-shrink-0">
              <TripCalendar
            plan={plan}
            matches={matches}
            selectedDate={selectedDate}
            onSelectDate={date => { setSelectedDate(date); setSelected(null) }}
            selected={selected}
            onSelectItem={(item, date) => { setSelectedDate(date); setSelected(item) }}
            highlightDates={matchDates}
            today={today}
          />
          </div>
        )}
        <div className={`min-h-0 flex-1 overflow-y-auto lg:max-w-[420px] lg:border-l lg:border-white/10 ${showCalendar ? 'lg:hidden' : ''}`}>
          {view === 'plan' ? (
            <>
              {/* The map popup carries the editor for anything with a pin; the
                  panel carries it only for items that are not on the map. */}
              {selected && !selected.coordinates && (
                <div className="px-4 pt-4">
                  <StatusEditor
                      key={selected.id}
                      item={items.find(i => i.id === selected.id) ?? selected}
                      dates={plan.days.map(d => d.date)}
                      defaultDate={selectedDate}
                      passcode={passcode}
                      onSaved={item => {
                        setSaved(prev => ({ ...prev, [item.id]: item }))
                        setSelected(null)
                      }}
                      onClose={() => setSelected(null)}
                    />
                </div>
              )}
              <PlanPanel
                plan={plan}
                tasks={tasks}
                legsError={legRows.ok ? null : legRows.error}
                day={planDayNow}
                numbers={numbers}
                onSelectDate={date => { setSelectedDate(date); setSelected(null) }}
                selected={selected}
                onSelect={setSelected}
                hidden={hidden}
                onToggleSection={toggleSection}
                showConsidering={groups.has('considering')}
                matches={matches}
                groups={groups}
                onPickGroup={soloGroup}
                onClearFilters={() => {
                  setHiddenTypes(new Set()); setHiddenLegs(new Set()); setQuery('')
                  setGroups(new Set(ALL_GROUPS)); setSelected(null)
                }}
              />
              <p className="px-4 pb-2 text-[11px] text-white/30">
                <button onClick={lock} className="underline">Sign out</button> of the travel map on this browser
              </p>
            </>
          ) : visiblePlans.map(plan => (
            <DaySection key={plan.dateString} plan={plan} onSelect={setSelected} selected={selected} today={today} matches={matches} byLeg={byLeg} />
          ))}

          <UnmappedList
            items={shown.filter(i => !i.coordinates)}
            onSelect={setSelected}
            dotColor={item => STATUS_DOT[item.status ?? ''] ?? '#8E8E93'}
            // Say what is missing, so a gap can be closed rather than wondered at.
            subtitle={item => {
              const why = item.type === 'Flight' ? 'needs both airport codes from the booking in Notes'
                : item.type === 'Train' ? 'needs both stations from the booking in Notes'
                : item.address ? 'address could not be placed'
                : 'no address'
              return [item.type, item.legCity, why].filter(Boolean).join(' - ')
            }}
          />
        </div>
      </div>
    </main>
  )
}

function DaySection({ plan, selected, onSelect, today, matches, byLeg }: {
  plan: DayPlan
  selected: TripItem | null
  onSelect: (i: TripItem) => void
  today: string
  matches: (i: TripItem) => boolean
  byLeg: boolean
}) {
  const timeline = plan.timeline.filter(p => matches(p.item))
  const anytime = plan.anytime.filter(p => matches(p.item))
  const options = plan.options.filter(matches)
  const needsBooking = plan.needsBooking.filter(matches)
  const hotel = plan.hotel && matches(plan.hotel) ? plan.hotel : null
  const filtered = timeline.length === 0 && anytime.length === 0 && options.length === 0

  return (
    <section className="border-b border-white/10 px-4 py-4 last:border-b-0">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="font-display text-lg text-amber-300">
          {byLeg ? plan.dateString : formatLongDate(plan.dateString)}
        </h2>
        <span className="text-xs text-white/35">
          {byLeg
            ? `${plan.options.length + plan.timeline.length + plan.anytime.length} saved, nothing scheduled yet`
            : `Day ${plan.dayNumber} of ${plan.totalDays}${plan.legCity ? ` - ${plan.legCity}` : ''}`}
        </span>
      </div>

      {needsBooking.length > 0 && (
        <div className="mb-3 rounded-lg border border-orange-400/30 bg-orange-400/10 px-3 py-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-orange-400">Still needs booking</p>
          {needsBooking.map(item => (
            <p key={item.id} className="text-[13px] leading-relaxed text-white/90">{item.name}</p>
          ))}
        </div>
      )}

      {hotel && (
        <button onClick={() => onSelect(hotel)} className={`mb-3 block w-full rounded-lg border border-blue-400/30 bg-blue-400/10 px-3 py-2 text-left ${plan.dateString < today ? 'opacity-50' : ''}`}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-400">
            {plan.dateString < today ? 'Stayed here' : 'Sleeping tonight'}
          </p>
          <p className="text-sm font-semibold text-white">{hotel.name}</p>
          {hotel.address && <p className="text-xs text-white/45">{hotel.address}</p>}
          {hotel.confirmationNumber && (
            <p className="text-xs font-semibold text-green-400">{hotel.confirmationNumber}{hotel.bookedVia ? ` - ${hotel.bookedVia}` : ''}</p>
          )}
        </button>
      )}

      {timeline.length === 0 && anytime.length === 0 && !byLeg && (
        <p className="text-sm text-white/40">
          {filtered ? 'Nothing on this day matches the filters.' : 'Nothing scheduled. Anything on the map is fair game.'}
        </p>
      )}

      <Rows planned={timeline} showTime selected={selected} onSelect={onSelect} today={today} dayDate={plan.dateString} />
      {anytime.length > 0 && timeline.length > 0 && (
        <p className="pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-white/35">Anytime today</p>
      )}
      <Rows planned={anytime} showTime={timeline.length > 0} selected={selected} onSelect={onSelect} today={today} dayDate={plan.dateString} />

      {options.length > 0 && (
        byLeg ? (
          <div className="mt-1">
            {options.map(item => (
              <button
                key={item.id}
                onClick={() => onSelect(item)}
                className={`flex w-full gap-2.5 rounded-md px-1.5 py-2 text-left transition-colors ${
                  selected?.id === item.id ? 'bg-amber-400/10' : 'hover:bg-white/5'
                }`}
              >
                <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full" style={{ background: STATUS_DOT[item.status ?? ''] ?? '#8E8E93' }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-white">{item.name}</span>
                  {item.notes && <span className="mt-0.5 block truncate text-xs text-white/45">{item.notes}</span>}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-3 border-t border-white/10 pt-2 text-xs text-white/35">
            {options.length} more nearby on the map, not scheduled
          </p>
        )
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

/** "Select all" for a chip row. Always there; dim when everything is already on. */
function SelectAll({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!active}
      className="flex-shrink-0 rounded-full border border-white/15 px-2.5 py-1 text-xs font-medium text-white/70 transition-colors hover:bg-white/10 disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent"
    >
      Select all
    </button>
  )
}
