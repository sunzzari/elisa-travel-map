'use client'

import { useEffect, useMemo, useState, useCallback, useImperativeHandle, forwardRef, useRef } from 'react'
import {
  APIProvider,
  Map,
  AdvancedMarker,
  InfoWindow,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps'
import { MarkerClusterer, MarkerUtils, SuperClusterAlgorithm } from '@googlemaps/markerclusterer'
import type { AlgorithmInput, AlgorithmOutput } from '@googlemaps/markerclusterer'
import { mapsUrl, haversineKm, formatDistance } from '@/lib/geo'
import type { TripItem } from '@/lib/types'
import { branchId } from '@/lib/saved-pins'
import type { UserLocation } from '@/lib/geo'

const PRIORITY_COLORS: Record<string, string> = {
  Must:     '#ef4444',
  High:     '#f97316',
  Optional: '#d1d5db',
}

const STATUS_COLORS: Record<string, string> = {
  Confirmed:   '#22c55e',
  Assigned: '#3B82F6',
  'Reservation Pending': '#F97316',
  Shortlisted: '#eab308',
  Researching: '#9ca3af',
  Cancelled:   '#ef4444',
}

/** Type colours: the same ones the type chips use, so a pin's fill says what it is. */
export const TYPE_META: Record<string, { glyph: string; color: string }> = {
  Hotel: { glyph: '🏨', color: '#3B82F6' },
  Restaurant: { glyph: '🍽️', color: '#EF4444' },
  Activity: { glyph: '⚡', color: '#10B981' },
  Flight: { glyph: '✈️', color: '#8B5CF6' },
  Train: { glyph: '🚅', color: '#F59E0B' },
  Ferry: { glyph: '⛴️', color: '#06B6D4' },
  'Car Rental': { glyph: '🚗', color: '#F97316' },
  Other: { glyph: '📍', color: '#6B7280' },
}

export interface MarkerStyle {
  bg: string
  border: string
  glyph: string
  /** Default '2px solid'. The trip map draws status as the ring: solid, dashed, none. */
  ring?: string
  /** Pin diameter in px. Default 32. The Plan tab draws candidates smaller. */
  size?: number
  /** Default 1. The Plan tab fades candidates so they never read as plans. */
  opacity?: number
}

/**
 * Pins on a trip: the FILL is the type (restaurant red, activity green), the
 * RING is her Notion status. Elisa, 2026-10-19: "booked or planned overcome
 * the restaurant/activity so you cant tell whats a restaurant/activity".
 *   Confirmed               thick solid white ring
 *   Assigned / Res. Pending thick dashed white ring
 *   Shortlisted / Researching  no ring, faded
 */
export function markerStyle(item: TripItem): MarkerStyle {
  const meta = TYPE_META[item.type ?? 'Other'] ?? TYPE_META.Other
  const base = { bg: meta.color, border: '#ffffff', glyph: meta.glyph }
  switch (item.status) {
    case 'Confirmed': return { ...base, ring: '3px solid' }
    case 'Assigned':
    case 'Reservation Pending': return { ...base, ring: '3px dashed' }
    default: return { ...base, border: meta.color, ring: '2px solid', opacity: 0.6, size: 26 }
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  async function handleCopy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={handleCopy}
      style={{
        fontSize: 11, color: copied ? '#22c55e' : '#9ca3af',
        cursor: 'pointer', background: 'none',
        border: '1px solid #e5e7eb', borderRadius: 4,
        padding: '2px 8px', flexShrink: 0, fontWeight: 500,
      }}
    >
      {copied ? '✓' : 'Copy'}
    </button>
  )
}

/**
 * Elisa, 2026-10-05: "the bubbles are over-clustering. i want to see individual
 * entries where I can ... Bubble should only be used in the case where there are
 * too many bubbles to display."
 *
 * So a numbered bubble is the exception. With this many pins or fewer in view,
 * every pin is drawn on its own, even if two touch. Only past it do nearby pins
 * merge, and then within a smaller radius than before (it was 80).
 *
 * This is the one map, so trips and Around Town both get it.
 */
const MAX_SINGLE_PINS = 60
const BUBBLE_RADIUS_PX = 50

/** Each pin's fill, so a bubble can take the colour most of its pins have. */
const pinColours = new WeakMap<object, string>()

/** Whether dark text reads better than white on this hex colour. */
function isLight(hex: string): boolean {
  const n = parseInt(hex.replace('#', ''), 16)
  if (Number.isNaN(n)) return false
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return 0.299 * r + 0.587 * g + 0.114 * b > 160
}

class BubblesWhenCrowded extends SuperClusterAlgorithm {
  private crowded: boolean | null = null

  calculate(input: AlgorithmInput): AlgorithmOutput {
    const bounds = input.map.getBounds()
    const inView = bounds
      ? input.markers.filter(m => bounds.contains(MarkerUtils.getPosition(m))).length
      : input.markers.length
    const crowded = inView > MAX_SINGLE_PINS
    const switched = crowded !== this.crowded
    this.crowded = crowded

    // Always let the parent see the markers, so its index is current the moment
    // the map gets crowded again.
    const merged = super.calculate(input)
    if (crowded) return { clusters: merged.clusters, changed: merged.changed || switched }
    // The same pins drawn singly do not need redrawing on every pan, only when
    // the set of pins changed or bubbles were just switched off.
    return { clusters: this.noop({ markers: input.markers }), changed: merged.changed || switched }
  }
}

function MapContent({
  items,
  selected,
  onSelect,
  userLocation,
  onRecenterReady,
  fitKey,
  styleFor = markerStyle,
  fitScopeIds,
  pinFilter,
  bubblesTakePinColour = false,
  popupExtra,
  cards,
}: {
  items: TripItem[]
  selected: TripItem | null
  onSelect: (item: TripItem | null) => void
  userLocation: UserLocation | null
  onRecenterReady?: (fn: () => void) => void
  fitKey?: string
  /** Overrides how a pin is coloured. Around Town rides on this same map and
      colours by how much Elisa liked the place, not by a trip status. */
  styleFor?: (item: TripItem) => MarkerStyle
  /** Limits every fit to these ids. Undefined fits everything, which is right
      for a trip: its items are all in one place by definition. Around Town is
      not one place -- Elisa, 2026-09-14: "id never want to fit all between sf
      and la. id fit all within one area but not all areas." */
  fitScopeIds?: Set<string>
  /** Leaves out pins this says no to, a chain's branches included. Around Town's
      "near me" uses it so a chain with one branch nearby does not also draw its
      branch across town. Undefined draws every pin, as a trip wants. */
  pinFilter?: (pin: { id: string; lat: number; lng: number }) => boolean
  /** A bubble takes the colour most of its pins have, instead of the one blue.
      Around Town asks for it, so its legend means something on a bubble too. */
  bubblesTakePinColour?: boolean
  /** Replaces the status pill in a pin's popup. The trip Plan tab puts its
      Idea / Planned / Booked dropdown here, so it works straight from the map. */
  popupExtra?: (item: TripItem) => React.ReactNode
  /** Search results: a small white card on each, skipping any that would land
      on top of one already shown at this zoom. */
  cards?: TripItem[]
}) {
  const map = useMap()
  const markerLib = useMapsLibrary('marker')
  // Every pin on the map: each placed item, plus one per chain branch (Elisa,
  // 2026-09-30: every branch in the area gets a pin). A branch is a copy of the
  // place at the branch's spot, so a tap opens the same place there. Built once
  // and used by BOTH the fit and the markers, so a branch is framed as well as
  // drawn. This is the one map, so trips and Around Town both get it.
  const mapped = useMemo(
    () =>
      items
        .filter(i => i.coordinates)
        .flatMap(i => [
          i,
          ...(i.branches ?? []).map((b, n) => ({
            ...i,
            id: branchId(i.id, n),
            coordinates: { lat: b.lat, lng: b.lng },
            address: b.address,
            branches: undefined,
          })),
        ])
        .filter(i => !pinFilter || pinFilter({ id: i.id, ...i.coordinates! })),
    [items, pinFilter]
  )
  const clustererRef = useRef<MarkerClusterer | null>(null)
  const bubbleColourRef = useRef(bubblesTakePinColour)
  bubbleColourRef.current = bubblesTakePinColour
  const imperativeMarkersRef = useRef<globalThis.Map<string, google.maps.marker.AdvancedMarkerElement>>(new globalThis.Map())
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  // Hover opens the pin's own popup, no separate card. Elisa, 2026-10-18: "i
  // dont want you making a separate card. i want you just to have this open
  // when i hover. but if there are too many close to each other, it flickers."
  // Flicker came from the map moving: a hover-opened popup never pans or
  // zooms the map, so no other pin slides under the pointer. A short rest is
  // needed before a hover opens anything, so sweeping across a cluster does
  // not open every pin on the way.
  // A hover-opened popup closes when the pointer leaves the pin, after a
  // grace period long enough to move onto the popup itself (its buttons stay
  // usable) or onto the next pin, which replaces it without a gap. Elisa,
  // 2026-10-21: "it doesnt go away when i [hover] away". A clicked popup
  // still stays until the map is clicked or its X.
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const quietSelectRef = useRef(false)
  const [openedByHover, setOpenedByHover] = useState(false)
  const openedByHoverRef = useRef(false)
  openedByHoverRef.current = openedByHover
  const selectedIdRef = useRef<string | null>(null)
  selectedIdRef.current = selected?.id ?? null
  const keepHoverPopup = () => { if (closeTimer.current) clearTimeout(closeTimer.current) }
  const leaveHoverPopup = useRef(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    if (!openedByHoverRef.current) return
    closeTimer.current = setTimeout(() => {
      if (openedByHoverRef.current) onSelectRef.current(null)
    }, 350)
  })
  const hoverRef = useRef((id: string | null) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    if (!id) { leaveHoverPopup.current(); return }
    if (closeTimer.current) clearTimeout(closeTimer.current)
    hoverTimer.current = setTimeout(() => {
      if (selectedIdRef.current === id) return
      const item = mappedRef.current.find(i => i.id === id)
      if (!item) return
      quietSelectRef.current = true
      setOpenedByHover(true)
      onSelectRef.current({ ...item, branches: undefined })
    }, 250)
  })
  const mappedRef = useRef(mapped)
  mappedRef.current = mapped

  // Cards for search results, at most 8, never crowded: a card is dropped
  // when its pin sits within a card's footprint of one already kept.
  // Chosen from what is ON SCREEN, re-chosen whenever the map settles. It was
  // the first 8 across the whole trip, so zoomed into Vienna every slot could
  // sit on a Salzburg pin and no card showed. Elisa, 2026-10-19: "sometimes
  // the white cards don't show up if you zoom".
  const [zoom, setZoom] = useState<number | null>(null)
  const [view, setView] = useState<google.maps.LatLngBounds | null>(null)
  useEffect(() => {
    if (!map) return
    const settle = () => { setZoom(map.getZoom() ?? null); setView(map.getBounds() ?? null) }
    settle()
    const l = map.addListener('idle', settle)
    return () => l.remove()
  }, [map])
  // A pinch on the map zooms the map, never the page. Elisa, 2026-10-19:
  // "sometimes it zooms inside the map, but sometimes zooms the whole page".
  // Google only takes the pinch when it starts on bare map; started on a pin
  // or a white card it fell through to the browser. Trackpads send a pinch as
  // ctrl+wheel (Chrome) or gesture events (Safari); phones as touches.
  useEffect(() => {
    if (!map) return
    const div = map.getDiv()
    const onCard = (t: EventTarget | null) =>
      t instanceof Element && !!t.closest('.gm-style-iw, .gm-style-iw-c, [role="dialog"], gmp-advanced-marker')
    // Bare map: Google zooms. Over a pin or card, Google ignored it (the card
    // swallowed the wheel), so zoom here, by about the same feel.
    // A pinch sends many tiny steps. Each was added to getZoom() and rounded
    // away, so over a pin a pinch did nothing; Around Town is dense enough that
    // the pointer is nearly always over one. Elisa, 2026-10-21: "when im on the
    // around town one i cant use to fingers on the trackpad to zoom". The steps
    // now add up in `target` until the gesture pauses.
    let target: number | null = null
    let resetTarget: ReturnType<typeof setTimeout> | null = null
    const zoomBy = (step: number) => {
      target = Math.max(3, Math.min(20, (target ?? map.getZoom() ?? 10) + step))
      map.setZoom(target)
      if (resetTarget) clearTimeout(resetTarget)
      resetTarget = setTimeout(() => { target = null }, 250)
    }
    const wheel = (e: WheelEvent) => {
      if (!onCard(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      zoomBy(Math.max(-1, Math.min(1, -e.deltaY * (e.ctrlKey ? 0.02 : 0.005))))
    }
    let startZoom = 10
    const gestureStart = (e: Event) => { e.preventDefault(); startZoom = map.getZoom() ?? 10 }
    const gestureChange = (e: Event) => {
      e.preventDefault()
      const scale = (e as Event & { scale?: number }).scale
      if (onCard(e.target) && scale) map.setZoom(Math.max(3, Math.min(20, startZoom + Math.log2(scale))))
    }
    div.style.touchAction = 'none'
    div.addEventListener('wheel', wheel, { passive: false, capture: true })
    div.addEventListener('gesturestart', gestureStart, { passive: false })
    div.addEventListener('gesturechange', gestureChange, { passive: false })
    return () => {
      if (resetTarget) clearTimeout(resetTarget)
      div.removeEventListener('wheel', wheel, { capture: true })
      div.removeEventListener('gesturestart', gestureStart)
      div.removeEventListener('gesturechange', gestureChange)
    }
  }, [map])

  const shownCards = useMemo(() => {
    if (!cards?.length || zoom === null) return []
    const scale = (256 * Math.pow(2, zoom)) / 360
    const kept: TripItem[] = []
    for (const c of cards) {
      if (!c.coordinates || c.id === selected?.id) continue
      if (view && !view.contains(c.coordinates)) continue
      const clash = kept.some(k => {
        const dx = Math.abs(k.coordinates!.lng - c.coordinates!.lng) * scale
        const dy = Math.abs(k.coordinates!.lat - c.coordinates!.lat) * scale / Math.cos((c.coordinates!.lat * Math.PI) / 180)
        return dx < 190 && dy < 70
      })
      if (!clash) kept.push(c)
      if (kept.length >= 8) break
    }
    return kept
  }, [cards, zoom, view, selected])
  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  const fitBounds = useCallback((includeUser: boolean) => {
    if (!map) return
    // Scope the fit, but never to nothing: an empty scope (coordinates still
    // arriving) falls back to every pin rather than leaving the map unframed.
    const scoped = fitScopeIds ? mapped.filter(i => fitScopeIds.has(i.id)) : mapped
    const inFrame = scoped.length > 0 ? scoped : mapped
    const lats = inFrame.map(i => i.coordinates!.lat)
    const lngs = inFrame.map(i => i.coordinates!.lng)
    if (includeUser && userLocation) {
      lats.push(userLocation.lat)
      lngs.push(userLocation.lng)
    }
    if (lats.length === 0) {
      if (userLocation) {
        map.panTo(userLocation)
        map.setZoom(14)
      }
      return
    }
    if (lats.length === 1) {
      map.panTo({ lat: lats[0], lng: lngs[0] })
      map.setZoom(14)
      return
    }
    map.fitBounds(
      { north: Math.max(...lats), south: Math.min(...lats), east: Math.max(...lngs), west: Math.min(...lngs) },
      60
    )
    // Two pins a street apart would otherwise zoom to the pavement and hide
    // everything around them. Cap a fit at street level, same as one pin.
    google.maps.event.addListenerOnce(map, 'idle', () => {
      if ((map.getZoom() ?? 0) > 16) map.setZoom(16)
    })
  }, [map, mapped, userLocation, fitScopeIds])

  // Fit map to all pins on initial load
  const fitBoundsRef = useRef(fitBounds)
  fitBoundsRef.current = fitBounds
  useEffect(() => {
    if (!map) return
    fitBoundsRef.current(false)
    // A map that has not been laid out yet has no size, and a fit on it frames
    // the whole world. Nothing fits it again until a filter changes, so a
    // search with no pins was left looking at the globe. Fit once more when
    // the map has actually drawn.
    const drawn = google.maps.event.addListenerOnce(map, 'idle', () => fitBoundsRef.current(false))
    return () => drawn.remove()
  }, [map])

  // Expose recenter function to parent (fits pins only, no user location bias)
  useEffect(() => {
    onRecenterReady?.(() => fitBounds(false))
  }, [fitBounds, onRecenterReady])

  // Pan to selected item. A chain picked from a list is framed with ALL its
  // branches (Elisa, 2026-10-07: "when something has multiple locations, it's
  // not showing all the locations on the map. It's just showing one of them").
  // A pin tapped on the map arrives without `branches`, so it zooms to itself.
  useEffect(() => {
    if (!selected?.coordinates || !map) return
    // Opened by hover: leave the map exactly where it is.
    if (quietSelectRef.current) { quietSelectRef.current = false; return }
    // Chosen from a list or card: a click, so mouse-out must not close it.
    openedByHoverRef.current = false
    setOpenedByHover(false)
    const pins = [selected.coordinates, ...(selected.branches ?? [])]
    // One spot: keep her zoom. It went to street level (15) on every click and
    // she had to zoom back out to see the rest. Elisa, 2026-10-21: "when i click
    // on an entry it zooms very close and i dont always want that". Pan only if
    // the pin is off screen; zoom in only from far out, and only to city level.
    if (pins.length === 1) {
      const farOut = (map.getZoom() ?? 0) < 11
      const view = map.getBounds()
      if (farOut || !view || !view.contains(selected.coordinates)) map.panTo(selected.coordinates)
      if (farOut) map.setZoom(12)
      return
    }
    const lats = pins.map(p => p.lat)
    const lngs = pins.map(p => p.lng)
    map.fitBounds(
      { north: Math.max(...lats), south: Math.min(...lats), east: Math.max(...lngs), west: Math.min(...lngs) },
      80
    )
  }, [selected, map])

  // Refit bounds when fitKey changes (leg/city/date/nearme filter)
  const [prevFitKey, setPrevFitKey] = useState(fitKey)
  useEffect(() => {
    if (fitKey !== prevFitKey) {
      setPrevFitKey(fitKey)
      fitBounds(!!userLocation)
    }
  }, [fitKey, prevFitKey, fitBounds, userLocation])

  // Initialize clusterer once
  useEffect(() => {
    if (!map || !markerLib) return
    if (clustererRef.current) return

    clustererRef.current = new MarkerClusterer({
      map,
      algorithm: new BubblesWhenCrowded({ radius: BUBBLE_RADIUS_PX }),
      renderer: {
        render({ count, position, markers }) {
          const size = Math.min(24 + Math.log2(count) * 8, 56)
          const div = document.createElement('div')
          // The colour most of its pins have, when the caller asked for that.
          let background = 'rgba(59,130,246,0.75)'
          let ink = '#fff'
          if (bubbleColourRef.current) {
            const tally = new globalThis.Map<string, number>()
            for (const m of markers ?? []) {
              const colour = pinColours.get(m)
              if (colour) tally.set(colour, (tally.get(colour) ?? 0) + 1)
            }
            const most = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0]
            if (most) {
              background = most
              ink = isLight(most) ? '#111827' : '#fff'
            }
          }
          div.style.cssText = `
            width: ${size}px; height: ${size}px; border-radius: 50%;
            background: ${background}; border: 2px solid rgba(255,255,255,0.9);
            display: flex; align-items: center; justify-content: center;
            font: 600 ${Math.max(11, size * 0.35)}px system-ui, sans-serif;
            color: ${ink}; cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          `
          div.textContent = String(count)
          return new google.maps.marker.AdvancedMarkerElement({ position, content: div })
        },
      },
    })
  }, [map, markerLib])

  // Create imperative markers for the clusterer (separate from React markers)
  useEffect(() => {
    if (!map || !markerLib || !clustererRef.current) return

    const withCoords = mapped
    const currentIds = new Set(withCoords.map(i => i.id))
    const prev = imperativeMarkersRef.current

    // Remove markers no longer in the set
    for (const [id, marker] of prev) {
      if (!currentIds.has(id)) {
        clustererRef.current.removeMarker(marker)
        marker.map = null
        prev.delete(id)
      }
    }

    // Add new markers
    const newMarkers: google.maps.marker.AdvancedMarkerElement[] = []
    for (const item of withCoords) {
      const existing = prev.get(item.id)
      if (existing) {
        // A saved edit can move a pin; the marker follows it.
        existing.position = item.coordinates!
        continue
      }
      const style = styleFor(item)
      const pin = document.createElement('div')
      pin.style.cssText = `
        background: ${style.bg}; border: ${style.ring ?? '2px solid'} ${style.border};
        border-radius: 50%; width: 32px; height: 32px;
        display: flex; align-items: center; justify-content: center;
        font-size: 14px; font-weight: 700; color: #0b0b0d; cursor: pointer;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      `
      pin.textContent = style.glyph
      const marker = new google.maps.marker.AdvancedMarkerElement({
        position: item.coordinates!,
        content: pin,
        title: item.name,
      })
      // Without `branches`: a tapped pin is one spot, and zooms to itself.
      marker.addListener('gmp-click', () => {
        if (hoverTimer.current) clearTimeout(hoverTimer.current)
        if (closeTimer.current) clearTimeout(closeTimer.current)
        openedByHoverRef.current = false
        setOpenedByHover(false)
        onSelectRef.current({ ...item, branches: undefined })
      })
      pin.addEventListener('mouseenter', () => hoverRef.current(item.id))
      pin.addEventListener('mouseleave', () => hoverRef.current(null))
      pinColours.set(marker, style.bg)
      prev.set(item.id, marker)
      newMarkers.push(marker)
    }
    if (newMarkers.length > 0) {
      clustererRef.current.addMarkers(newMarkers)
    }
  }, [map, markerLib, mapped])

  // Highlight selected marker in clusterer. Also re-applies the whole style,
  // because a marker is built once per item: a status saved from the Plan tab,
  // or a day switch renumbering its stops, must reach a pin that already exists.
  useEffect(() => {
    for (const [id, marker] of imperativeMarkersRef.current) {
      const el = marker.content as HTMLElement
      if (!el) continue
      const item = items.find(i => i.id === id)
      if (!item) continue
      const style = styleFor(item)
      const isSelected = selected?.id === id
      const size = (style.size ?? 32) + (isSelected ? 6 : 0)
      el.style.background = style.bg
      el.textContent = style.glyph
      el.style.opacity = String(isSelected ? 1 : style.opacity ?? 1)
      pinColours.set(marker, style.bg)
      el.style.border = `${style.ring ?? '2px solid'} ${isSelected ? '#fff' : style.border}`
      el.style.width = `${size}px`
      el.style.height = `${size}px`
      el.style.fontSize = `${Math.round(size * 0.44)}px`
      el.style.boxShadow = isSelected
        ? '0 0 0 3px rgba(59,130,246,0.5), 0 2px 8px rgba(0,0,0,0.4)'
        : '0 2px 6px rgba(0,0,0,0.3)'
      marker.zIndex = isSelected ? 100 : (style.opacity ?? 1) < 1 ? 0 : 1
    }
  }, [selected, items, styleFor])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clustererRef.current?.clearMarkers()
      clustererRef.current = null
      for (const marker of imperativeMarkersRef.current.values()) {
        marker.map = null
      }
      imperativeMarkersRef.current.clear()
    }
  }, [])

  return (
    <>

      {/* User location dot */}
      {userLocation && (
        <AdvancedMarker position={userLocation} zIndex={200} title="You are here">
          <div style={{
            width: 16, height: 16, borderRadius: '50%',
            background: '#3B82F6', border: '3px solid #fff',
            boxShadow: '0 0 0 4px rgba(59,130,246,0.25), 0 2px 6px rgba(0,0,0,0.3)',
          }} />
        </AdvancedMarker>
      )}

      {shownCards.map(card => (
        <InfoWindow
          key={card.id}
          position={card.coordinates!}
          pixelOffset={[0, -20]}
          disableAutoPan
          shouldFocus={false}
          headerDisabled
        >
          <button
            onClick={() => onSelect({ ...card, branches: undefined })}
            style={{ display: 'block', maxWidth: 200, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontFamily: 'var(--font-body), system-ui, sans-serif' }}
          >
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#111', lineHeight: 1.25 }}>{card.name}</span>
            <span style={{ display: 'block', fontSize: 11, color: '#6b7280', marginTop: 2 }}>
              {[card.type, card.status, card.assignedToDate ?? card.date].filter(Boolean).join(' · ')}
            </span>
          </button>
        </InfoWindow>
      ))}

      {/* InfoWindow */}
      {selected && selected.coordinates && (
        <InfoWindow
          position={selected.coordinates}
          onCloseClick={() => onSelect(null)}
          pixelOffset={[0, -20]}
          disableAutoPan={openedByHover}
          // Never take the keyboard: a popup redrawn on each search keystroke
          // was pulling focus out of the search box after every letter.
          shouldFocus={false}
        >
          <div
            onMouseEnter={keepHoverPopup}
            onMouseLeave={() => leaveHoverPopup.current()}
            style={{ maxWidth: 290, fontFamily: 'var(--font-body), system-ui, sans-serif', padding: '2px 0' }}
          >
            {selected.priority && (
              <div style={{
                height: 3, borderRadius: 2, width: 36, marginBottom: 10,
                background: PRIORITY_COLORS[selected.priority] ?? '#d1d5db',
              }} />
            )}

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
              <div style={{ fontFamily: 'var(--font-display), serif', fontWeight: 400, fontSize: 16, color: '#111', flex: 1, lineHeight: 1.3 }}>
                {selected.name}
              </div>
              <CopyButton text={[selected.venue || selected.name, selected.legCity].filter(Boolean).join(', ')} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: '#9ca3af' }}>
                {[selected.type, selected.legCity].filter(Boolean).join(' · ')}
              </span>
              {userLocation && selected.coordinates && (
                <span style={{ fontSize: 11, fontWeight: 600, color: '#3b82f6' }}>
                  · {formatDistance(haversineKm(userLocation.lat, userLocation.lng, selected.coordinates.lat, selected.coordinates.lng))}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
              {popupExtra ? popupExtra(selected) : selected.status && (
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: '2px 8px',
                  borderRadius: 12, background: STATUS_COLORS[selected.status] ?? '#9ca3af', color: '#fff',
                }}>
                  {selected.status}
                </span>
              )}
              {selected.priority && (
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 12,
                  background: PRIORITY_COLORS[selected.priority] ?? '#d1d5db',
                  color: selected.priority === 'Optional' ? '#6b7280' : '#fff',
                }}>
                  {selected.priority}
                </span>
              )}
              {selected.reservationRequired && (
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: '2px 8px',
                  borderRadius: 12, background: '#fef3c7', color: '#92400e',
                }}>
                  Reservation required
                </span>
              )}
            </div>

            {selected.date && (
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6 }}>
                📅 {selected.date}
              </div>
            )}

            {selected.notes && (
              <div style={{
                fontSize: 12, color: '#374151', lineHeight: 1.5,
                marginBottom: 10, borderTop: '1px solid #f3f4f6', paddingTop: 8,
              }}>
                {selected.notes.length > 220 ? selected.notes.slice(0, 220) + '…' : selected.notes}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <a
                href={mapsUrl(selected, userLocation)}
                target="_blank"
                rel="noreferrer"
                style={{
                  flex: 1, textAlign: 'center', fontSize: 12, color: '#fff',
                  background: '#4285F4', padding: '5px 10px', borderRadius: 6,
                  textDecoration: 'none', fontWeight: 600,
                }}
              >
                {userLocation ? 'Directions' : 'Open in Maps'}
              </a>
              <a
                href={selected.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: 12, color: '#6b7280', alignSelf: 'center',
                  padding: '5px 8px', border: '1px solid #e5e7eb',
                  borderRadius: 6, textDecoration: 'none',
                }}
              >
                Notion →
              </a>
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  )
}

interface Props {
  items: TripItem[]
  apiKey: string
  selected: TripItem | null
  onSelect: (item: TripItem | null) => void
  userLocation: UserLocation | null
  onRecenterReady?: (fn: () => void) => void
  fitKey?: string
  styleFor?: (item: TripItem) => MarkerStyle
  /** Where the map sits before any pin loads. A trip can be anywhere; Around
      Town is always LA or the Bay. */
  defaultCenter?: { lat: number; lng: number }
  fitScopeIds?: Set<string>
  pinFilter?: (pin: { id: string; lat: number; lng: number }) => boolean
  bubblesTakePinColour?: boolean
  popupExtra?: (item: TripItem) => React.ReactNode
  cards?: TripItem[]
}

export default function TripMap({ items, apiKey, selected, onSelect, userLocation, onRecenterReady, fitKey, styleFor, defaultCenter, fitScopeIds, pinFilter, bubblesTakePinColour, popupExtra, cards }: Props) {
  const mapped = items.filter(i => i.coordinates)

  const center = userLocation ?? (mapped.length > 0
    ? {
        lat: mapped.reduce((s, i) => s + i.coordinates!.lat, 0) / mapped.length,
        lng: mapped.reduce((s, i) => s + i.coordinates!.lng, 0) / mapped.length,
      }
    : defaultCenter ?? { lat: 35.6762, lng: 139.6503 })

  return (
    <APIProvider apiKey={apiKey}>
      <Map
        defaultCenter={center}
        defaultZoom={mapped.length === 1 ? 14 : 10}
        mapId="travel-map"
        style={{ width: '100%', height: '100%' }}
        gestureHandling="greedy"
        mapTypeControl={false}
        streetViewControl={false}
        fullscreenControl={false}
        zoomControl={false}
        rotateControl={false}
        scaleControl={false}
        clickableIcons={false}
        onClick={() => onSelect(null)}
      >
        <MapContent items={items} selected={selected} onSelect={onSelect} userLocation={userLocation} onRecenterReady={onRecenterReady} fitKey={fitKey} styleFor={styleFor} fitScopeIds={fitScopeIds} pinFilter={pinFilter} bubblesTakePinColour={bubblesTakePinColour} popupExtra={popupExtra} cards={cards} />
      </Map>
    </APIProvider>
  )
}
