import { NextResponse } from 'next/server'
import { refuseWithoutPasscode } from '@/lib/edit-auth'

/**
 * Candidate addresses for a place, for Elisa to pick from before saving.
 * Nothing is written here. Passcode-gated because every call is billed.
 *
 * Google Places text search first: it knows businesses by name. If the key is
 * not enabled for Places, the Geocoding API (which this key already uses) is
 * the fallback; it is weaker on business names but still returns addresses.
 */

interface Match {
  name: string
  address: string
}

const KEY = process.env.GOOGLE_MAPS_API_KEY ?? ''

async function placesSearch(q: string): Promise<Match[] | null> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': KEY,
      'x-goog-fieldmask': 'places.displayName,places.formattedAddress',
    },
    body: JSON.stringify({ textQuery: q, maxResultCount: 5 }),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) return null
  const json: any = await res.json()
  return (json.places ?? [])
    .filter((p: any) => p.formattedAddress)
    .map((p: any) => ({ name: p.displayName?.text ?? '', address: p.formattedAddress }))
}

async function geocodeSearch(q: string): Promise<Match[]> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${KEY}`
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) return []
  const json: any = await res.json()
  return (json.results ?? [])
    .slice(0, 5)
    .map((r: any) => ({ name: '', address: r.formatted_address as string }))
}

export async function GET(request: Request) {
  const refused = refuseWithoutPasscode(request)
  if (refused) return refused

  const q = (new URL(request.url).searchParams.get('q') ?? '').trim().slice(0, 200)
  if (!q) return NextResponse.json({ error: 'q required' }, { status: 400 })
  if (!KEY) return NextResponse.json({ error: 'No Google key on this deployment' }, { status: 503 })

  try {
    const matches = (await placesSearch(q)) ?? (await geocodeSearch(q))
    return NextResponse.json({ matches })
  } catch {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}
