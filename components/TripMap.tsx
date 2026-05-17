'use client'

import { useEffect, useState, useCallback, useImperativeHandle, forwardRef, useRef } from 'react'
import {
  APIProvider,
  Map,
  AdvancedMarker,
  InfoWindow,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps'
import { MarkerClusterer, SuperClusterAlgorithm } from '@googlemaps/markerclusterer'
import { mapsUrl, haversineKm, formatDistance } from '@/lib/geo'
import type { TripItem } from '@/lib/types'
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

function markerStyle(item: TripItem) {
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

function MapContent({
  items,
  selected,
  onSelect,
  userLocation,
  onRecenterReady,
  fitKey,
}: {
  items: TripItem[]
  selected: TripItem | null
  onSelect: (item: TripItem | null) => void
  userLocation: UserLocation | null
  onRecenterReady?: (fn: () => void) => void
  fitKey?: string
}) {
  const map = useMap()
  const markerLib = useMapsLibrary('marker')
  const mapped = items.filter(i => i.coordinates)
  const clustererRef = useRef<MarkerClusterer | null>(null)
  const imperativeMarkersRef = useRef<globalThis.Map<string, google.maps.marker.AdvancedMarkerElement>>(new globalThis.Map())
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  const fitBounds = useCallback((includeUser: boolean) => {
    if (!map) return
    const lats = mapped.map(i => i.coordinates!.lat)
    const lngs = mapped.map(i => i.coordinates!.lng)
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
  }, [map, mapped, userLocation])

  // Fit map to all pins on initial load
  useEffect(() => {
    fitBounds(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])

  // Expose recenter function to parent (fits pins only, no user location bias)
  useEffect(() => {
    onRecenterReady?.(() => fitBounds(false))
  }, [fitBounds, onRecenterReady])

  // Pan to selected item
  useEffect(() => {
    if (selected?.coordinates && map) {
      map.panTo(selected.coordinates)
      map.setZoom(15)
    }
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
      algorithm: new SuperClusterAlgorithm({ radius: 80 }),
      renderer: {
        render({ count, position }) {
          const size = Math.min(24 + Math.log2(count) * 8, 56)
          const div = document.createElement('div')
          div.style.cssText = `
            width: ${size}px; height: ${size}px; border-radius: 50%;
            background: rgba(59,130,246,0.75); border: 2px solid rgba(255,255,255,0.9);
            display: flex; align-items: center; justify-content: center;
            font: 600 ${Math.max(11, size * 0.35)}px system-ui, sans-serif;
            color: #fff; cursor: pointer;
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

    const withCoords = items.filter(i => i.coordinates)
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
      if (prev.has(item.id)) continue
      const style = markerStyle(item)
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
      marker.addListener('gmp-click', () => onSelectRef.current(item))
      prev.set(item.id, marker)
      newMarkers.push(marker)
    }
    if (newMarkers.length > 0) {
      clustererRef.current.addMarkers(newMarkers)
    }
  }, [map, markerLib, items])

  // Highlight selected marker in clusterer
  useEffect(() => {
    for (const [id, marker] of imperativeMarkersRef.current) {
      const el = marker.content as HTMLElement
      if (!el) continue
      const item = items.find(i => i.id === id)
      if (!item) continue
      const style = markerStyle(item)
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
}

export default function TripMap({ items, apiKey, selected, onSelect, userLocation, onRecenterReady, fitKey }: Props) {
  const mapped = items.filter(i => i.coordinates)

  const center = userLocation ?? (mapped.length > 0
    ? {
        lat: mapped.reduce((s, i) => s + i.coordinates!.lat, 0) / mapped.length,
        lng: mapped.reduce((s, i) => s + i.coordinates!.lng, 0) / mapped.length,
      }
    : { lat: 35.6762, lng: 139.6503 })

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
        <MapContent items={items} selected={selected} onSelect={onSelect} userLocation={userLocation} onRecenterReady={onRecenterReady} fitKey={fitKey} />
      </Map>
    </APIProvider>
  )
}
