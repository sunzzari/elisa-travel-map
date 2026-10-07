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

const TYPE_GLYPHS: Record<string, string> = {
  Hotel: '🏨',
  Restaurant: '🍽️',
  Activity: '⚡',
  Flight: '✈️',
  Train: '🚅',
  Ferry: '⛴️',
  'Car Rental': '🚗',
  default: '📍',
}

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

export interface MarkerStyle {
  bg: string
  border: string
  glyph: string
}

/** The trip rule: colour by status, glyph by type. */
function markerStyle(item: TripItem): MarkerStyle {
  const bg = STATUS_COLORS[item.status ?? ''] ?? '#9ca3af'
  return {
    bg,
    border: bg,
    glyph: TYPE_GLYPHS[item.type ?? 'default'] ?? TYPE_GLYPHS.default,
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
    const pins = [selected.coordinates, ...(selected.branches ?? [])]
    if (pins.length === 1) {
      map.panTo(selected.coordinates)
      map.setZoom(15)
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
        background: ${style.bg}; border: 2px solid ${style.border};
        border-radius: 50%; width: 32px; height: 32px;
        display: flex; align-items: center; justify-content: center;
        font-size: 14px; cursor: pointer;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      `
      pin.textContent = style.glyph
      const marker = new google.maps.marker.AdvancedMarkerElement({
        position: item.coordinates!,
        content: pin,
        title: item.name,
      })
      // Without `branches`: a tapped pin is one spot, and zooms to itself.
      marker.addListener('gmp-click', () => onSelectRef.current({ ...item, branches: undefined }))
      pinColours.set(marker, style.bg)
      prev.set(item.id, marker)
      newMarkers.push(marker)
    }
    if (newMarkers.length > 0) {
      clustererRef.current.addMarkers(newMarkers)
    }
  }, [map, markerLib, mapped])

  // Highlight selected marker in clusterer
  useEffect(() => {
    for (const [id, marker] of imperativeMarkersRef.current) {
      const el = marker.content as HTMLElement
      if (!el) continue
      const item = items.find(i => i.id === id)
      if (!item) continue
      const style = styleFor(item)
      const isSelected = selected?.id === id
      el.style.border = `2px solid ${isSelected ? '#fff' : style.border}`
      el.style.width = isSelected ? '38px' : '32px'
      el.style.height = isSelected ? '38px' : '32px'
      el.style.fontSize = isSelected ? '17px' : '14px'
      el.style.boxShadow = isSelected
        ? '0 0 0 3px rgba(59,130,246,0.5), 0 2px 8px rgba(0,0,0,0.4)'
        : '0 2px 6px rgba(0,0,0,0.3)'
      marker.zIndex = isSelected ? 100 : 1
    }
  }, [selected, items])

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

      {/* InfoWindow */}
      {selected && selected.coordinates && (
        <InfoWindow
          position={selected.coordinates}
          onCloseClick={() => onSelect(null)}
          pixelOffset={[0, -20]}
        >
          <div style={{ maxWidth: 290, fontFamily: 'var(--font-body), system-ui, sans-serif', padding: '2px 0' }}>
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
              {selected.status && (
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
}

export default function TripMap({ items, apiKey, selected, onSelect, userLocation, onRecenterReady, fitKey, styleFor, defaultCenter, fitScopeIds, pinFilter, bubblesTakePinColour }: Props) {
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
        <MapContent items={items} selected={selected} onSelect={onSelect} userLocation={userLocation} onRecenterReady={onRecenterReady} fitKey={fitKey} styleFor={styleFor} fitScopeIds={fitScopeIds} pinFilter={pinFilter} bubblesTakePinColour={bubblesTakePinColour} />
      </Map>
    </APIProvider>
  )
}
