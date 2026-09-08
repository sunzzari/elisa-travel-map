import { NextResponse } from 'next/server'
import { geocodeVenue } from '@/lib/geocode'

// Client-side map calls this to get coordinates — keeps API key server-side
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const venue = searchParams.get('venue') ?? ''
  const city = searchParams.get('city') ?? ''
  // The trip's own location. Used when the item has no leg, so a venue name is
  // never looked up against the whole planet. See lib/geocode countryOf.
  const region = searchParams.get('region') ?? ''

  // A city alone is not an item's location, it is context for a venue or name.
  // Accepting city-only here is what let a blank venue resolve to a city centre
  // and silently defeat the name lookup on the callers' side.
  if (!venue.trim()) {
    return NextResponse.json({ error: 'venue (or item name) required' }, { status: 400 })
  }

  const coords = await geocodeVenue(venue, city, region)
  if (!coords) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(coords)
}
